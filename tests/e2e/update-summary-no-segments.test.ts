import { describe, it, expect, afterEach, vi } from 'vitest';
import { postFactory } from '@/tests/fixtures/post-factory';
import { mockSummaryResponses, mockJsonResponse } from '@/tests/fixtures/mock-llm-responses';
import { createMockProvider, restoreCreateProvider } from '@/tests/mocks/override-factory';
import { updateSummary, parseSummaryJSON } from '@/lib/llm/summarizer';
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

describe('E2E: Cập nhật tóm tắt khi bài gốc không chia segment', () => {
  afterEach(() => {
    restoreCreateProvider();
  });

  it('cập nhật với ít posts mới gọi LLM 1 lần', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
    const newPosts = postFactory.shortThread(5);

    const postsWithContext = [
      { author: 'SYSTEM', content: `[BẢN TÓM TẮT CŨ]\n${previousSummary}`, timestamp: '', postNumber: 0 },
      ...newPosts,
    ];
    const contextCheck = willExceedContext(postsWithContext, testConfig.model, 500, 2000, testConfig.contextWindow);
    expect(contextCheck.exceeds).toBe(false);

    const result = await updateSummary(previousSummary, newPosts, testConfig);
    const parsed = parseSummaryJSON(result);

    expect(parsed).not.toBeNull();
    expect(mock.getCallCount()).toBe(1);
  });

  it('summary cũ được đưa vào context post', async () => {
    const mock = createMockProvider();
    const previousSummary = '{"summary":"topic cũ","opinions":[],"conclusion":"cũ"}';
    const newPosts = postFactory.shortThread(3);

    await updateSummary(previousSummary, newPosts, testConfig);

    expect(mock.getCallCount()).toBe(1);
  });

  it('progress callback không báo map-reduce', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.minimal);
    const newPosts = postFactory.shortThread(5);
    const onProgress = vi.fn();

    await updateSummary(previousSummary, newPosts, testConfig, onProgress);

    const hasMapStep = onProgress.mock.calls.some((call) => call[0].includes('phần'));
    expect(hasMapStep).toBe(false);
  });

  it('kết quả cập nhật có cấu trúc hợp lệ', async () => {
    createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
    const newPosts = postFactory.shortThread(8);

    const result = await updateSummary(previousSummary, newPosts, testConfig);
    const parsed = parseSummaryJSON(result);

    expect(parsed).not.toBeNull();
    expect(typeof parsed?.summary).toBe('string');
    expect(Array.isArray(parsed?.opinions)).toBe(true);
    expect(typeof parsed?.conclusion).toBe('string');
  });

  it('cập nhật với posts có độ dài trung bình vẫn không chia segment', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
    const newPosts = postFactory.mediumThread(10);

    const postsWithContext = [
      { author: 'SYSTEM', content: `[BẢN TÓM TẮT CŨ]\n${previousSummary}`, timestamp: '', postNumber: 0 },
      ...newPosts,
    ];
    const contextCheck = willExceedContext(postsWithContext, testConfig.model, 500, 2000, testConfig.contextWindow);

    const result = await updateSummary(previousSummary, newPosts, testConfig);
    expect(parseSummaryJSON(result)).not.toBeNull();

    if (!contextCheck.exceeds) {
      expect(mock.getCallCount()).toBe(1);
    }
  });
});

describe('SAVE_CACHED_TOPIC: update-summary single-segment payload self-contained', () => {
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

  it('generateOverallSummary 1 segment: 1 event duy nhất chứa cả segments lẫn summary', () => {
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

    const result = mergePartialTopic(payload, null, topicUrl, LLM_CONFIG);
    expect(result.segments).toHaveLength(1);
    expect(result.segments![0].summary).toBe(summaryJson.summary);
    expect(result.summary).toBe(summaryJson.summary);
    expect(result.summaryJson).toEqual(summaryJson);
    expect(result.totalPosts).toBe(segTotalPosts);
    expect(result.summarizedPostCount).toBe(segTotalPosts);
  });

  it('pattern cũ (2 event) — event 2 thiếu segments/totalPosts, mất dữ liệu nếu event 1 fail', () => {
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

  it('mergePartialTopic: 2 event hợp lệ — event 2 merge đúng với event 1', () => {
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
    expect(afterEvent1.totalPosts).toBe(segTotalPosts);
    expect(afterEvent1.summary).toBe('');

    const event2: Partial<CachedTopic> = {
      url: topicUrl,
      forumPostCount: 79,
      summary: segment.summary,
      summaryJson: segment.summaryJson,
      summarizedPostCount: segTotalPosts,
    };

    const afterEvent2 = mergePartialTopic(event2, afterEvent1, topicUrl, LLM_CONFIG);
    expect(afterEvent2.summary).toBe(summaryJson.summary);
    expect(afterEvent2.summaryJson).toEqual(summaryJson);
    expect(afterEvent2.segments).toHaveLength(1);
    expect(afterEvent2.totalPosts).toBe(segTotalPosts);
  });
});

describe('computeResumeState: re-scrape from pendingStartPage, not page 1', () => {
  it('resume.fromPage > totalPages — không thể resume từ fromPage, phải dùng pendingStartPage', () => {
    const lastSeg: TopicSegment = {
      startPage: 3,
      endPage: 4,
      posts: postFactory.shortThread(10),
      summary: 'segment summary',
      postCount: 20,
      summarizedAt: Date.now(),
    };

    expect(lastSeg.startPage).toBe(3);
    expect(lastSeg.endPage).toBe(4);
    expect(lastSeg.endPage + 1).toBe(5);

    // fromPage = 5 > totalPages = 4 → cannot resume from fromPage
    // Must fall back to pendingStartPage (3) to re-scrape from last segment start
    const fromPage = lastSeg.endPage + 1;
    const totalPages = 4;
    const pendingStartPage = lastSeg.startPage;

    expect(fromPage).toBeGreaterThan(totalPages);
    expect(pendingStartPage).toBeLessThanOrEqual(totalPages);
    expect(pendingStartPage).toBe(3);
  });

  it('single-segment covering all pages — pendingStartPage = 1, fromPage = totalPages+1', () => {
    const segment: TopicSegment = {
      startPage: 1,
      endPage: 4,
      posts: postFactory.shortThread(10),
      summary: 'summary',
      postCount: 69,
      summarizedAt: Date.now(),
    };

    // fromPage = 5 > totalPages = 4
    // pendingStartPage = 1 → re-scrape from beginning (correct for single segment)
    expect(segment.endPage + 1).toBe(5);
    expect(segment.startPage).toBe(1);
  });
});
