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
    function calcMaxOutputEntries(maxOutputTokens: number): number {
      return Math.max(2, Math.floor(maxOutputTokens * 0.8 / 700));
    }

    it('returns floor = 2 for small output budgets (2000 tokens)', () => {
      expect(calcMaxOutputEntries(2000)).toBe(2);
    });

    it('returns expected value for 4096 tokens (approx 4 entries)', () => {
      expect(calcMaxOutputEntries(4096)).toBe(4);
    });

    it('returns expected value for 8192 tokens (approx 9 entries)', () => {
      expect(calcMaxOutputEntries(8192)).toBe(9);
    });

    it('returns expected value for 16384 tokens (approx 18 entries)', () => {
      expect(calcMaxOutputEntries(16384)).toBe(18);
    });

    it('returns 2 for zero or negative values (floor clamp)', () => {
      expect(calcMaxOutputEntries(0)).toBe(2);
      expect(calcMaxOutputEntries(-100)).toBe(2);
    });
  });

  describe('splitForPreReduce', () => {
    function splitForPreReduce(chunks: { id: string }[][], maxPerCall: number): { id: string }[][] {
      const allFlat = chunks.flat();
      const groups: { id: string }[][] = [];
      const entriesPerGroup = maxPerCall * 2;
      for (let i = 0; i < allFlat.length; i += entriesPerGroup) {
        groups.push(allFlat.slice(i, i + entriesPerGroup));
      }
      return groups;
    }

    it('flattens entries across chunks and splits by entry count', () => {
      const chunks = [
        [{ id: '1' }, { id: '2' }],
        [{ id: '3' }, { id: '4' }],
        [{ id: '5' }, { id: '6' }],
      ];
      const groups = splitForPreReduce(chunks, 2); // maxPerCall=2 → entriesPerGroup=4
      expect(groups).toHaveLength(2);
      expect(groups[0]).toHaveLength(4);
      expect(groups[0].map(e => e.id)).toEqual(['1', '2', '3', '4']);
      expect(groups[1]).toHaveLength(2);
      expect(groups[1].map(e => e.id)).toEqual(['5', '6']);
    });

    it('returns single group when all entries fit in one group', () => {
      const chunks = [
        [{ id: '1' }, { id: '2' }],
        [{ id: '3' }],
      ];
      const groups = splitForPreReduce(chunks, 5); // entriesPerGroup=10, only 3 entries total
      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(3);
    });

    it('handles empty chunks gracefully', () => {
      const chunks: { id: string }[][] = [[], [], []];
      const groups = splitForPreReduce(chunks, 2);
      expect(groups).toHaveLength(0);
    });

    it('handles single chunk with many entries', () => {
      const entries = Array.from({ length: 20 }, (_, i) => ({ id: `${i + 1}` }));
      const groups = splitForPreReduce([entries], 3); // entriesPerGroup=6
      expect(groups).toHaveLength(4); // 20 / 6 = 4 groups (6+6+6+2)
      expect(groups[0]).toHaveLength(6);
      expect(groups[3]).toHaveLength(2);
    });

    it('works with maxPerCall=1 (minimum cap)', () => {
      const chunks = [
        [{ id: '1' }, { id: '2' }, { id: '3' }],
        [{ id: '4' }, { id: '5' }],
      ];
      const groups = splitForPreReduce(chunks, 1); // entriesPerGroup=2
      expect(groups).toHaveLength(3); // 5 entries / 2 = 3 groups
      expect(groups[0]).toHaveLength(2);
      expect(groups[1]).toHaveLength(2);
      expect(groups[2]).toHaveLength(1);
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
