import type { ScrapedPost, TopicSegment } from './types';
import { estimateTokens, calculateSegmentBudget, getThinkingOverhead } from './token-estimator';
import { RESPONSE_BUFFER_TOKENS } from './constants';

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
  } = params;

  const completed = segments.filter((s): s is TopicSegment => s?.summary != null);
  if (completed.length === 0) return null;

  const lastSeg = completed[completed.length - 1];
  const lastSegIdx = segments.lastIndexOf(lastSeg);

  const pendingPosts: ScrapedPost[] = [...lastSeg.posts];
  const pendingTokens = pendingPosts.reduce(
    (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
    0,
  );

  // Always start from the last segment's state so new pages can be merged
  const mergeBase: DynamicResumeState = {
    fromPage: lastSeg.endPage + 1,
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
        fromPage: lastSeg.endPage + 1,
        segmentIndex: lastSegIdx + 1,
        pendingPosts: [],
        pendingTokens: 0,
        pendingStartPage: lastSeg.endPage + 1,
      };
    }
  }
  return mergeBase;
}
