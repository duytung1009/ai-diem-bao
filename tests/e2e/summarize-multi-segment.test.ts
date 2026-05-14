import { describe, it, expect, afterEach, vi } from 'vitest';
import { postFactory } from '@/tests/fixtures/post-factory';
import { mockSummaryResponses, mockJsonResponse } from '@/tests/fixtures/mock-llm-responses';
import { createMockProvider, restoreCreateProvider } from '@/tests/mocks/override-factory';
import { summarizeTopic, parseSummaryJSON } from '@/lib/llm/summarizer';
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

describe('E2E: Tóm tắt có chia nhiều segment', () => {
  afterEach(() => {
    restoreCreateProvider();
  });

  it('topic lớn (500 posts) kích hoạt map-reduce', async () => {
    const mock = createMockProvider();
    const posts = postFactory.veryLongThread(500);

    const contextCheck = willExceedContext(posts, testConfig.model, 500, 2000, testConfig.contextWindow);
    expect(contextCheck.exceeds).toBe(true);
    expect(contextCheck.chunksNeeded).toBeGreaterThan(1);

    const result = await summarizeTopic(posts, testConfig);
    const parsed = parseSummaryJSON(result);

    expect(parsed).not.toBeNull();
    expect(mock.getCallCount()).toBeGreaterThan(2);
  });

  it('progress callback báo đúng số step map-reduce', async () => {
    const mock = createMockProvider();
    const posts = postFactory.veryLongThread(500);
    const onProgress = vi.fn();

    await summarizeTopic(posts, testConfig, onProgress);

    const progressCalls = onProgress.mock.calls;
    expect(progressCalls.length).toBeGreaterThan(0);

    const hasMapStep = progressCalls.some((call) => call[0].includes('phần'));
    const hasReduceStep = progressCalls.some((call) => call[0].includes('gộp'));
    expect(hasMapStep).toBe(true);
    expect(hasReduceStep).toBe(true);
  });

  it('số LLM calls = chunksNeeded (map) + 1 (reduce) tối thiểu', async () => {
    const mock = createMockProvider();
    const posts = postFactory.veryLongThread(500);

    const contextCheck = willExceedContext(posts, testConfig.model, 500, 2000, testConfig.contextWindow);
    const expectedMinCalls = contextCheck.chunksNeeded + 1;

    await summarizeTopic(posts, testConfig);

    expect(mock.getCallCount()).toBeGreaterThanOrEqual(expectedMinCalls);
  });

  it('kết quả cuối cùng có cấu trúc SummaryJSON hợp lệ', async () => {
    createMockProvider();
    const posts = postFactory.veryLongThread(500);

    const result = await summarizeTopic(posts, testConfig);
    const parsed = parseSummaryJSON(result);

    expect(parsed).not.toBeNull();
    expect(typeof parsed?.summary).toBe('string');
    expect(Array.isArray(parsed?.opinions)).toBe(true);
    expect(typeof parsed?.conclusion).toBe('string');
  });

  it('topic với context window nhỏ hơn chia nhiều chunk hơn', async () => {
    const mock = createMockProvider();
    const posts = postFactory.longThread(200);

    const normalCheck = willExceedContext(posts, testConfig.model, 500, 2000, 128000);
    const smallCheck = willExceedContext(posts, testConfig.model, 500, 2000, 32768);

    expect(smallCheck.chunksNeeded).toBeGreaterThanOrEqual(normalCheck.chunksNeeded);

    const smallConfig: LLMConfig = { ...testConfig, contextWindow: 32768 };
    await summarizeTopic(posts, smallConfig);

    expect(mock.getCallCount()).toBeGreaterThan(1);
  });

  it('map-reduce có delay giữa các chunk calls', async () => {
    const mock = createMockProvider();
    const posts = postFactory.veryLongThread(500);
    const startTime = Date.now();

    await summarizeTopic(posts, testConfig);

    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThan(100);
  });

  it('topic rất lớn (1000 posts) vẫn xử lý được', async () => {
    createMockProvider();
    const posts = postFactory.veryLongThread(1000);

    const contextCheck = willExceedContext(posts, testConfig.model, 500, 2000, testConfig.contextWindow);
    expect(contextCheck.chunksNeeded).toBeGreaterThan(2);

    const result = await summarizeTopic(posts, testConfig);
    expect(parseSummaryJSON(result)).not.toBeNull();
  });
});
