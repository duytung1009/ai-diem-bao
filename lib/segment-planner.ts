import type { ScrapedPost, TopicSegment } from './types';
import { estimateTokens, calculateSegmentBudget, getThinkingOverhead } from './token-estimator';
import { RESPONSE_BUFFER_TOKENS } from './constants';

/**
 * Plan dynamic segments from all scraped posts.
 * Pure function — deterministic, no side effects, no I/O.
 *
 * Groups posts by page, accumulates tokens per page using the same formula as
 * the online algorithm in autoSummarizeDynamic (useSummarize.ts:1137-1166).
 * When pending tokens + page tokens exceed budget and pending posts exist,
 * commits a segment. Final page range is flushed as the last segment.
 *
 * @param posts — all scraped posts, sorted naturally by page (ascending).
 * @param budgetTokens — per-segment token budget.
 * @returns deterministic array of {start, end} boundaries.
 */
export function planDynamicSegments(
  posts: ScrapedPost[],
  budgetTokens: number,
): { start: number; end: number }[] {
  if (posts.length === 0) return [];

  // Group posts by page so iteration mirrors the original scrape-page loop.
  const pageMap = new Map<number, ScrapedPost[]>();
  for (const post of posts) {
    const page = post.page ?? 1;
    let bucket = pageMap.get(page);
    if (!bucket) {
      bucket = [];
      pageMap.set(page, bucket);
    }
    bucket.push(post);
  }

  const pageNumbers = [...pageMap.keys()].sort((a, b) => a - b);
  const boundaries: { start: number; end: number }[] = [];

  let pendingPosts: ScrapedPost[] = [];
  let pendingTokens = 0;
  let pendingStartPage = pageNumbers[0];

  for (const page of pageNumbers) {
    const pagePosts = pageMap.get(page)!;
    const pageTokens = pagePosts.reduce(
      (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
      0,
    );

    if (pendingTokens + pageTokens > budgetTokens && pendingPosts.length > 0) {
      boundaries.push({ start: pendingStartPage, end: page - 1 });
      pendingPosts = [];
      pendingTokens = 0;
      pendingStartPage = page;
    }

    pendingPosts.push(...pagePosts);
    pendingTokens += pageTokens;
  }

  // Flush remaining posts as the last segment
  if (pendingPosts.length > 0) {
    const lastPage = pageNumbers[pageNumbers.length - 1];
    boundaries.push({ start: pendingStartPage, end: lastPage });
  }

  return boundaries;
}

/**
 * Check if a segment is considered "completed" — i.e., has a non-empty summary.
 * Uses truthy check so that summary: '' is treated as incomplete.
 */
export function isCompletedSegment(seg: TopicSegment | null | undefined): seg is TopicSegment {
  return !!seg?.summary;
}

export interface SegmentBudgetParams {
  model: string;
  systemPromptTokens: number;
  maxTokens?: number;
  contextWindowOverride?: number;
  thinkingOverhead?: number;
}

/** Resume state for continuing a partial dynamic auto-summarize run. */
export interface DynamicResumeState {
  fromPage: number;
  segmentIndex: number;
  pendingPosts: ScrapedPost[];
  pendingTokens: number;
  pendingStartPage: number;
}

export interface ResumeStateParams {
  segments: (TopicSegment | null)[];
  model: string;
  summaryPromptTokens: number;
  maxTokens?: number;
  contextWindow?: number;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  totalPages?: number;
}

/**
 * Compute the per-segment token budget for dynamic summarization.
 * responseBuffer = max(RESPONSE_BUFFER_TOKENS, maxTokens) to account for output token allocation.
 * Fix: previously computeResumeState used hardcoded RESPONSE_BUFFER_TOKENS without maxTokens.
 */
export function computeSegmentBudget(params: SegmentBudgetParams): number {
  const {
    model,
    systemPromptTokens,
    maxTokens,
    contextWindowOverride,
    thinkingOverhead = 0,
  } = params;
  const responseBuffer = Math.max(RESPONSE_BUFFER_TOKENS, maxTokens ?? 0);
  return calculateSegmentBudget(model, systemPromptTokens, responseBuffer, contextWindowOverride, thinkingOverhead);
}

/**
 * Compute resume state from current segment status.
 * Returns null if no segments were completed yet (fresh run needed).
 * If the last completed segment has ≤70% token usage, merges new pages into it.
 * If >70%, a new segment is created to avoid perpetual re-summarization.
 */
export function computeResumeState(params: ResumeStateParams): DynamicResumeState | null {
  const {
    segments,
    model,
    summaryPromptTokens,
    maxTokens,
    contextWindow,
    thinkingEnabled,
    thinkingBudget,
    totalPages,
  } = params;

  const completed = segments.filter(isCompletedSegment);
  if (completed.length === 0) return null;

  const lastSeg = completed[completed.length - 1];
  const lastSegIdx = segments.lastIndexOf(lastSeg);

  const pendingPosts: ScrapedPost[] = [...lastSeg.posts];
  const pendingTokens = pendingPosts.reduce(
    (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
    0,
  );

  // When no new pages exist (endPage >= totalPages), re-scrape last page to pick up new posts
  const nextNewPage = lastSeg.endPage + 1;
  const fromPage = (totalPages && nextNewPage > totalPages) ? lastSeg.endPage : nextNewPage;

  // Always start from the last segment's state so new pages can be merged
  const mergeBase: DynamicResumeState = {
    fromPage,
    segmentIndex: lastSegIdx,
    pendingPosts,
    pendingTokens,
    pendingStartPage: lastSeg.startPage,
  };

  if (lastSeg.complete !== false) {
    // Segment was marked complete — check if it still has headroom for merging.
    // If usage is high (>70%), start a fresh segment to avoid constant re-summarization.
    const thinkingOverhead = getThinkingOverhead(model, thinkingEnabled, thinkingBudget);
    const budget = computeSegmentBudget({
      model,
      systemPromptTokens: summaryPromptTokens,
      maxTokens,
      contextWindowOverride: contextWindow,
      thinkingOverhead,
    });
    const usagePct = budget > 0 ? pendingTokens / budget : 0;
    if (usagePct > 0.7) {
      return {
        fromPage,
        segmentIndex: fromPage === lastSeg.endPage ? lastSegIdx : lastSegIdx + 1,
        pendingPosts: fromPage === lastSeg.endPage ? pendingPosts : [],
        pendingTokens: fromPage === lastSeg.endPage ? pendingTokens : 0,
        pendingStartPage: fromPage === lastSeg.endPage ? lastSeg.startPage : fromPage,
      };
    }
  }
  return mergeBase;
}
