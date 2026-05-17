import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ScrapedPost, TopicSegment, PipelineStep, PipelineDefinition, XenForoVersion, SummaryJSON, PipelineWorkflow } from '@/lib/types';
import type { ScrapeProgress } from '@/entrypoints/sidepanel/composables/useTopicScraper';
import {
  createMockScraper,
  createMockSegment,
  buildStalePayload,
  assertProgress,
  assertPipelineSteps,
  isSegmentCompleted,
  createMockCachedTopic,
} from '@/tests/utils/testHelpers';
import {
  createScraperMockState,
  createPageLoaderMock,
  createTopicScraperMock,
  createPipelineMockState,
  createPipelineBuilderMock,
  createUsePipelineMock,
} from '@/tests/mocks/mock-scraper-pipeline';

// ── createMockScraper ─────────────────────────────────────────────────────────

describe('createMockScraper', () => {
  it('returns mock scraper with default values', () => {
    const scraper = createMockScraper();
    expect(scraper.scrapePageRange).toBeDefined();
    expect(scraper.scrapeRange).toBeDefined();
    expect(scraper.abortScrape).toBeDefined();
    expect(scraper.enrichWithNewsArticles).toBeDefined();
    expect(scraper.isScraping.value).toBe(false);
    expect(scraper.scrapeProgress.value).toBeNull();
    expect(scraper.scrapingWarnings.value).toEqual([]);
    expect(scraper.scrapingInfo.value).toEqual([]);
  });

  it('returns configured default posts', async () => {
    const posts: ScrapedPost[] = [
      { author: 'user1', content: 'hello', postNumber: 1, timestamp: '2024-01-01T00:00:00Z' },
    ];
    const scraper = createMockScraper({ defaultPosts: posts });
    const result = await scraper.scrapePageRange('xf2', 'https://example.com/', 1, 1);
    expect(result.posts).toEqual(posts);
  });

  it('calls onProgress callback', async () => {
    const posts: ScrapedPost[] = [
      { author: 'user1', content: 'hello', postNumber: 1, timestamp: '2024-01-01T00:00:00Z' },
    ];
    const scraper = createMockScraper({ defaultPosts: posts });
    const onProgress = vi.fn();
    await scraper.scrapePageRange('xf2', 'https://example.com/', 1, 3, onProgress);
    expect(onProgress).toHaveBeenCalledWith(3, 3, 1);
  });

  it('respects threadDeleted/threadLocked flags', async () => {
    const scraper = createMockScraper({ defaultThreadDeleted: true, defaultThreadLocked: true });
    const result = await scraper.scrapePageRange('xf2', 'https://example.com/', 1, 1);
    expect(result.threadDeleted).toBe(true);
    expect(result.threadLocked).toBe(true);
  });

  it('scrapeRange returns configured defaults', async () => {
    const posts: ScrapedPost[] = [{ author: 'u', content: 'c', postNumber: 1, timestamp: '2024-01-01T00:00:00Z' }];
    const scraper = createMockScraper({ defaultPosts: posts, defaultErrors: ['err1'] });
    const result = await scraper.scrapeRange('xf2', 'https://example.com/', 1, 2);
    expect(result.posts).toEqual(posts);
    expect(result.errors).toEqual(['err1']);
  });

  it('enrichWithNewsArticles returns posts unchanged', async () => {
    const scraper = createMockScraper();
    const posts: ScrapedPost[] = [{ author: 'u', content: 'c', postNumber: 1, timestamp: '2024-01-01T00:00:00Z' }];
    const result = await scraper.enrichWithNewsArticles(posts, 'https://example.com/');
    expect(result).toEqual(posts);
  });
});

// ── createMockSegment ─────────────────────────────────────────────────────────

describe('createMockSegment', () => {
  it('creates segment with defaults', () => {
    const seg = createMockSegment();
    expect(seg.startPage).toBe(1);
    expect(seg.endPage).toBe(20);
    expect(seg.summary).toBe('Mock segment summary');
    expect(seg.complete).toBe(true);
    expect(seg.postCount).toBe(20);
    expect(seg.summaryJson).toBeDefined();
    expect(seg.summaryJson?.summary).toBe('Mock segment summary');
  });

  it('accepts overrides', () => {
    const posts: ScrapedPost[] = [{ author: 'u', content: 'c', postNumber: 1, timestamp: '2024-01-01T00:00:00Z' }];
    const summaryJson: SummaryJSON = { summary: 'custom', opinions: [], conclusion: 'c' };
    const seg = createMockSegment({
      startPage: 5,
      endPage: 10,
      posts,
      summary: 'custom summary',
      summaryJson,
      postCount: 6,
      complete: false,
    });
    expect(seg.startPage).toBe(5);
    expect(seg.endPage).toBe(10);
    expect(seg.posts).toEqual(posts);
    expect(seg.summary).toBe('custom summary');
    expect(seg.summaryJson).toBe(summaryJson);
    expect(seg.postCount).toBe(6);
    expect(seg.complete).toBe(false);
  });

  it('uses posts.length as postCount when not specified', () => {
    const posts: ScrapedPost[] = [
      { author: 'u1', content: 'c', postNumber: 1, timestamp: '2024-01-01T00:00:00Z' },
      { author: 'u2', content: 'c', postNumber: 2, timestamp: '2024-01-01T00:00:00Z' },
    ];
    const seg = createMockSegment({ posts });
    expect(seg.postCount).toBe(2);
  });
});

// ── buildStalePayload ─────────────────────────────────────────────────────────

describe('buildStalePayload', () => {
  it('creates payload without summary fields', () => {
    const payload = buildStalePayload();
    expect(payload.url).toBe('https://example.com/thread/123/');
    expect(payload.title).toBe('Stale Thread');
    expect(payload.version).toBe('xf2');
    expect(payload.totalPages).toBe(5);
    expect(payload.forumPostCount).toBe(100);
    expect(payload.totalPosts).toBe(100);
    expect(payload.summarizedPostCount).toBe(0);
    expect(payload.segments).toEqual([]);
    expect(payload.summary).toBeUndefined();
    expect(payload.summaryJson).toBeUndefined();
  });

  it('accepts overrides', () => {
    const payload = buildStalePayload({
      url: 'https://custom.com/',
      totalPages: 10,
      summarizedPostCount: 50,
      segments: [createMockSegment()],
    });
    expect(payload.url).toBe('https://custom.com/');
    expect(payload.totalPages).toBe(10);
    expect(payload.summarizedPostCount).toBe(50);
    expect(payload.segments.length).toBe(1);
  });
});

// ── assertProgress ────────────────────────────────────────────────────────────

describe('assertProgress', () => {
  it('passes when progress matches expected', () => {
    const progress: ScrapeProgress = { currentPage: 3, totalPages: 5, postsScraped: 60 };
    expect(() => assertProgress(progress, { currentPage: 3, totalPages: 5, postsScraped: 60 })).not.toThrow();
  });

  it('passes when only subset of fields checked', () => {
    const progress: ScrapeProgress = { currentPage: 3, totalPages: 5, postsScraped: 60 };
    expect(() => assertProgress(progress, { currentPage: 3 })).not.toThrow();
  });

  it('throws when currentPage mismatches', () => {
    const progress: ScrapeProgress = { currentPage: 3, totalPages: 5, postsScraped: 60 };
    expect(() => assertProgress(progress, { currentPage: 4 })).toThrow();
  });

  it('throws when totalPages mismatches', () => {
    const progress: ScrapeProgress = { currentPage: 3, totalPages: 5, postsScraped: 60 };
    expect(() => assertProgress(progress, { totalPages: 10 })).toThrow();
  });

  it('throws when postsScraped mismatches', () => {
    const progress: ScrapeProgress = { currentPage: 3, totalPages: 5, postsScraped: 60 };
    expect(() => assertProgress(progress, { postsScraped: 100 })).toThrow();
  });

  it('throws when progress is null', () => {
    expect(() => assertProgress(null, { currentPage: 1 })).toThrow();
  });

  it('throws when progress is undefined', () => {
    expect(() => assertProgress(undefined, { currentPage: 1 })).toThrow();
  });
});

// ── assertPipelineSteps ───────────────────────────────────────────────────────

describe('assertPipelineSteps', () => {
  it('passes when steps match expected', () => {
    const steps: PipelineStep[] = [
      { id: 'scrape', label: 'Scrape', status: 'done' },
      { id: 'summarize', label: 'Summarize', status: 'running' },
      { id: 'overall', label: 'Overall', status: 'pending' },
    ];
    expect(() => assertPipelineSteps(steps, [
      { id: 'scrape', status: 'done' },
      { id: 'summarize', status: 'running' },
      { id: 'overall' },
    ])).not.toThrow();
  });

  it('accepts PipelineDefinition', () => {
    const pipeline: PipelineDefinition = {
      workflow: 'summarize',
      steps: [
        { id: 'scrape', label: 'Scrape', status: 'pending' },
        { id: 'overall', label: 'Overall', status: 'pending' },
      ],
    };
    expect(() => assertPipelineSteps(pipeline, [
      { id: 'scrape' },
      { id: 'overall' },
    ])).not.toThrow();
  });

  it('throws when step count mismatches', () => {
    const steps: PipelineStep[] = [{ id: 'scrape', label: 'Scrape', status: 'pending' }];
    expect(() => assertPipelineSteps(steps, [
      { id: 'scrape' },
      { id: 'summarize' },
    ])).toThrow();
  });

  it('throws when step id mismatches', () => {
    const steps: PipelineStep[] = [{ id: 'scrape', label: 'Scrape', status: 'pending' }];
    expect(() => assertPipelineSteps(steps, [{ id: 'wrong' }])).toThrow();
  });

  it('throws when status mismatches', () => {
    const steps: PipelineStep[] = [{ id: 'scrape', label: 'Scrape', status: 'pending' }];
    expect(() => assertPipelineSteps(steps, [{ id: 'scrape', status: 'done' }])).toThrow();
  });

  it('handles null/undefined gracefully', () => {
    expect(() => assertPipelineSteps(null, [])).not.toThrow();
    expect(() => assertPipelineSteps(undefined, [])).not.toThrow();
  });
});

// ── isSegmentCompleted ────────────────────────────────────────────────────────

describe('isSegmentCompleted', () => {
  it('returns true for segment with summary', () => {
    const seg = createMockSegment({ summary: 'has content' });
    expect(isSegmentCompleted(seg)).toBe(true);
  });

  it('returns false for segment with empty summary', () => {
    const seg = createMockSegment({ summary: '' });
    expect(isSegmentCompleted(seg)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSegmentCompleted(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isSegmentCompleted(undefined)).toBe(false);
  });
});

// ── createMockCachedTopic ─────────────────────────────────────────────────────

describe('createMockCachedTopic', () => {
  it('creates topic with defaults', () => {
    const topic = createMockCachedTopic();
    expect(topic.url).toBe('https://example.com/thread/123/');
    expect(topic.title).toBe('Mock Topic');
    expect(topic.version).toBe('xf2');
    expect(topic.totalPages).toBe(1);
    expect(topic.totalPosts).toBe(20);
    expect(topic.lastPostNumber).toBe(20);
    expect(topic.summary).toBe('');
    expect(topic.llmConfig).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(topic.posts).toEqual([]);
  });

  it('accepts overrides', () => {
    const segments = [createMockSegment()];
    const topic = createMockCachedTopic({
      url: 'https://custom.com/',
      title: 'Custom Topic',
      version: 'xf1',
      totalPages: 10,
      totalPosts: 200,
      lastPostNumber: 150,
      segments,
      summary: 'existing summary',
      llmConfig: { provider: 'claude', model: 'claude-sonnet-4-20250514' },
    });
    expect(topic.url).toBe('https://custom.com/');
    expect(topic.title).toBe('Custom Topic');
    expect(topic.version).toBe('xf1');
    expect(topic.totalPages).toBe(10);
    expect(topic.totalPosts).toBe(200);
    expect(topic.lastPostNumber).toBe(150);
    expect(topic.segments).toEqual(segments);
    expect(topic.summary).toBe('existing summary');
    expect(topic.llmConfig).toEqual({ provider: 'claude', model: 'claude-sonnet-4-20250514' });
  });
});

// ── Mock Module Factories ─────────────────────────────────────────────────────

describe('createScraperMockState', () => {
  it('creates state with defaults', () => {
    const state = createScraperMockState();
    expect(state.defaultPosts).toEqual([]);
    expect(state.defaultErrors).toEqual([]);
    expect(state.defaultThreadDeleted).toBe(false);
    expect(state.defaultThreadLocked).toBe(false);
    expect(state.progressUpdates).toEqual([]);
  });

  it('accepts overrides', () => {
    const posts: ScrapedPost[] = [{ author: 'u', content: 'c', postNumber: 1, timestamp: '2024-01-01T00:00:00Z' }];
    const state = createScraperMockState({
      defaultPosts: posts,
      defaultErrors: ['err'],
      defaultThreadDeleted: true,
    });
    expect(state.defaultPosts).toEqual(posts);
    expect(state.defaultErrors).toEqual(['err']);
    expect(state.defaultThreadDeleted).toBe(true);
  });
});

describe('createPageLoaderMock', () => {
  it('returns mock with scrapePageRange', async () => {
    const state = createScraperMockState({ defaultPosts: [{ author: 'u', content: 'c', postNumber: 1, timestamp: '2024-01-01T00:00:00Z' }] });
    const mock = createPageLoaderMock(state);
    const onProgress = vi.fn();
    const result = await mock.scrapePageRange('xf2', 'https://example.com/', 1, 3, onProgress);
    expect(result.posts).toEqual(state.defaultPosts);
    expect(onProgress).toHaveBeenCalled();
    expect(state.progressUpdates.length).toBe(1);
  });
});

describe('createTopicScraperMock', () => {
  it('returns mock useTopicScraper factory', () => {
    const state = createScraperMockState();
    const mock = createTopicScraperMock(state);
    const instance = mock.useTopicScraper();
    expect(instance.isScraping).toBeDefined();
    expect(instance.scrapeProgress).toBeDefined();
    expect(instance.scrapeRange).toBeDefined();
    expect(instance.abortScrape).toBeDefined();
  });
});

describe('createPipelineMockState', () => {
  it('creates state with defaults', () => {
    const state = createPipelineMockState();
    expect(state.defaultSteps).toEqual([]);
    expect(state.defaultWorkflow).toBe('summarize');
  });
});

describe('createPipelineBuilderMock', () => {
  it('returns default steps when no custom steps provided', () => {
    const state = createPipelineMockState();
    const mock = createPipelineBuilderMock(state);
    const pipeline = mock.buildSummarizePipeline([{ start: 1, end: 20 }]);
    expect(pipeline.workflow).toBe('summarize');
    expect(pipeline.steps.length).toBe(3);
    expect(pipeline.steps[0].id).toBe('scrape');
    expect(pipeline.steps[1].id).toBe('summarize');
    expect(pipeline.steps[2].id).toBe('overall');
  });

  it('uses custom steps when provided', () => {
    const customSteps: PipelineStep[] = [{ id: 'custom', label: 'Custom', status: 'done' }];
    const state = createPipelineMockState({ defaultSteps: customSteps });
    const mock = createPipelineBuilderMock(state);
    const pipeline = mock.buildSummarizePipeline([{ start: 1, end: 20 }]);
    expect(pipeline.steps).toEqual(customSteps);
  });

  it('markStepDone updates step status', () => {
    const state = createPipelineMockState();
    const mock = createPipelineBuilderMock(state);
    const pipeline = mock.buildSummarizePipeline([{ start: 1, end: 20 }]);
    mock.markStepDone(pipeline, 'scrape');
    expect(pipeline.steps[0].status).toBe('done');
  });

  it('markStepRunning updates step status', () => {
    const state = createPipelineMockState();
    const mock = createPipelineBuilderMock(state);
    const pipeline = mock.buildSummarizePipeline([{ start: 1, end: 20 }]);
    mock.markStepRunning(pipeline, 'summarize');
    expect(pipeline.steps[1].status).toBe('running');
  });

  it('markNextStepRunning advances pipeline', () => {
    const state = createPipelineMockState();
    const mock = createPipelineBuilderMock(state);
    const pipeline = mock.buildSummarizePipeline([{ start: 1, end: 20 }]);
    mock.markNextStepRunning(pipeline, 'scrape');
    expect(pipeline.steps[0].status).toBe('done');
    expect(pipeline.steps[1].status).toBe('running');
  });
});

describe('createUsePipelineMock', () => {
  it('returns mock usePipeline factory', () => {
    const state = createPipelineMockState();
    const mock = createUsePipelineMock(state);
    const instance = mock.usePipeline();
    expect(instance.pipeline).toBeDefined();
    expect(instance.buildSummarizePipeline).toBeDefined();
    expect(instance.reconcile).toBeDefined();
  });
});
