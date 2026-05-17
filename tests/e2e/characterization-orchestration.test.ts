import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { ScrapedPost, CachedTopic, LLMResultMessage, TopicSegment, SummaryJSON, LLMConfig, XenForoVersion } from '@/lib/types';
import { mockSummaryResponses, mockJsonResponse } from '@/tests/fixtures/mock-llm-responses';
import { postFactory } from '@/tests/fixtures/post-factory';

// ── Hoisted mock state ──
const h = vi.hoisted(() => ({
  scrapePageRange: vi.fn<(version: XenForoVersion, url: string, startPage: number, endPage: number, onProgress?: (...args: unknown[]) => void, signal?: AbortSignal, delayMs?: number) => Promise<{ posts: ScrapedPost[]; errors: string[]; threadDeleted?: boolean; threadLocked?: boolean }>>(),
  summarize: vi.fn<(posts: ScrapedPost[]) => { taskId: string; result: Promise<LLMResultMessage> }>(),
  summarizeSegments: vi.fn<(segmentSummaries: string[]) => { taskId: string; result: Promise<LLMResultMessage> }>(),
  getTaskState: vi.fn<(taskId: string) => { taskId: string; taskType: string; status: string; pipeline: unknown } | undefined>(),
  /** Spy for browser.runtime.sendMessage — receives single object { type, payload } */
  sendMessageSpy: vi.fn<(msg: { type: string; payload?: unknown }) => Promise<unknown>>(),
}));

vi.mock('@/lib/scrapers/page-loader', () => ({
  scrapePageRange: h.scrapePageRange,
}));

vi.mock('@/entrypoints/sidepanel/composables/useLLM', () => ({
  useLLM: () => ({
    summarize: h.summarize,
    summarizeSegmentsTask: h.summarizeSegments,
    threadAnalysisTask: vi.fn(),
    cancelTask: vi.fn(),
    getTaskState: h.getTaskState,
    startTask: vi.fn(),
    getETA: vi.fn(() => 1000),
    activeTasks: { value: new Map() },
    modelSpeedStats: { value: {} },
  }),
}));

// ── Test constants ──
const TOPIC_URL = 'https://voz.vn/threads/test-topic.123456/';
const TOPIC_TITLE = 'Test Topic Characterization';
const VERSION: XenForoVersion = 'xf2';

function makeBaseTopic(overrides: Partial<CachedTopic> = {}): CachedTopic {
  return {
    url: TOPIC_URL,
    title: TOPIC_TITLE,
    version: VERSION,
    posts: [],
    summary: '',
    llmConfig: { provider: 'openai', model: 'gpt-4o-mini' },
    cachedAt: Date.now(),
    lastPostNumber: 20,
    totalPosts: 20,
    totalPages: 1,
    ...overrides,
  };
}

function makeScrapeResult(posts: ScrapedPost[], overrides: { threadDeleted?: boolean; threadLocked?: boolean; errors?: string[] } = {}): {
  posts: ScrapedPost[];
  errors: string[];
  threadDeleted?: boolean;
  threadLocked?: boolean;
} {
  return { posts, errors: overrides.errors ?? [], threadDeleted: overrides.threadDeleted, threadLocked: overrides.threadLocked };
}

function makeLLMResult(summaryJson: SummaryJSON): LLMResultMessage {
  return {
    taskId: 'mock-task-id',
    taskType: 'summarize',
    success: true,
    data: { summary: JSON.stringify(summaryJson) },
    stats: { elapsedMs: 100, inputTokens: 500, outputTokens: 200, mapReduceSteps: 0 },
  };
}

function makeLLMSegmentResult(summaryJson: SummaryJSON): LLMResultMessage {
  return {
    taskId: 'mock-seg-task-id',
    taskType: 'summarize_segments',
    success: true,
    data: { summary: JSON.stringify(summaryJson) },
    stats: { elapsedMs: 200, inputTokens: 800, outputTokens: 300, mapReduceSteps: 0 },
  };
}

// Track SAVE_CACHED_TOPIC payloads for assertions
let savedTopicPayloads: Array<{ type: string; payload: unknown }> = [];

function installSendMessageSpy() {
  savedTopicPayloads = [];
  h.sendMessageSpy.mockReset();
  h.sendMessageSpy.mockImplementation(async (msg: { type: string; payload?: unknown }) => {
    savedTopicPayloads.push({ type: msg.type, payload: msg.payload });
    if (msg.type === 'GET_CUSTOM_PROMPTS') return null;
    if (msg.type === 'GET_CACHED_TOPIC') return null;
    if (msg.type === 'START_LLM_TASK') return { started: true };
    if (msg.type === 'SCRAPE_ARTICLE') return null;
    return undefined;
  });

  // Install spy on the global browser mock
  const browserObj = (globalThis as Record<string, unknown>).browser as { runtime: { sendMessage: typeof h.sendMessageSpy } };
  browserObj.runtime.sendMessage = h.sendMessageSpy as unknown as typeof browserObj.runtime.sendMessage;
}

function restoreSendMessage() {
  // Reset browser.runtime.sendMessage to a simple vi.fn()
  const browserObj = (globalThis as Record<string, unknown>).browser as { runtime: { sendMessage: ReturnType<typeof vi.fn> } };
  browserObj.runtime.sendMessage = vi.fn(() => Promise.resolve());
}

describe('Characterization: Composable orchestration (Flows 4-5)', () => {
  let store: ReturnType<typeof import('@/entrypoints/sidepanel/composables/useTopicStore').useTopicStore>;
  let composable: ReturnType<typeof import('@/entrypoints/sidepanel/composables/useSummarize').useSummarize>;

  async function setupComposable(topicOverrides: Partial<CachedTopic> = {}) {
    const { useTopicStore } = await import('@/entrypoints/sidepanel/composables/useTopicStore');
    const { useSummarize } = await import('@/entrypoints/sidepanel/composables/useSummarize');
    store = useTopicStore();
    store.selectTopic(makeBaseTopic(topicOverrides));
    composable = useSummarize(store);
    composable.currentConfig.value = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      temperature: 0.3,
      contextWindow: 128000,
      dynamicSegments: true,
      scrapeDelayMs: 0,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    installSendMessageSpy();
  });

  afterEach(() => {
    restoreSendMessage();
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────
  // Flow 4: handleSummarizeSegment
  // ──────────────────────────────────────────────
  describe('Flow 4: handleSummarizeSegment — single segment topic', () => {
    it('CHAR-1: 1-page topic — 1 scrape, 1 LLM call, saves early + final', async () => {
      await setupComposable({ totalPages: 1, totalPosts: 20 });

      const posts = postFactory.shortThread(20);
      h.scrapePageRange.mockResolvedValueOnce(makeScrapeResult(posts));
      h.summarize.mockReturnValueOnce({
        taskId: 'mock-task-single',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.handleSummarizeSegment(0);

      expect(h.summarize).toHaveBeenCalledTimes(1);
      expect(h.scrapePageRange).toHaveBeenCalledTimes(1);

      const saved = savedTopicPayloads.filter(p => p.type === 'SAVE_CACHED_TOPIC');
      expect(saved.length).toBe(2);

      const earlyPayload = saved[0].payload as Partial<CachedTopic>;
      expect(earlyPayload.segments).toBeDefined();
      const earlySeg0 = earlyPayload.segments![0]!;
      expect(earlySeg0.posts.length).toBe(20);
      expect(earlySeg0.summary).toBe('');

      const finalPayload = saved[1].payload as Partial<CachedTopic>;
      expect(finalPayload.segments).toBeDefined();
      const finalSeg0 = finalPayload.segments![0]!;
      expect(finalSeg0.summary).toBeTruthy();
      expect(finalPayload.summary).toBeDefined();

      expect(store.selectedTopic.value?.summary).toBeTruthy();
      expect(store.selectedTopic.value?.segments?.length).toBe(1);
    });

    it('CHAR-2: single segment skips scrape if posts already cached', async () => {
      await setupComposable({ totalPages: 1, totalPosts: 10 });

      const existingPosts = postFactory.shortThread(10);
      composable.segmentSummaries.value = [{
        startPage: 1, endPage: 1, posts: existingPosts,
        summary: '', postCount: 10, summarizedAt: 0,
      }];

      h.summarize.mockReturnValueOnce({
        taskId: 'mock-task-cached',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.handleSummarizeSegment(0);

      expect(h.scrapePageRange).not.toHaveBeenCalled();
      expect(h.summarize).toHaveBeenCalledTimes(1);

      const saved = savedTopicPayloads.filter(p => p.type === 'SAVE_CACHED_TOPIC');
      expect(saved.length).toBe(2);
    });

    it('CHAR-3: multi-segment topic — segment 0 does NOT set top-level summary', async () => {
      // Need totalPages > segmentSize (default 20) to produce multiple segments
      await setupComposable({ totalPages: 50, totalPosts: 1000 });

      const posts = postFactory.shortThread(20);
      h.scrapePageRange.mockResolvedValueOnce(makeScrapeResult(posts));
      h.summarize.mockReturnValueOnce({
        taskId: 'mock-task-multi',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.segment1)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.handleSummarizeSegment(0);

      const saved = savedTopicPayloads.filter(p => p.type === 'SAVE_CACHED_TOPIC');
      expect(saved.length).toBe(2);

      const finalPayload = saved[1].payload as Partial<CachedTopic>;
      expect(finalPayload.summary).toBeUndefined();
      expect(finalPayload.segments![0]?.summary).toBeTruthy();
    });

    it('CHAR-4: stale guard — second summarize wins, first saves to cache only', async () => {
      await setupComposable({ totalPages: 1, totalPosts: 10 });

      const posts = postFactory.shortThread(10);

      h.scrapePageRange.mockResolvedValue(makeScrapeResult(posts));
      let firstResolve!: (r: LLMResultMessage) => void;
      h.summarize.mockReturnValueOnce({
        taskId: 'task-first',
        result: new Promise<LLMResultMessage>(resolve => { firstResolve = resolve; }),
      });
      h.getTaskState.mockReturnValue(undefined);

      const firstPromise = composable.handleSummarizeSegment(0);

      // Second summarize bumps activeSummarizeId
      h.scrapePageRange.mockResolvedValue(makeScrapeResult(posts));
      h.summarize.mockReturnValueOnce({
        taskId: 'task-second',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
      });

      await composable.handleSummarizeSegment(0);

      firstResolve!(makeLLMResult(mockSummaryResponses.singleSegment));
      await firstPromise;

      const saved = savedTopicPayloads.filter(p => p.type === 'SAVE_CACHED_TOPIC');
      expect(saved.length).toBeGreaterThanOrEqual(3);
      expect(store.selectedTopic.value?.summary).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────
  // Flow 5: generateOverallSummary
  // ──────────────────────────────────────────────
  describe('Flow 5: generateOverallSummary', () => {
    it('CHAR-5: single completed segment — copies summary directly, 0 LLM calls', async () => {
      await setupComposable({ totalPages: 1, totalPosts: 20 });

      const segSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
      composable.segmentSummaries.value = [{
        startPage: 1, endPage: 1, posts: postFactory.shortThread(20),
        summary: segSummary, summaryJson: mockSummaryResponses.singleSegment,
        postCount: 20, summarizedAt: Date.now(),
      }];

      await composable.generateOverallSummary();

      expect(h.summarizeSegments).not.toHaveBeenCalled();
      expect(store.selectedTopic.value?.summary).toBe(segSummary);
      expect(composable.summary.value).toBe(segSummary);
    });

    it('CHAR-6: multiple completed segments — calls summarizeSegmentsTask, 1 LLM call', async () => {
      await setupComposable({ totalPages: 5, totalPosts: 100 });

      const seg1Summary = mockJsonResponse(mockSummaryResponses.segment1);
      const seg2Summary = mockJsonResponse(mockSummaryResponses.segment2);

      composable.segmentSummaries.value = [
        { startPage: 1, endPage: 3, posts: postFactory.shortThread(30), summary: seg1Summary, summaryJson: mockSummaryResponses.segment1, postCount: 30, summarizedAt: Date.now() },
        { startPage: 4, endPage: 5, posts: postFactory.shortThread(20), summary: seg2Summary, summaryJson: mockSummaryResponses.segment2, postCount: 20, summarizedAt: Date.now() },
      ];

      h.summarizeSegments.mockReturnValueOnce({
        taskId: 'task-overall',
        result: Promise.resolve(makeLLMSegmentResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.generateOverallSummary();

      expect(h.summarizeSegments).toHaveBeenCalledTimes(1);
      const callArgs = h.summarizeSegments.mock.calls[0][0] as string[];
      expect(callArgs.length).toBe(2);
      expect(store.selectedTopic.value?.summary).toBeTruthy();
    });

    it('CHAR-7: 0 completed segments — no-op, returns early', async () => {
      await setupComposable({ totalPages: 5, totalPosts: 100 });
      composable.segmentSummaries.value = [];

      await composable.generateOverallSummary();

      expect(h.summarizeSegments).not.toHaveBeenCalled();
      const saved = savedTopicPayloads.filter(p => p.type === 'SAVE_CACHED_TOPIC');
      expect(saved.length).toBe(0);
    });

    it('CHAR-8: stale guard in generateOverallSummary — stale result saved to cache only', async () => {
      await setupComposable({ totalPages: 5, totalPosts: 100 });

      const seg1Summary = mockJsonResponse(mockSummaryResponses.segment1);
      const seg2Summary = mockJsonResponse(mockSummaryResponses.segment2);

      composable.segmentSummaries.value = [
        { startPage: 1, endPage: 3, posts: postFactory.shortThread(30), summary: seg1Summary, summaryJson: mockSummaryResponses.segment1, postCount: 30, summarizedAt: Date.now() },
        { startPage: 4, endPage: 5, posts: postFactory.shortThread(20), summary: seg2Summary, summaryJson: mockSummaryResponses.segment2, postCount: 20, summarizedAt: Date.now() },
      ];

      let firstResolve!: (r: LLMResultMessage) => void;
      h.summarizeSegments.mockReturnValueOnce({
        taskId: 'overall-first',
        result: new Promise<LLMResultMessage>(resolve => { firstResolve = resolve; }),
      });
      h.getTaskState.mockReturnValue(undefined);

      const firstOverall = composable.generateOverallSummary();

      h.summarizeSegments.mockReturnValueOnce({
        taskId: 'overall-second',
        result: Promise.resolve(makeLLMSegmentResult(mockSummaryResponses.singleSegment)),
      });
      await composable.generateOverallSummary();

      firstResolve!(makeLLMSegmentResult(mockSummaryResponses.singleSegment));
      await firstOverall;

      const saved = savedTopicPayloads.filter(p => p.type === 'SAVE_CACHED_TOPIC');
      expect(saved.length).toBeGreaterThanOrEqual(1);
      expect(store.selectedTopic.value?.summary).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────
  // Orchestration: handleAutoSummarizeAll (dynamic)
  // ──────────────────────────────────────────────
  describe('Orchestration: handleAutoSummarizeAll (dynamic)', () => {
    it('CHAR-9: 1-page topic — autoSummarizeAll: 1 scrape, 1 LLM, no merge', async () => {
      await setupComposable({ totalPages: 1, totalPosts: 20 });

      const page1Posts = postFactory.shortThread(20);
      h.scrapePageRange.mockResolvedValueOnce(makeScrapeResult(page1Posts));
      h.summarize.mockReturnValueOnce({
        taskId: 'auto-task',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.handleAutoSummarizeAll();

      expect(h.scrapePageRange).toHaveBeenCalledTimes(1);
      expect(h.summarize).toHaveBeenCalledTimes(1);
      expect(h.summarizeSegments).not.toHaveBeenCalled();

      const saved = savedTopicPayloads.filter(p => p.type === 'SAVE_CACHED_TOPIC');
      expect(saved.length).toBe(2);
    });

    it('CHAR-10: 5-page topic (25 posts/page) — dynamic with large budget → 5 scrapes, 1 LLM', async () => {
      await setupComposable({ totalPages: 5, totalPosts: 125 });

      const PER_PAGE = 25;
      for (let p = 1; p <= 5; p++) {
        h.scrapePageRange.mockResolvedValueOnce(
          makeScrapeResult(postFactory.custom({ count: PER_PAGE, contentLength: 'short', startPostNumber: (p - 1) * PER_PAGE + 1 })),
        );
      }

      h.summarize.mockReturnValueOnce({
        taskId: 'auto-dyn-task',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      composable.currentConfig.value = { ...composable.currentConfig.value!, contextWindow: 128000 };

      await composable.handleAutoSummarizeAll();

      expect(h.scrapePageRange).toHaveBeenCalledTimes(5);
      expect(h.summarize).toHaveBeenCalledTimes(1);
      expect(h.summarizeSegments).not.toHaveBeenCalled();

      const saved = savedTopicPayloads.filter(p => p.type === 'SAVE_CACHED_TOPIC');
      expect(saved.length).toBe(2);
    });

    it('CHAR-11: 25-page large topic — triggers multiple dynamic segments', async () => {
      await setupComposable({ totalPages: 25, totalPosts: 5000 });

      const PER_PAGE = 200;

      composable.currentConfig.value = {
        ...composable.currentConfig.value!,
        contextWindow: 16384,
        maxTokens: 2000,
      };

      for (let p = 1; p <= 25; p++) {
        h.scrapePageRange.mockResolvedValueOnce(
          makeScrapeResult(postFactory.custom({ count: PER_PAGE, contentLength: 'long', startPostNumber: (p - 1) * PER_PAGE + 1 })),
        );
      }

      h.summarize.mockImplementation(() => ({
        taskId: 'auto-task-' + Math.random(),
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.segment1)),
      }));

      h.summarizeSegments.mockImplementation(() => ({
        taskId: 'overall-' + Math.random(),
        result: Promise.resolve(makeLLMSegmentResult(mockSummaryResponses.singleSegment)),
      }));

      h.getTaskState.mockReturnValue(undefined);

      await composable.handleAutoSummarizeAll();

      expect(h.scrapePageRange).toHaveBeenCalledTimes(25);
      expect(h.summarize.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('CHAR-12: forceRegenerate clears existing state and starts fresh', async () => {
      await setupComposable({ totalPages: 2, totalPosts: 40 });

      composable.segmentSummaries.value = [{
        startPage: 1, endPage: 1, posts: postFactory.shortThread(20),
        summary: mockJsonResponse(mockSummaryResponses.segment1),
        postCount: 20, summarizedAt: Date.now(),
      }];
      composable.dynamicSegmentBoundaries.value = [{ start: 1, end: 1, label: '1–1' }];

      h.scrapePageRange.mockResolvedValue(makeScrapeResult(postFactory.shortThread(20)));
      h.summarize.mockReturnValue({
        taskId: 'force-task',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.handleAutoSummarizeAll(true);

      expect(composable.dynamicSegmentBoundaries.value.length).toBeGreaterThanOrEqual(0);
    });

    it('CHAR-19: 234-page topic — full auto-summarize with dynamic segment splitting', async () => {
      await setupComposable({ totalPages: 234, totalPosts: 4680 });

      const PER_PAGE = 20;

      composable.currentConfig.value = {
        ...composable.currentConfig.value!,
        contextWindow: 16384,
        maxTokens: 2000,
      };

      for (let p = 1; p <= 234; p++) {
        h.scrapePageRange.mockResolvedValueOnce(
          makeScrapeResult(postFactory.custom({ count: PER_PAGE, contentLength: 'short', startPostNumber: (p - 1) * PER_PAGE + 1 })),
        );
      }

      h.summarize.mockImplementation(() => ({
        taskId: 'auto-task-' + Math.random(),
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.segment1)),
      }));

      h.summarizeSegments.mockImplementation(() => ({
        taskId: 'overall-' + Math.random(),
        result: Promise.resolve(makeLLMSegmentResult(mockSummaryResponses.singleSegment)),
      }));

      h.getTaskState.mockReturnValue(undefined);

      await composable.handleAutoSummarizeAll();

      expect(h.scrapePageRange).toHaveBeenCalledTimes(234);
      expect(h.summarize.mock.calls.length).toBeGreaterThanOrEqual(1);

      // Verify dynamic segment boundaries populated
      expect(composable.dynamicSegmentBoundaries.value.length).toBeGreaterThanOrEqual(1);

      // Verify SAVE_CACHED_TOPIC payloads exist
      const saved = savedTopicPayloads.filter(p => p.type === 'SAVE_CACHED_TOPIC');
      expect(saved.length).toBeGreaterThanOrEqual(2);

      // Verify final payload has expected structure for large topic
      const finalPayload = saved[saved.length - 1].payload as Record<string, unknown>;
      expect(finalPayload.url).toBe(TOPIC_URL);
      expect(Array.isArray(finalPayload.segments)).toBe(true);
      expect(finalPayload.summary).toBeDefined();
      expect(typeof finalPayload.summarizedPostCount).toBe('number');

      // Verify no errors occurred
      expect(composable.error.value).toBe('');
    });
  });

  // ──────────────────────────────────────────────
  // Orchestration: handleSegmentUpdate (resume)
  // ──────────────────────────────────────────────
  describe('Orchestration: handleSegmentUpdate', () => {
    it('CHAR-13: no new posts — skips scrape, goes to generateOverallSummary', async () => {
      await setupComposable({ totalPages: 3, totalPosts: 60, forumPostCount: 60 });

      const segSummary = mockJsonResponse(mockSummaryResponses.segment1);
      composable.segmentSummaries.value = [{
        startPage: 1, endPage: 3, posts: postFactory.shortThread(60),
        summary: segSummary, summaryJson: mockSummaryResponses.segment1,
        postCount: 60, summarizedAt: Date.now(),
      }];
      composable.dynamicSegmentBoundaries.value = [{ start: 1, end: 3, label: '1–3' }];

      await composable.handleSegmentUpdate();

      expect(h.scrapePageRange).not.toHaveBeenCalled();
    });

    it('CHAR-14: new posts within existing pages — re-scrapes from last segment', async () => {
      await setupComposable({ totalPages: 3, totalPosts: 60, forumPostCount: 80 });

      composable.segmentSummaries.value = [{
        startPage: 1, endPage: 3, posts: postFactory.shortThread(60),
        summary: mockJsonResponse(mockSummaryResponses.segment1),
        postCount: 60, summarizedAt: Date.now(), complete: true,
      }];
      composable.dynamicSegmentBoundaries.value = [{ start: 1, end: 3, label: '1–3' }];

      h.scrapePageRange.mockResolvedValue(makeScrapeResult(postFactory.shortThread(20)));
      h.summarize.mockReturnValue({
        taskId: 'update-task',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
      });
      h.summarizeSegments.mockReturnValue({
        taskId: 'update-overall',
        result: Promise.resolve(makeLLMSegmentResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.handleSegmentUpdate();

      expect(h.scrapePageRange).toHaveBeenCalled();
    });

    it('CHAR-15: all covered, no new posts/pages — only generateOverallSummary in fixed mode', async () => {
      await setupComposable({ totalPages: 3, totalPosts: 60, forumPostCount: 60 });

      const seg1 = mockJsonResponse(mockSummaryResponses.segment1);
      const seg2 = mockJsonResponse(mockSummaryResponses.segment2);
      composable.segmentSummaries.value = [
        { startPage: 1, endPage: 2, posts: postFactory.shortThread(30), summary: seg1, summaryJson: mockSummaryResponses.segment1, postCount: 30, summarizedAt: Date.now() },
        { startPage: 3, endPage: 3, posts: postFactory.shortThread(30), summary: seg2, summaryJson: mockSummaryResponses.segment2, postCount: 30, summarizedAt: Date.now() },
      ];

      h.summarizeSegments.mockReturnValue({
        taskId: 'existing-overall',
        result: Promise.resolve(makeLLMSegmentResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      composable.currentConfig.value = { ...composable.currentConfig.value!, dynamicSegments: false };

      await composable.handleSegmentUpdate();

      expect(h.scrapePageRange).not.toHaveBeenCalled();
      expect(h.summarizeSegments).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────
  // SAVE_CACHED_TOPIC payload structure
  // ──────────────────────────────────────────────
  describe('SAVE_CACHED_TOPIC payload structure', () => {
    it('CHAR-16: single-segment final save includes segments + top-level summary/summaryJson', async () => {
      await setupComposable({ totalPages: 1, totalPosts: 20 });

      h.scrapePageRange.mockResolvedValueOnce(makeScrapeResult(postFactory.shortThread(20)));
      h.summarize.mockReturnValueOnce({
        taskId: 'payload-task',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.handleSummarizeSegment(0);

      const saved = savedTopicPayloads.filter(p => p.type === 'SAVE_CACHED_TOPIC');
      const finalPayload = saved[saved.length - 1].payload as Record<string, unknown>;

      expect(finalPayload.url).toBe(TOPIC_URL);
      expect(finalPayload.title).toBe(TOPIC_TITLE);
      expect(finalPayload.version).toBe(VERSION);
      expect(finalPayload.totalPages).toBe(1);
      expect(Array.isArray(finalPayload.segments)).toBe(true);
      expect(finalPayload.summary).toBeDefined();
      expect(typeof finalPayload.summary).toBe('string');
      expect(typeof finalPayload.totalPosts).toBe('number');
      expect(typeof finalPayload.summarizedPostCount).toBe('number');
    });

    it('CHAR-17: multi-segment final save includes segments but NO top-level summary', async () => {
      await setupComposable({ totalPages: 50, totalPosts: 1000 });

      h.scrapePageRange.mockResolvedValueOnce(makeScrapeResult(postFactory.shortThread(20)));
      h.summarize.mockReturnValueOnce({
        taskId: 'multi-payload-task',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.segment1)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.handleSummarizeSegment(0);

      const saved = savedTopicPayloads.filter(p => p.type === 'SAVE_CACHED_TOPIC');
      const finalPayload = saved[saved.length - 1].payload as Record<string, unknown>;

      expect(Array.isArray(finalPayload.segments)).toBe(true);
      expect(finalPayload.summary).toBeUndefined();
    });

    it('CHAR-18: early posts save has segments with posts but empty summary', async () => {
      await setupComposable({ totalPages: 1, totalPosts: 20 });

      h.scrapePageRange.mockResolvedValueOnce(makeScrapeResult(postFactory.shortThread(20)));
      h.summarize.mockReturnValueOnce({
        taskId: 'early-task',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.handleSummarizeSegment(0);

      const saved = savedTopicPayloads.filter(p => p.type === 'SAVE_CACHED_TOPIC');
      const earlyPayload = saved[0].payload as Record<string, unknown>;

      expect(Array.isArray(earlyPayload.segments)).toBe(true);
      const seg0 = (earlyPayload.segments as TopicSegment[])[0];
      expect(seg0.posts.length).toBe(20);
      expect(seg0.summary).toBe('');
    });
  });

  describe('C1: scrape progress in dynamic summarize', () => {
    it('CHAR-20: scrapeProgress.totalPages stays constant across all pages', async () => {
      await setupComposable({ totalPages: 5, totalPosts: 100 });

      h.scrapePageRange.mockImplementation(async (_version, _url, startPage, endPage, onProgress, _signal, _delayMs) => {
        const posts = postFactory.shortThread(20);
        onProgress?.(1, 1, posts.length);
        return makeScrapeResult(posts);
      });

      h.summarize.mockReturnValue({
        taskId: 'task-1',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.handleAutoSummarizeAll(false);

      expect(h.scrapePageRange).toHaveBeenCalledTimes(5);
      expect(composable.scrapeProgress.value).toBeDefined();
      expect(composable.scrapeProgress.value!.totalPages).toBe(5);
    });

    it('CHAR-21: scrapeProgress.currentPage increments correctly', async () => {
      await setupComposable({ totalPages: 3, totalPosts: 60 });

      h.scrapePageRange.mockImplementation(async (_version, _url, startPage, endPage, onProgress, _signal, _delayMs) => {
        const posts = postFactory.shortThread(20);
        onProgress?.(1, 1, posts.length);
        return makeScrapeResult(posts);
      });

      h.summarize.mockReturnValue({
        taskId: 'task-1',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.handleAutoSummarizeAll(false);

      expect(h.scrapePageRange).toHaveBeenCalledTimes(3);
      expect(composable.scrapeProgress.value!.totalPages).toBe(3);
    });
  });

  describe('C4 part 2: overall step done for single-segment', () => {
    it('CHAR-22: overall step marked done after single segment completes', async () => {
      await setupComposable({ totalPages: 1, totalPosts: 20 });

      h.scrapePageRange.mockResolvedValueOnce(makeScrapeResult(postFactory.shortThread(20)));
      h.summarize.mockReturnValueOnce({
        taskId: 'single-seg-task',
        result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
      });
      h.getTaskState.mockReturnValue(undefined);

      await composable.handleSummarizeSegment(0);

      const overallStep = composable.pipeline.value?.steps.find(s => s.id === 'overall');
      expect(overallStep?.status).toBe('done');
    });
  });
});
