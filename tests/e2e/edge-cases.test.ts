import { describe, it, expect, afterEach, vi } from 'vitest';
import { postFactory } from '@/tests/fixtures/post-factory';
import { mockSummaryResponses, mockJsonResponse } from '@/tests/fixtures/mock-llm-responses';
import { MockLLMProvider } from '@/tests/mocks/mock-provider';
import { createMockProvider, restoreCreateProvider, overrideCreateProvider } from '@/tests/mocks/override-factory';
import { summarizeTopic, updateSummary, parseSummaryJSON } from '@/lib/llm/summarizer';
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

describe('Phase 5: Edge Cases & Regression', () => {
  afterEach(() => {
    restoreCreateProvider();
  });

  describe('5.1: Abort signal', () => {
    it('abort signal trước khi gọi summarize throws AbortError', async () => {
      const mock = createMockProvider();
      const posts = postFactory.shortThread(10);
      const controller = new AbortController();
      controller.abort();

      await expect(summarizeTopic(posts, testConfig, undefined, undefined, controller.signal))
        .rejects.toThrow('The operation was aborted');
    });

    it('abort signal giữa chừng map-reduce dừng xử lý', async () => {
      const mock = new MockLLMProvider({ delayMs: 10, abortAfter: 2 });
      overrideCreateProvider(mock);

      const posts = postFactory.veryLongThread(500);
      const controller = new AbortController();

      setTimeout(() => controller.abort(), 50);

      await expect(summarizeTopic(posts, testConfig, undefined, undefined, controller.signal))
        .rejects.toThrow('The operation was aborted');
    });

    it('abort signal trong updateSummary throws', async () => {
      const mock = new MockLLMProvider({ delayMs: 200 });
      overrideCreateProvider(mock);

      const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
      const newPosts = postFactory.longThread(100);
      const controller = new AbortController();

      setTimeout(() => controller.abort(), 50);

      await expect(updateSummary(previousSummary, newPosts, testConfig, undefined, undefined, controller.signal))
        .rejects.toThrow('The operation was aborted');
    });

    it('không abort thì xử lý bình thường', async () => {
      const mock = createMockProvider();
      const posts = postFactory.shortThread(10);
      const controller = new AbortController();

      const result = await summarizeTopic(posts, testConfig, undefined, undefined, controller.signal);
      expect(parseSummaryJSON(result)).not.toBeNull();
      expect(mock.getCallCount()).toBe(1);
    });
  });

  describe('5.2: LLM returns invalid JSON', () => {
    it('provider trả về markdown/text → parseSummaryJSON returns null, fallback raw text', async () => {
      const mock = new MockLLMProvider({
        responses: ['Đây là kết quả tóm tắt bằng text thường, không phải JSON.'],
      });
      overrideCreateProvider(mock);

      const posts = postFactory.shortThread(10);
      const result = await summarizeTopic(posts, testConfig);
      const parsed = parseSummaryJSON(result);

      expect(parsed).toBeNull();
      expect(result).toContain('kết quả tóm tắt');
    });

    it('provider trả về JSON thiếu fields → returns null', async () => {
      const mock = new MockLLMProvider({
        responses: ['{"summary":"chỉ có summary"}'],
      });
      overrideCreateProvider(mock);

      const posts = postFactory.shortThread(10);
      const result = await summarizeTopic(posts, testConfig);
      const parsed = parseSummaryJSON(result);

      expect(parsed).toBeNull();
    });

    it('provider trả về JSON rỗng → returns null', async () => {
      const mock = new MockLLMProvider({
        responses: ['{}'],
      });
      overrideCreateProvider(mock);

      const posts = postFactory.shortThread(10);
      const result = await summarizeTopic(posts, testConfig);
      const parsed = parseSummaryJSON(result);

      expect(parsed).toBeNull();
    });

    it('invalid JSON từ LLM → summarizeTopic trả về raw text (không crash)', async () => {
      const mock = new MockLLMProvider({
        responses: ['invalid json response'],
      });
      overrideCreateProvider(mock);

      const posts = postFactory.shortThread(10);
      const result = await summarizeTopic(posts, testConfig);

      expect(typeof result).toBe('string');
      expect(result).toContain('invalid json response');
      expect(mock.getCallCount()).toBe(1);
    });

    it('map-reduce với một số calls trả về invalid JSON → vẫn có raw text kết quả', async () => {
      const mock = new MockLLMProvider({
        responses: [
          'invalid partial 1',
          'invalid partial 2',
          '{"summary":"final reduce","opinions":[],"conclusion":"done"}',
        ],
      });
      overrideCreateProvider(mock);

      const posts = postFactory.veryLongThread(500);
      const result = await summarizeTopic(posts, testConfig);

      expect(typeof result).toBe('string');
      expect(mock.getCallCount()).toBeGreaterThan(2);
    });
  });

  describe('5.3: Single post exceeds budget', () => {
    it('1 post rất dài (> context limit) vẫn xử lý được', async () => {
      const mock = createMockProvider();
      const veryLongPost = [
        {
          author: 'long_poster',
          content: 'x'.repeat(200000),
          timestamp: '',
          postNumber: 1,
        },
      ];

      const contextCheck = willExceedContext(veryLongPost, testConfig.model, 500, 2000, testConfig.contextWindow);

      const result = await summarizeTopic(veryLongPost, testConfig);
      expect(parseSummaryJSON(result)).not.toBeNull();
      expect(mock.getCallCount()).toBeGreaterThanOrEqual(1);
    });

    it('1 post dài + context window nhỏ → chunksNeeded >= 1', async () => {
      const veryLongPost = [
        {
          author: 'long_poster',
          content: 'x'.repeat(100000),
          timestamp: '',
          postNumber: 1,
        },
      ];

      const smallConfig: LLMConfig = { ...testConfig, contextWindow: 32768 };
      const contextCheck = willExceedContext(veryLongPost, smallConfig.model, 500, 2000, smallConfig.contextWindow);

      expect(contextCheck.chunksNeeded).toBeGreaterThanOrEqual(1);
    });
  });

  describe('5.4: Empty posts array', () => {
    it('summarizeTopic([]) không crash', async () => {
      const mock = createMockProvider();

      const result = await summarizeTopic([], testConfig);

      expect(typeof result).toBe('string');
      expect(mock.getCallCount()).toBe(1);
    });

    it('summarizeTopic([]) trả về kết quả parse được hoặc raw text', async () => {
      const mock = createMockProvider();

      const result = await summarizeTopic([], testConfig);
      const parsed = parseSummaryJSON(result);

      if (parsed) {
        expect(typeof parsed.summary).toBe('string');
      } else {
        expect(typeof result).toBe('string');
      }
    });

    it('updateSummary với newPosts rỗng vẫn hoạt động', async () => {
      const mock = createMockProvider();
      const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);

      const result = await updateSummary(previousSummary, [], testConfig);

      expect(typeof result).toBe('string');
      expect(mock.getCallCount()).toBeGreaterThanOrEqual(1);
    });
  });

  describe('5.5: Recursive reduce overflow', () => {
    it('nhiều segment summaries lớn → tree-reduce recursion xử lý được', async () => {
      const mock = createMockProvider();
      const posts = postFactory.veryLongThread(1000);

      const contextCheck = willExceedContext(posts, testConfig.model, 500, 2000, testConfig.contextWindow);
      expect(contextCheck.chunksNeeded).toBeGreaterThan(2);

      const result = await summarizeTopic(posts, testConfig);
      expect(parseSummaryJSON(result)).not.toBeNull();
      expect(mock.getCallCount()).toBeGreaterThan(contextCheck.chunksNeeded);
    });

    it('nhiều segment với context window rất nhỏ → recursion depth lớn', async () => {
      const mock = createMockProvider();
      const posts = postFactory.longThread(200);
      const tinyConfig: LLMConfig = { ...testConfig, contextWindow: 16384 };

      const contextCheck = willExceedContext(posts, tinyConfig.model, 500, 2000, tinyConfig.contextWindow);
      expect(contextCheck.chunksNeeded).toBeGreaterThan(3);

      const result = await summarizeTopic(posts, tinyConfig);
      expect(parseSummaryJSON(result)).not.toBeNull();
    });

    it('reduce với cross-reference authors hoạt động đúng', async () => {
      const mock = createMockProvider();
      const posts = postFactory.veryLongThread(500);

      const result = await summarizeTopic(posts, testConfig);

      const parsed = parseSummaryJSON(result);
      expect(parsed).not.toBeNull();

      if (parsed && parsed.opinions.length > 0) {
        for (const op of parsed.opinions) {
          expect(Array.isArray(op.supporters)).toBe(true);
          const seen = new Set<string>();
          for (const name of op.supporters) {
            expect(seen.has(name.toLowerCase())).toBe(false);
            seen.add(name.toLowerCase());
          }
        }
      }
    });
  });
});
