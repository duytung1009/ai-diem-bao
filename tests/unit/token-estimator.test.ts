import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  getContextLimit,
  willExceedContext,
  calculateSegmentBudget,
  formatTokenCount,
  formatCost,
  estimateCost,
  getModelMaxOutput,
  getModelThinkingBudget,
  modelSupportsThinking,
  getThinkingOverhead,
} from '@/lib/token-estimator';
import type { ScrapedPost } from '@/lib/types';

describe('token-estimator', () => {
  describe('estimateTokens', () => {
    it('estimates tokens for short text', () => {
      const tokens = estimateTokens('Xin chào thế giới');
      expect(tokens).toBeGreaterThan(0);
    });

    it('scales roughly linearly with text length', () => {
      const short = estimateTokens('Hello');
      const long = estimateTokens('Hello '.repeat(100));
      expect(long).toBeGreaterThan(short * 50);
    });

    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('handles Vietnamese text', () => {
      const tokens = estimateTokens('Đây là một đoạn văn bản tiếng Việt khá dài để kiểm tra.');
      expect(tokens).toBeGreaterThan(5);
    });
  });

  describe('getContextLimit', () => {
    it('returns correct limit for gpt-4o', () => {
      expect(getContextLimit('gpt-4o')).toBe(128000);
    });

    it('returns correct limit for gemini-2.5-flash', () => {
      expect(getContextLimit('gemini-2.5-flash')).toBe(1048576);
    });

    it('returns correct limit for claude-sonnet-4-6', () => {
      expect(getContextLimit('claude-sonnet-4-6')).toBe(200000);
    });

    it('returns default for unknown model', () => {
      expect(getContextLimit('unknown-model')).toBe(128000);
    });

    it('respects contextWindow override', () => {
      expect(getContextLimit('unknown-model', 64000)).toBe(64000);
    });

    it('ignores zero override', () => {
      expect(getContextLimit('gpt-4o', 0)).toBe(128000);
    });
  });

  describe('getModelMaxOutput', () => {
    it('returns correct max output for gpt-4o', () => {
      expect(getModelMaxOutput('gpt-4o')).toBe(16384);
    });

    it('returns correct max output for gemini-2.5-flash', () => {
      expect(getModelMaxOutput('gemini-2.5-flash')).toBe(65535);
    });

    it('returns default for unknown model', () => {
      expect(getModelMaxOutput('unknown')).toBe(4096);
    });
  });

  describe('modelSupportsThinking', () => {
    it('returns true for gemini-2.5-flash', () => {
      expect(modelSupportsThinking('gemini-2.5-flash')).toBe(true);
    });

    it('returns false for gpt-4o', () => {
      expect(modelSupportsThinking('gpt-4o')).toBe(false);
    });

    it('returns false for gemma models', () => {
      expect(modelSupportsThinking('gemma-3-12b-it')).toBe(false);
    });
  });

  describe('getThinkingOverhead', () => {
    it('returns 0 for non-thinking models', () => {
      expect(getThinkingOverhead('gpt-4o', false)).toBe(0);
    });

    it('returns 0 when thinking explicitly disabled', () => {
      expect(getThinkingOverhead('gemini-2.5-flash', false)).toBe(0);
    });

    it('returns model default when thinking enabled without budget', () => {
      expect(getThinkingOverhead('gemini-2.5-flash', true)).toBe(24576);
    });

    it('returns custom budget when provided', () => {
      expect(getThinkingOverhead('gemini-2.5-flash', true, 16384)).toBe(16384);
    });

    it('caps custom budget at model max', () => {
      expect(getThinkingOverhead('gemini-2.5-flash', true, 99999)).toBe(24576);
    });
  });

  describe('willExceedContext', () => {
    const makePosts = (count: number, contentLength: number): ScrapedPost[] =>
      Array.from({ length: count }, (_, i) => ({
        author: `user${i}`,
        content: 'x'.repeat(contentLength),
        timestamp: '',
        postNumber: i + 1,
      }));

    it('returns false for small topic', () => {
      const posts = makePosts(5, 100);
      const result = willExceedContext(posts, 'gpt-4o');
      expect(result.exceeds).toBe(false);
      expect(result.chunksNeeded).toBe(1);
    });

    it('returns true for large topic exceeding context', () => {
      const posts = makePosts(500, 2000);
      const result = willExceedContext(posts, 'gpt-4o');
      expect(result.exceeds).toBe(true);
      expect(result.chunksNeeded).toBeGreaterThan(1);
    });

    it('calculates correct chunksNeeded', () => {
      const posts = makePosts(100, 500);
      const result = willExceedContext(posts, 'gpt-4o');
      expect(result.chunksNeeded).toBeGreaterThanOrEqual(1);
      expect(result.contextLimit).toBe(128000);
    });

    it('respects contextWindow override', () => {
      const posts = makePosts(50, 500);
      const resultNormal = willExceedContext(posts, 'gpt-4o');
      const resultOverride = willExceedContext(posts, 'gpt-4o', 500, 2000, 32000);
      expect(resultOverride.contextLimit).toBe(32000);
      expect(resultOverride.chunksNeeded).toBeGreaterThanOrEqual(resultNormal.chunksNeeded);
    });

    it('accounts for thinking overhead', () => {
      const posts = makePosts(50, 500);
      const resultNoThinking = willExceedContext(posts, 'gemini-2.5-flash', 500, 2000, undefined, 0);
      const resultWithThinking = willExceedContext(posts, 'gemini-2.5-flash', 500, 2000, undefined, 24576);
      expect(resultWithThinking.chunksNeeded).toBeGreaterThanOrEqual(resultNoThinking.chunksNeeded);
    });
  });

  describe('calculateSegmentBudget', () => {
    it('calculates budget for gpt-4o', () => {
      const budget = calculateSegmentBudget('gpt-4o', 500);
      expect(budget).toBeGreaterThan(4000);
      expect(budget).toBeLessThan(128000);
    });

    it('respects contextWindow override', () => {
      const budget = calculateSegmentBudget('unknown', 500, undefined, 64000);
      expect(budget).toBeGreaterThan(4000);
      expect(budget).toBeLessThan(64000);
    });

    it('respects custom responseBuffer', () => {
      const budgetDefault = calculateSegmentBudget('gpt-4o', 500);
      const budgetLargeBuffer = calculateSegmentBudget('gpt-4o', 500, 8000);
      expect(budgetLargeBuffer).toBeLessThan(budgetDefault);
    });

    it('accounts for thinking overhead', () => {
      const budgetNoThinking = calculateSegmentBudget('gemini-2.5-flash', 500, undefined, undefined, 0);
      const budgetWithThinking = calculateSegmentBudget('gemini-2.5-flash', 500, undefined, undefined, 24576);
      expect(budgetWithThinking).toBeLessThan(budgetNoThinking);
    });

    it('floors at 4000 tokens minimum', () => {
      const budget = calculateSegmentBudget('gpt-3.5-turbo', 20000);
      expect(budget).toBeGreaterThanOrEqual(4000);
    });
  });

  describe('estimateCost', () => {
    it('estimates cost for gpt-4o', () => {
      const cost = estimateCost(10000, 5000, 'gpt-4o');
      expect(cost.input).toBeCloseTo(0.025, 3);
      expect(cost.output).toBeCloseTo(0.05, 3);
    });

    it('estimates cost for gemini-2.5-flash', () => {
      const cost = estimateCost(100000, 50000, 'gemini-2.5-flash');
      expect(cost.total).toBeGreaterThan(0);
    });

    it('returns default for unknown model', () => {
      const cost = estimateCost(10000, 5000, 'unknown');
      expect(cost.total).toBeGreaterThan(0);
    });
  });

  describe('formatTokenCount', () => {
    it('formats small numbers', () => {
      expect(formatTokenCount(100)).toBe('100 tokens');
    });

    it('formats large numbers with commas', () => {
      expect(formatTokenCount(128000)).toBe('128,000 tokens');
    });
  });

  describe('formatCost', () => {
    it('formats small costs', () => {
      expect(formatCost(0.025)).toBe('$0.0250');
    });

    it('formats zero cost', () => {
      expect(formatCost(0)).toBe('$0.0000');
    });
  });
});
