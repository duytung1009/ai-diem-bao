import { describe, it, expect, afterEach } from 'vitest';
import { postFactory } from '@/tests/fixtures/post-factory';
import { mockSummaryResponses, mockJsonResponse, mockFencedResponse } from '@/tests/fixtures/mock-llm-responses';
import { createMockProvider, restoreCreateProvider } from '@/tests/mocks/override-factory';
import { summarizeTopic, parseSummaryJSON } from '@/lib/llm/summarizer';
import type { LLMConfig } from '@/lib/types';

const testConfig: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.3,
  contextWindow: 128000,
};

describe('Mock System Integration', () => {
  afterEach(() => {
    restoreCreateProvider();
  });

  describe('postFactory', () => {
    it('generates short thread with correct count', () => {
      const posts = postFactory.shortThread(10);
      expect(posts).toHaveLength(10);
      expect(posts[0].postNumber).toBe(1);
      expect(posts[0].author).toBe('vozer_01');
    });

    it('generates long thread with many posts', () => {
      const posts = postFactory.longThread(200);
      expect(posts).toHaveLength(200);
      expect(posts[0].content.length).toBeGreaterThan(100);
    });

    it('generates mixed length threads', () => {
      const posts = postFactory.mixedLength({ short: 5, medium: 10, long: 3 });
      expect(posts).toHaveLength(18);
    });
  });

  describe('parseSummaryJSON', () => {
    it('parses plain JSON', () => {
      const result = parseSummaryJSON(mockJsonResponse(mockSummaryResponses.singleSegment));
      expect(result).not.toBeNull();
      expect(result?.summary).toContain('Topic thảo luận');
    });

    it('parses fenced JSON', () => {
      const result = parseSummaryJSON(mockFencedResponse(mockSummaryResponses.segment1));
      expect(result).not.toBeNull();
      expect(result?.opinions).toHaveLength(2);
    });

    it('returns null for invalid JSON', () => {
      const result = parseSummaryJSON('this is not json');
      expect(result).toBeNull();
    });
  });

  describe('MockLLMProvider with summarizeTopic', () => {
    it('returns mock response from summarizeTopic', async () => {
      const mock = createMockProvider();
      const posts = postFactory.shortThread(10);

      const result = await summarizeTopic(posts, testConfig);
      const parsed = parseSummaryJSON(result);

      expect(parsed).not.toBeNull();
      expect(mock.getCallCount()).toBe(1);
    });

    it('handles multi-segment mock responses', async () => {
      const mock = createMockProvider();
      const posts = postFactory.veryLongThread(500);

      const result = await summarizeTopic(posts, testConfig);

      expect(mock.getCallCount()).toBeGreaterThan(1);
    });
  });
});
