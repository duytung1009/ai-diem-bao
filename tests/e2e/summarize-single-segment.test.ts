import { describe, it, expect, afterEach, vi } from 'vitest';
import { postFactory } from '@/tests/fixtures/post-factory';
import { mockSummaryResponses, mockJsonResponse } from '@/tests/fixtures/mock-llm-responses';
import { createMockProvider, restoreCreateProvider } from '@/tests/mocks/override-factory';
import { summarizeTopic, parseSummaryJSON } from '@/lib/llm/summarizer';
import { willExceedContext } from '@/lib/token-estimator';
import { mergePartialTopic } from '@/lib/cache-manager';
import type { LLMConfig, CachedTopic, TopicSegment, SummaryJSON } from '@/lib/types';

const testConfig: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.3,
  contextWindow: 128000,
};

const LLM_CONFIG = { provider: 'openai', model: 'gpt-4o-mini' };

describe('E2E: Tóm tắt không chia segment', () => {
  afterEach(() => {
    restoreCreateProvider();
  });

  it('topic nhỏ (10 posts) gọi LLM 1 lần, không map-reduce', async () => {
    const mock = createMockProvider();
    const posts = postFactory.shortThread(10);

    const contextCheck = willExceedContext(posts, testConfig.model, 500, 2000, testConfig.contextWindow);
    expect(contextCheck.exceeds).toBe(false);
    expect(contextCheck.chunksNeeded).toBe(1);

    const result = await summarizeTopic(posts, testConfig);
    const parsed = parseSummaryJSON(result);

    expect(parsed).not.toBeNull();
    expect(parsed?.summary).toBeDefined();
    expect(Array.isArray(parsed?.opinions)).toBe(true);
    expect(parsed?.conclusion).toBeDefined();
    expect(mock.getCallCount()).toBe(1);
  });

  it('topic vừa phải (30 posts) vẫn gọi 1 lần', async () => {
    const mock = createMockProvider();
    const posts = postFactory.shortThread(30, 'chủ đề ngắn');

    const result = await summarizeTopic(posts, testConfig);
    const parsed = parseSummaryJSON(result);

    expect(parsed).not.toBeNull();
    expect(mock.getCallCount()).toBe(1);
  });

  it('progress callback không báo step map-reduce', async () => {
    const mock = createMockProvider();
    const posts = postFactory.shortThread(10);
    const onProgress = vi.fn();

    await summarizeTopic(posts, testConfig, onProgress);

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('kết quả có cấu trúc SummaryJSON hợp lệ', async () => {
    createMockProvider();
    const posts = postFactory.shortThread(15);

    const result = await summarizeTopic(posts, testConfig);
    const parsed = parseSummaryJSON(result);

    expect(parsed).not.toBeNull();
    expect(typeof parsed?.summary).toBe('string');
    expect(Array.isArray(parsed?.opinions)).toBe(true);
    expect(typeof parsed?.conclusion).toBe('string');

    for (const op of parsed!.opinions) {
      expect(typeof op.title).toBe('string');
      expect(Array.isArray(op.supporters)).toBe(true);
      expect(Array.isArray(op.quotes)).toBe(true);
    }
  });

  it('topic với context window nhỏ vẫn không chia segment nếu vừa đủ', async () => {
    const mock = createMockProvider();
    const posts = postFactory.shortThread(5);
    const smallContextConfig: LLMConfig = {
      ...testConfig,
      contextWindow: 32768,
    };

    const contextCheck = willExceedContext(posts, smallContextConfig.model, 500, 2000, smallContextConfig.contextWindow);
    expect(contextCheck.exceeds).toBe(false);

    const result = await summarizeTopic(posts, smallContextConfig);
    expect(parseSummaryJSON(result)).not.toBeNull();
    expect(mock.getCallCount()).toBe(1);
  });
});

describe('SAVE_CACHED_TOPIC: single-segment payload self-contained', () => {
  const topicUrl = 'https://voz.vn/threads/topic.123/';
  const summaryJson: SummaryJSON = mockSummaryResponses.singleSegment;
  const posts = postFactory.shortThread(10);
  const segment: TopicSegment = {
    startPage: 1,
    endPage: 4,
    posts,
    summary: summaryJson.summary,
    summaryJson,
    postCount: posts.filter(p => p.postNumber >= 0).length,
    summarizedAt: Date.now(),
  };
  const segTotalPosts = segment.postCount;

  it('1 event duy nhất chứa cả segments lẫn top-level summary — không bị phân tán 2 event', () => {
    const payload: Partial<CachedTopic> = {
      url: topicUrl,
      title: 'Test Topic',
      version: 'xf2',
      totalPages: 4,
      forumPostCount: segTotalPosts,
      totalPosts: segTotalPosts,
      summarizedPostCount: segTotalPosts,
      segments: [segment],
      summary: segment.summary,
      summaryJson: segment.summaryJson,
    };

    expect(payload.segments).toHaveLength(1);
    expect(payload.segments![0].summary).toBe(summaryJson.summary);
    expect(payload.summary).toBe(summaryJson.summary);
    expect(payload.summaryJson).toEqual(summaryJson);
    expect(payload.totalPosts).toBe(segTotalPosts);
    expect(payload.summarizedPostCount).toBe(segTotalPosts);
  });

  it('mergePartialTopic: 1 event duy nhất cho kết quả hợp lệ không mất dữ liệu', () => {
    const payload: Partial<CachedTopic> = {
      url: topicUrl,
      title: 'Test Topic',
      version: 'xf2',
      totalPages: 4,
      forumPostCount: segTotalPosts,
      totalPosts: segTotalPosts,
      summarizedPostCount: segTotalPosts,
      segments: [segment],
      summary: segment.summary,
      summaryJson: segment.summaryJson,
    };

    const result = mergePartialTopic(payload, null, topicUrl, LLM_CONFIG);

    expect(result.url).toBe(topicUrl);
    expect(result.title).toBe('Test Topic');
    expect(result.segments).toHaveLength(1);
    expect(result.segments![0].summary).toBe(summaryJson.summary);
    expect(result.summary).toBe(summaryJson.summary);
    expect(result.summaryJson).toEqual(summaryJson);
    expect(result.totalPosts).toBe(segTotalPosts);
    expect(result.summarizedPostCount).toBe(segTotalPosts);
  });

  it('mergePartialTopic: pattern cũ (2 event) — event 1 thiếu summary, event 2 thiếu segments/totalPosts', () => {
    const event1: Partial<CachedTopic> = {
      url: topicUrl,
      title: 'Test Topic',
      version: 'xf2',
      totalPages: 4,
      forumPostCount: segTotalPosts,
      totalPosts: segTotalPosts,
      summarizedPostCount: segTotalPosts,
      segments: [segment],
    };

    const afterEvent1 = mergePartialTopic(event1, null, topicUrl, LLM_CONFIG);
    expect(afterEvent1.segments).toHaveLength(1);
    expect(afterEvent1.summary).toBe('');
    expect(afterEvent1.summaryJson).toBeUndefined();
    expect(afterEvent1.totalPosts).toBe(segTotalPosts);

    const event2: Partial<CachedTopic> = {
      url: topicUrl,
      forumPostCount: segTotalPosts,
      summary: segment.summary,
      summaryJson: segment.summaryJson,
      summarizedPostCount: segTotalPosts,
    };

    const afterEvent2 = mergePartialTopic(event2, afterEvent1, topicUrl, LLM_CONFIG);
    expect(afterEvent2.segments).toHaveLength(1);
    expect(afterEvent2.summary).toBe(summaryJson.summary);
    expect(afterEvent2.summaryJson).toEqual(summaryJson);
    expect(afterEvent2.totalPosts).toBe(segTotalPosts);
  });

  it('mergePartialTopic: event 1 fail thì event 2 một mình không self-contained — mất segments/totalPosts', () => {
    const event2: Partial<CachedTopic> = {
      url: topicUrl,
      forumPostCount: segTotalPosts,
      summary: segment.summary,
      summaryJson: segment.summaryJson,
      summarizedPostCount: segTotalPosts,
    };

    const result = mergePartialTopic(event2, null, topicUrl, LLM_CONFIG);

    expect(result.summary).toBe(summaryJson.summary);
    expect(result.summaryJson).toEqual(summaryJson);
    expect(result.segments).toBeUndefined();
    expect(result.totalPosts).toBe(0);
  });
});
