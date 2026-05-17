import { vi, expect, type Mock } from 'vitest';
import type { ScrapedPost, TopicSegment, CachedTopic, XenForoVersion, PipelineStep, PipelineDefinition, SummaryJSON } from '@/lib/types';
import type { ScrapeProgress } from '@/entrypoints/sidepanel/composables/useTopicScraper';
import type { SegmentSavePayload } from '@/lib/segment-persistence';

// ── Mock Scraper ──────────────────────────────────────────────────────────────

export interface MockScraperOptions {
  defaultPosts?: ScrapedPost[];
  defaultErrors?: string[];
  defaultThreadDeleted?: boolean;
  defaultThreadLocked?: boolean;
  delayMs?: number;
}

type ScrapePageRangeFn = (version: XenForoVersion, url: string, startPage: number, endPage: number, onProgress?: (...args: unknown[]) => void, signal?: AbortSignal, delayMs?: number) => Promise<{ posts: ScrapedPost[]; errors: string[]; threadDeleted?: boolean; threadLocked?: boolean }>;
type ScrapeRangeFn = (version: XenForoVersion, baseUrl: string, startPage: number, endPage: number, delayMs?: number) => Promise<{ posts: ScrapedPost[]; errors: string[]; threadDeleted?: boolean; threadLocked?: boolean }>;
type EnrichWithNewsArticlesFn = (posts: ScrapedPost[], topicUrl: string, callbacks?: { onStatus: (msg: string) => void; onInfo: (msg: string) => void }) => Promise<ScrapedPost[]>;

export interface MockScraper {
  scrapePageRange: Mock<ScrapePageRangeFn>;
  scrapeRange: Mock<ScrapeRangeFn>;
  abortScrape: Mock<() => void>;
  enrichWithNewsArticles: Mock<EnrichWithNewsArticlesFn>;
  isScraping: { value: boolean };
  scrapeProgress: { value: ScrapeProgress | null };
  scrapingWarnings: { value: string[] };
  scrapingInfo: { value: string[] };
}

export function createMockScraper(options: MockScraperOptions = {}): MockScraper {
  const {
    defaultPosts = [],
    defaultErrors = [],
    defaultThreadDeleted = false,
    defaultThreadLocked = false,
    delayMs = 0,
  } = options;

  const scrapePageRange = vi.fn<
    (version: XenForoVersion, url: string, startPage: number, endPage: number, onProgress?: (...args: unknown[]) => void, signal?: AbortSignal, delayMs?: number) => Promise<{ posts: ScrapedPost[]; errors: string[]; threadDeleted?: boolean; threadLocked?: boolean }>
  >(async (_version, _url, startPage, endPage, onProgress, _signal, _delayMs) => {
    if (delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
    onProgress?.(endPage - startPage + 1, endPage - startPage + 1, defaultPosts.length);
    return {
      posts: defaultPosts,
      errors: defaultErrors,
      threadDeleted: defaultThreadDeleted,
      threadLocked: defaultThreadLocked,
    };
  });

  const scrapeRange = vi.fn<
    (version: XenForoVersion, baseUrl: string, startPage: number, endPage: number, delayMs?: number) => Promise<{ posts: ScrapedPost[]; errors: string[]; threadDeleted?: boolean; threadLocked?: boolean }>
  >(async () => ({
    posts: defaultPosts,
    errors: defaultErrors,
    threadDeleted: defaultThreadDeleted,
    threadLocked: defaultThreadLocked,
  }));

  const abortScrape = vi.fn<() => void>(() => {});

  const enrichWithNewsArticles = vi.fn<
    (posts: ScrapedPost[], topicUrl: string, callbacks?: { onStatus: (msg: string) => void; onInfo: (msg: string) => void }) => Promise<ScrapedPost[]>
  >(async (posts) => posts);

  const isScraping = { value: false };
  const scrapeProgress = { value: null as ScrapeProgress | null };
  const scrapingWarnings = { value: [] as string[] };
  const scrapingInfo = { value: [] as string[] };

  return {
    scrapePageRange,
    scrapeRange,
    abortScrape,
    enrichWithNewsArticles,
    isScraping,
    scrapeProgress,
    scrapingWarnings,
    scrapingInfo,
  };
}

// ── Mock Segment ──────────────────────────────────────────────────────────────

export interface MockSegmentOptions {
  startPage?: number;
  endPage?: number;
  posts?: ScrapedPost[];
  summary?: string;
  summaryJson?: SummaryJSON;
  postCount?: number;
  complete?: boolean;
  summarizedAt?: number;
}

export function createMockSegment(options: MockSegmentOptions = {}): TopicSegment {
  const {
    startPage = 1,
    endPage = 20,
    posts = [],
    summary = 'Mock segment summary',
    summaryJson,
    postCount = posts.length || 20,
    complete = true,
    summarizedAt = Date.now(),
  } = options;

  return {
    startPage,
    endPage,
    posts,
    summary,
    summaryJson: summaryJson ?? {
      summary,
      opinions: [],
      conclusion: 'Mock conclusion',
    },
    postCount,
    complete,
    summarizedAt,
  };
}

// ── Stale Payload Builder ─────────────────────────────────────────────────────

/**
 * Build a payload that simulates a stale/empty segment save —
 * i.e., has metadata but no summary fields.
 */
export function buildStalePayload(overrides: Partial<SegmentSavePayload> = {}): SegmentSavePayload {
  return {
    url: 'https://example.com/thread/123/',
    title: 'Stale Thread',
    version: 'xf2' as XenForoVersion,
    totalPages: 5,
    forumPostCount: 100,
    totalPosts: 100,
    summarizedPostCount: 0,
    segments: [],
    ...overrides,
  };
}

// ── Progress Assertions ───────────────────────────────────────────────────────

export interface ExpectedProgress {
  currentPage?: number;
  totalPages?: number;
  postsScraped?: number;
}

export function assertProgress(
  actual: ScrapeProgress | null | undefined,
  expected: ExpectedProgress,
): void {
  expect(actual).toBeDefined();
  expect(actual).not.toBeNull();
  const p = actual as ScrapeProgress;

  if (expected.currentPage !== undefined) {
    expect(p.currentPage).toBe(expected.currentPage);
  }
  if (expected.totalPages !== undefined) {
    expect(p.totalPages).toBe(expected.totalPages);
  }
  if (expected.postsScraped !== undefined) {
    expect(p.postsScraped).toBe(expected.postsScraped);
  }
}

// ── Pipeline Step Assertions ──────────────────────────────────────────────────

export interface ExpectedPipelineStep {
  id: string;
  status?: 'pending' | 'running' | 'done' | 'error';
}

export function assertPipelineSteps(
  actual: PipelineStep[] | PipelineDefinition | null | undefined,
  expected: ExpectedPipelineStep[],
): void {
  const steps: PipelineStep[] = Array.isArray(actual) ? actual : actual?.steps ?? [];
  expect(steps.length).toBe(expected.length);

  for (let i = 0; i < expected.length; i++) {
    expect(steps[i].id).toBe(expected[i].id);
    if (expected[i].status !== undefined) {
      expect(steps[i].status).toBe(expected[i].status);
    }
  }
}

// ── Segment Completed Predicate ───────────────────────────────────────────────

export function isSegmentCompleted(seg: TopicSegment | null | undefined): boolean {
  return seg != null && seg.summary != null && seg.summary.length > 0;
}

// ── Mock CachedTopic ──────────────────────────────────────────────────────────

export interface MockTopicOptions {
  url?: string;
  title?: string;
  version?: XenForoVersion;
  totalPages?: number;
  totalPosts?: number;
  lastPostNumber?: number;
  segments?: TopicSegment[];
  summary?: string;
  llmConfig?: { provider: string; model: string };
  cachedAt?: number;
}

export function createMockCachedTopic(options: MockTopicOptions = {}): CachedTopic {
  const {
    url = 'https://example.com/thread/123/',
    title = 'Mock Topic',
    version = 'xf2',
    totalPages = 1,
    totalPosts = 20,
    lastPostNumber = 20,
    segments,
    summary = '',
    llmConfig = { provider: 'openai', model: 'gpt-4o-mini' },
    cachedAt = Date.now(),
  } = options;

  const base: Omit<CachedTopic, 'segments'> = {
    url,
    title,
    version,
    posts: [],
    summary,
    llmConfig,
    cachedAt,
    lastPostNumber,
    totalPosts,
    totalPages,
  };

  if (segments !== undefined) {
    return { ...base, segments };
  }
  return base;
}
