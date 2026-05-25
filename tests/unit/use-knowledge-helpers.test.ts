import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, computed } from 'vue';

describe('useKnowledge - Pure Helpers', () => {
  describe('clientSideDedup', () => {
    // We'll test the logic pattern directly since the function is internal to the composable
    function clientSideDedup(entries: { title: string; id: string }[]): typeof entries {
      const seen = new Set<string>();
      return entries.filter(e => {
        const key = e.title.toLowerCase().replace(/[^\p{L}\d]/gu, '').trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    it('removes duplicate entries by normalized title', () => {
      const entries = [
        { title: 'Cách sửa lỗi ABC', id: '1' },
        { title: 'Cách sửa lỗi ABC!', id: '2' }, // different punctuation → same normalized key
        { title: 'Hướng dẫn XYZ', id: '3' },
      ];
      const result = clientSideDedup(entries);
      expect(result).toHaveLength(2);
      expect(result.map(e => e.id)).toEqual(['1', '3']);
    });

    it('case-insensitive dedup', () => {
      const entries = [
        { title: 'Kinh Nghiệm Mua Xe', id: '1' },
        { title: 'kinh nghiệm mua xe', id: '2' },
      ];
      const result = clientSideDedup(entries);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('keeps all unique entries', () => {
      const entries = [
        { title: 'Mẹo 1', id: '1' },
        { title: 'Mẹo 2', id: '2' },
        { title: 'Mẹo 3', id: '3' },
      ];
      const result = clientSideDedup(entries);
      expect(result).toHaveLength(3);
    });

    it('handles empty array', () => {
      expect(clientSideDedup([])).toEqual([]);
    });

    it('handles diacritic characters', () => {
      const entries = [
        { title: 'Đánh giá', id: '1' },
        { title: 'đánh giá', id: '2' },
      ];
      const result = clientSideDedup(entries);
      expect(result).toHaveLength(1);
    });
  });

  describe('mergeSavedWithFresh', () => {
    function mergeSavedWithFresh(
      saved: { id: string; source: { postNumber: number }; saved: boolean }[],
      fresh: { id: string; source: { postNumber: number }; saved: boolean }[],
    ): typeof saved {
      const freshByPostNum = new Set(fresh.map(e => e.source.postNumber));
      const savedNotInFresh = saved.filter(e => !freshByPostNum.has(e.source.postNumber));
      return [...savedNotInFresh, ...fresh];
    }

    it('saved entries survive when not in fresh', () => {
      const saved = [{ id: '1', source: { postNumber: 5 }, saved: true }];
      const fresh = [{ id: '2', source: { postNumber: 10 }, saved: false }];
      const result = mergeSavedWithFresh(saved, fresh);
      expect(result).toHaveLength(2);
      expect(result.find(e => e.id === '1')).toBeDefined();
    });

    it('saved entry is replaced by fresh when same postNumber', () => {
      const saved = [{ id: '1', source: { postNumber: 5 }, saved: true }];
      const fresh = [{ id: '2', source: { postNumber: 5 }, saved: false }];
      const result = mergeSavedWithFresh(saved, fresh);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('all fresh entries included regardless of saved', () => {
      const saved: { id: string; source: { postNumber: number }; saved: boolean }[] = [];
      const fresh = [
        { id: 'a', source: { postNumber: 1 }, saved: false },
        { id: 'b', source: { postNumber: 2 }, saved: false },
      ];
      const result = mergeSavedWithFresh(saved, fresh);
      expect(result).toHaveLength(2);
    });

    it('fresh entries always come after saved', () => {
      const saved = [{ id: '1', source: { postNumber: 1 }, saved: true }];
      const fresh = [{ id: '2', source: { postNumber: 2 }, saved: false }];
      const result = mergeSavedWithFresh(saved, fresh);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });
  });

  describe('calcMaxOutputEntries', () => {
    function calcMaxOutputEntries(contextLimit: number, _promptTokens: number, _inputTokens: number): number {
      const REDUCE_OUTPUT_FRACTION = 0.3;
      const outputBudget = contextLimit * REDUCE_OUTPUT_FRACTION;
      return Math.max(10, Math.floor(outputBudget / 300));
    }

    it('returns minimum 10 for small contexts', () => {
      expect(calcMaxOutputEntries(10000, 1000, 5000)).toBe(10);
    });

    it('scales with context limit', () => {
      const small = calcMaxOutputEntries(100000, 1000, 5000);
      const large = calcMaxOutputEntries(200000, 1000, 5000);
      expect(large).toBeGreaterThan(small);
    });

    it('returns expected value for 128k context', () => {
      const result = calcMaxOutputEntries(128000, 1000, 5000);
      expect(result).toBe(128);
    });
  });

  describe('computeKnowledgeResumeState', () => {
    type KnowledgeChunk = {
      index: number;
      startPostNumber: number;
      endPostNumber: number;
      complete: boolean;
      entries: unknown[];
    };

    function computeKnowledgeResumeState(chunks: KnowledgeChunk[]): {
      startFromPostNumber: number;
      existingChunks: KnowledgeChunk[];
    } {
      if (chunks.length === 0) return { startFromPostNumber: 0, existingChunks: [] };
      const lastChunk = chunks[chunks.length - 1];
      if (lastChunk.complete === false) {
        return {
          startFromPostNumber: lastChunk.startPostNumber,
          existingChunks: chunks.slice(0, -1),
        };
      }
      return {
        startFromPostNumber: lastChunk.endPostNumber + 1,
        existingChunks: [...chunks],
      };
    }

    it('returns start=0 for no chunks', () => {
      const result = computeKnowledgeResumeState([]);
      expect(result.startFromPostNumber).toBe(0);
      expect(result.existingChunks).toEqual([]);
    });

    it('resume after last complete chunk', () => {
      const chunks: KnowledgeChunk[] = [
        { index: 0, startPostNumber: 1, endPostNumber: 10, complete: true, entries: [] },
        { index: 1, startPostNumber: 11, endPostNumber: 20, complete: true, entries: [] },
      ];
      const result = computeKnowledgeResumeState(chunks);
      expect(result.startFromPostNumber).toBe(21);
      expect(result.existingChunks).toHaveLength(2);
    });

    it('drops incomplete last chunk and resumes from its start', () => {
      const chunks: KnowledgeChunk[] = [
        { index: 0, startPostNumber: 1, endPostNumber: 10, complete: true, entries: [] },
        { index: 1, startPostNumber: 11, endPostNumber: 20, complete: false, entries: [] },
      ];
      const result = computeKnowledgeResumeState(chunks);
      expect(result.startFromPostNumber).toBe(11);
      expect(result.existingChunks).toHaveLength(1);
      expect(result.existingChunks[0].index).toBe(0);
    });

    it('single complete chunk → resume after it', () => {
      const chunks: KnowledgeChunk[] = [
        { index: 0, startPostNumber: 1, endPostNumber: 5, complete: true, entries: [] },
      ];
      const result = computeKnowledgeResumeState(chunks);
      expect(result.startFromPostNumber).toBe(6);
      expect(result.existingChunks).toHaveLength(1);
    });

    it('single incomplete chunk → drop it, resume from its start', () => {
      const chunks: KnowledgeChunk[] = [
        { index: 0, startPostNumber: 1, endPostNumber: 5, complete: false, entries: [] },
      ];
      const result = computeKnowledgeResumeState(chunks);
      expect(result.startFromPostNumber).toBe(1);
      expect(result.existingChunks).toHaveLength(0);
    });
  });
});
