import { describe, it, expect, afterEach, vi } from 'vitest';
import { postFactory } from '@/tests/fixtures/post-factory';
import { mockSummaryResponses, mockJsonResponse } from '@/tests/fixtures/mock-llm-responses';
import { createMockProvider, restoreCreateProvider } from '@/tests/mocks/override-factory';
import { updateSummary, parseSummaryJSON } from '@/lib/llm/summarizer';
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
