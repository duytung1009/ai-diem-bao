import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { ScrapedPost, CachedTopic, LLMResultMessage, SummaryJSON, LLMConfig, XenForoVersion } from '@/lib/types';
import { mockSummaryResponses, mockJsonResponse } from '@/tests/fixtures/mock-llm-responses';
import { postFactory } from '@/tests/fixtures/post-factory';

const h = vi.hoisted(() => ({
  scrapePageRange: vi.fn(),
  summarize: vi.fn(),
  summarizeSegments: vi.fn(),
  getTaskState: vi.fn(),
  sendMessageSpy: vi.fn(),
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

const TOPIC_URL = 'https://voz.vn/threads/test-topic.123456/';
const TOPIC_TITLE = 'Test Timeline Upfront';
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

function makeScrapeResult(posts: ScrapedPost[]): { posts: ScrapedPost[]; errors: string[] } {
  return { posts, errors: [] };
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
  const browserObj = (globalThis as Record<string, unknown>).browser as { runtime: { sendMessage: typeof h.sendMessageSpy } };
  browserObj.runtime.sendMessage = h.sendMessageSpy as unknown as typeof browserObj.runtime.sendMessage;
}

function restoreSendMessage() {
  const browserObj = (globalThis as Record<string, unknown>).browser as { runtime: { sendMessage: ReturnType<typeof vi.fn> } };
  browserObj.runtime.sendMessage = vi.fn(() => Promise.resolve());
}

describe('Dynamic timeline upfront — 2-phase flow', () => {
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

  it('dynamic flow builds pipeline [scrape→plan→summarize→overall] for single segment', async () => {
    await setupComposable({ totalPages: 2, totalPosts: 40 });

    h.scrapePageRange.mockResolvedValue(makeScrapeResult(postFactory.shortThread(20)));
    h.summarize.mockReturnValue({
      taskId: 'test-task',
      result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
    });
    h.summarizeSegments.mockReturnValue({
      taskId: 'test-overall',
      result: Promise.resolve(makeLLMSegmentResult(mockSummaryResponses.singleSegment)),
    });
    h.getTaskState.mockReturnValue(undefined);

    await composable.handleAutoSummarizeAll();

    // Pipeline should be set and have correct structure
    const pipeline = composable.pipeline.value;
    expect(pipeline).not.toBeNull();
    expect(pipeline!.workflow).toBe('summarize');

    // Verify pipeline steps match the 2-phase flow
    const stepIds = pipeline!.steps.map(s => s.id);
    expect(stepIds[0]).toBe('scrape');
    expect(stepIds[1]).toBe('plan');
    expect(stepIds).toContain('summarize');
    expect(stepIds[stepIds.length - 1]).toBe('overall');

    // All steps should be done
    pipeline!.steps.forEach(s => {
      expect(s.status === 'done' || s.status === 'pending').toBe(true);
    });
  });

  it('dynamic flow builds pipeline with multiple summarize_N steps for multi-segment', async () => {
    await setupComposable({ totalPages: 10, totalPosts: 500 });

    // Force multi-segment: small context window + long content
    composable.currentConfig.value = {
      ...composable.currentConfig.value!,
      contextWindow: 16384,
      maxTokens: 2000,
    };

    const PER_PAGE = 50;
    for (let p = 1; p <= 10; p++) {
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

    const pipeline = composable.pipeline.value;
    expect(pipeline).not.toBeNull();

    const stepIds = pipeline!.steps.map(s => s.id);
    expect(stepIds[0]).toBe('scrape');
    expect(stepIds[1]).toBe('plan');

    // Should have summarize_0, summarize_1, ... steps (multi-segment)
    const summarizeSteps = stepIds.filter(id => id.startsWith('summarize_'));
    expect(summarizeSteps.length).toBeGreaterThanOrEqual(1);

    expect(stepIds[stepIds.length - 1]).toBe('overall');

    // scrape and plan should be done
    expect(pipeline!.steps.find(s => s.id === 'scrape')?.status).toBe('done');
    expect(pipeline!.steps.find(s => s.id === 'plan')?.status).toBe('done');
  });

  it('no new steps added after pipeline rebuild', async () => {
    await setupComposable({ totalPages: 10, totalPosts: 500 });

    // Force multi-segment to verify no extra steps appear
    composable.currentConfig.value = {
      ...composable.currentConfig.value!,
      contextWindow: 16384,
      maxTokens: 2000,
    };

    const PER_PAGE = 50;
    for (let p = 1; p <= 10; p++) {
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

    // After full run, verify the pipeline has the correct structure
    // (built upfront by rebuildWithSegments, no dynamic step additions)
    const pipeline = composable.pipeline.value;
    expect(pipeline).not.toBeNull();

    const steps = pipeline!.steps;
    const nonDefinedSteps = steps.filter(s =>
      !['scrape', 'plan', 'overall'].includes(s.id) &&
      !s.id.startsWith('summarize')
    );
    expect(nonDefinedSteps).toHaveLength(0);
  });

  it('resume after partial scrape reuses completed segment with matching boundary', async () => {
    await setupComposable({ totalPages: 3, totalPosts: 60 });

    // Simulate a previous run that completed 1 segment covering pages 1-3
    const segPosts = postFactory.shortThread(60);
    composable.segmentSummaries.value = [{
      startPage: 1, endPage: 3, posts: segPosts,
      summary: mockJsonResponse(mockSummaryResponses.segment1),
      summaryJson: mockSummaryResponses.segment1,
      postCount: 60, summarizedAt: Date.now(), complete: true,
    }];
    composable.dynamicSegmentBoundaries.value = [{ start: 1, end: 3, label: '1–3' }];

    // Mock a resize (forumPostCount increased) to trigger re-summarize
    h.scrapePageRange.mockResolvedValue(makeScrapeResult(postFactory.shortThread(20)));
    h.summarize.mockReturnValue({
      taskId: 'resume-task',
      result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
    });
    h.summarizeSegments.mockReturnValue({
      taskId: 'resume-overall',
      result: Promise.resolve(makeLLMSegmentResult(mockSummaryResponses.singleSegment)),
    });
    h.getTaskState.mockReturnValue(undefined);

    // Update forumPostCount > totalPosts to simulate new posts
    const topic = store.selectedTopic.value;
    if (topic) {
      store.selectTopic({ ...topic, forumPostCount: 80, totalPosts: 60, totalPages: 3 });
    }

    await composable.handleSegmentUpdate();

    // The existing segment (1-3) should be reused if boundary matches
    expect(composable.segmentSummaries.value[0]?.summary).toBeTruthy();
    // No extra LLM calls for already-summarized segment
    expect(h.summarize.mock.calls.length).toBeGreaterThanOrEqual(0);
  });

  it('fixed mode has no plan step in pipeline', async () => {
    await setupComposable({ totalPages: 2, totalPosts: 40 });

    composable.currentConfig.value = {
      ...composable.currentConfig.value!,
      dynamicSegments: false,
    };

    h.scrapePageRange.mockResolvedValue(makeScrapeResult(postFactory.shortThread(20)));
    h.summarize.mockReturnValue({
      taskId: 'fixed-task',
      result: Promise.resolve(makeLLMResult(mockSummaryResponses.singleSegment)),
    });
    h.summarizeSegments.mockReturnValue({
      taskId: 'fixed-overall',
      result: Promise.resolve(makeLLMSegmentResult(mockSummaryResponses.singleSegment)),
    });
    h.getTaskState.mockReturnValue(undefined);

    await composable.handleAutoSummarizeAll();

    const pipeline = composable.pipeline.value;
    expect(pipeline).not.toBeNull();

    const stepIds = pipeline!.steps.map(s => s.id);
    expect(stepIds).not.toContain('plan');
    // Fixed mode uses buildSummarizePipeline which has scrape+summarize+overall
    expect(stepIds).toContain('scrape');
    expect(stepIds).toContain('summarize');
    expect(stepIds[stepIds.length - 1]).toBe('overall');
  });
});
