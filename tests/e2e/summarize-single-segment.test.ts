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
