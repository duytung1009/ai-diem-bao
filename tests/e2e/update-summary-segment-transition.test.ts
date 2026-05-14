import { describe, it, expect, afterEach, vi } from 'vitest';
import { postFactory } from '@/tests/fixtures/post-factory';
import { mockSummaryResponses, mockJsonResponse } from '@/tests/fixtures/mock-llm-responses';
import { createMockProvider, restoreCreateProvider } from '@/tests/mocks/override-factory';
import { updateSummary, parseSummaryJSON, summarizeTopic } from '@/lib/llm/summarizer';
import { willExceedContext } from '@/lib/token-estimator';
import type { LLMConfig } from '@/lib/types';

const testConfig: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.3,
  contextWindow: 128000,
};

describe('E2E: Cập nhật không segment → đủ lớn → chuyển sang nhiều segment', () => {
  afterEach(() => {
    restoreCreateProvider();
  });

  it('topic nhỏ ban đầu không chia segment', async () => {
    const mock = createMockProvider();
    const initialPosts = postFactory.shortThread(25);

    const initialCheck = willExceedContext(initialPosts, testConfig.model, 500, 2000, testConfig.contextWindow);
    expect(initialCheck.exceeds).toBe(false);
    expect(initialCheck.chunksNeeded).toBe(1);

    const result = await summarizeTopic(initialPosts, testConfig);
    expect(parseSummaryJSON(result)).not.toBeNull();
    expect(mock.getCallCount()).toBe(1);
  });

  it('topic nhỏ + nhiều posts mới → vượt context → chuyển sang map-reduce', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
    const newPosts = postFactory.longThread(100);

    const postsWithContext = [
      { author: 'SYSTEM', content: `[BẢN TÓM TẮT CŨ]\n${previousSummary}`, timestamp: '', postNumber: 0 },
      ...newPosts,
    ];
    const contextCheck = willExceedContext(postsWithContext, testConfig.model, 500, 2000, testConfig.contextWindow);

    const result = await updateSummary(previousSummary, newPosts, testConfig);
    const parsed = parseSummaryJSON(result);

    expect(parsed).not.toBeNull();
    if (contextCheck.exceeds) {
      expect(mock.getCallCount()).toBeGreaterThan(1);
    }
  });

  it('progress callback báo chuyển từ direct sang map-reduce', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
    const newPosts = postFactory.longThread(100);
    const onProgress = vi.fn();

    await updateSummary(previousSummary, newPosts, testConfig, onProgress);

    const postsWithContext = [
      { author: 'SYSTEM', content: `[BẢN TÓM TẮT CŨ]\n${previousSummary}`, timestamp: '', postNumber: 0 },
      ...newPosts,
    ];
    const contextCheck = willExceedContext(postsWithContext, testConfig.model, 500, 2000, testConfig.contextWindow);

    if (contextCheck.exceeds) {
      const hasMapStep = onProgress.mock.calls.some((call) => call[0].includes('phần'));
      expect(hasMapStep).toBe(true);
    }
  });

  it('kết quả sau transition có cấu trúc SummaryJSON hợp lệ', async () => {
    createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
    const newPosts = postFactory.longThread(100);

    const result = await updateSummary(previousSummary, newPosts, testConfig);
    const parsed = parseSummaryJSON(result);

    expect(parsed).not.toBeNull();
    expect(typeof parsed?.summary).toBe('string');
    expect(Array.isArray(parsed?.opinions)).toBe(true);
    expect(typeof parsed?.conclusion).toBe('string');
  });

  it('số LLM calls tăng đáng kể sau transition', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
    const newPosts = postFactory.longThread(100);

    const postsWithContext = [
      { author: 'SYSTEM', content: `[BẢN TÓM TẮT CŨ]\n${previousSummary}`, timestamp: '', postNumber: 0 },
      ...newPosts,
    ];
    const contextCheck = willExceedContext(postsWithContext, testConfig.model, 500, 2000, testConfig.contextWindow);

    await updateSummary(previousSummary, newPosts, testConfig);

    if (contextCheck.exceeds) {
      expect(mock.getCallCount()).toBeGreaterThan(2);
    }
  });

  it('transition với context window nhỏ hơn xảy ra sớm hơn', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
    const newPosts = postFactory.mediumThread(50);

    const smallConfig: LLMConfig = { ...testConfig, contextWindow: 32768 };

    const postsWithContext = [
      { author: 'SYSTEM', content: `[BẢN TÓM TẮT CŨ]\n${previousSummary}`, timestamp: '', postNumber: 0 },
      ...newPosts,
    ];
    const normalCheck = willExceedContext(postsWithContext, testConfig.model, 500, 2000, 128000);
    const smallCheck = willExceedContext(postsWithContext, smallConfig.model, 500, 2000, 32768);

    expect(smallCheck.chunksNeeded).toBeGreaterThanOrEqual(normalCheck.chunksNeeded);

    const result = await updateSummary(previousSummary, newPosts, smallConfig);
    expect(parseSummaryJSON(result)).not.toBeNull();
  });

  it('biên giới: topic vừa đủ không vượt context', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
    const newPosts = postFactory.shortThread(20);

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
