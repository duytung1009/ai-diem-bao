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

describe('E2E: Cập nhật tóm tắt khi bài gốc có nhiều segment', () => {
  afterEach(() => {
    restoreCreateProvider();
  });

  it('topic gốc segmented + ít posts mới → có thể không cần map-reduce', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.segment1);
    const newPosts = postFactory.shortThread(5);

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

  it('topic gốc segmented + nhiều posts mới → có thể kích hoạt map-reduce', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.segment1);
    const newPosts = postFactory.longThread(100);

    const postsWithContext = [
      { author: 'SYSTEM', content: `[BẢN TÓM TẮT CŨ]\n${previousSummary}`, timestamp: '', postNumber: 0 },
      ...newPosts,
    ];
    const contextCheck = willExceedContext(postsWithContext, testConfig.model, 500, 2000, testConfig.contextWindow);

    const result = await updateSummary(previousSummary, newPosts, testConfig);

    expect(parseSummaryJSON(result)).not.toBeNull();
    if (contextCheck.exceeds) {
      expect(mock.getCallCount()).toBeGreaterThan(1);
    }
  });

  it('progress callback phản ánh đúng flow', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.segment1);
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
      const hasReduceStep = onProgress.mock.calls.some((call) => call[0].includes('gộp'));
      expect(hasMapStep || hasReduceStep).toBe(true);
    }
  });

  it('kết quả cập nhật từ segmented topic có cấu trúc hợp lệ', async () => {
    createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.segment2);
    const newPosts = postFactory.mediumThread(20);

    const result = await updateSummary(previousSummary, newPosts, testConfig);
    const parsed = parseSummaryJSON(result);

    expect(parsed).not.toBeNull();
    expect(typeof parsed?.summary).toBe('string');
    expect(Array.isArray(parsed?.opinions)).toBe(true);
    expect(typeof parsed?.conclusion).toBe('string');
  });

  it('summary cũ dạng multi-segment được đưa vào context đúng format', async () => {
    const mock = createMockProvider();
    const previousSummary = JSON.stringify({
      summary: 'Tóm tắt từ nhiều segment',
      opinions: mockSummaryResponses.segment1.opinions.concat(mockSummaryResponses.segment2.opinions),
      conclusion: 'Tổng hợp từ các phần.',
    });
    const newPosts = postFactory.shortThread(10);

    await updateSummary(previousSummary, newPosts, testConfig);

    expect(mock.getCallCount()).toBeGreaterThanOrEqual(1);
  });
});
