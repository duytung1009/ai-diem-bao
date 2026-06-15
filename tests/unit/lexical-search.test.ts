import { describe, it, expect } from 'vitest';
import { tokenizeForSearch, buildBm25Index, scoreBm25, rankBm25 } from '@/lib/lexical-search';
import { STOPWORDS_VI } from '@/lib/stopwords-vi';
import type { NotebookEntryForQA } from '@/lib/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<NotebookEntryForQA> & { id: string }): NotebookEntryForQA {
  return {
    title: '',
    content: '',
    tags: [],
    category: undefined,
    userNote: undefined,
    sourceTopicTitle: '',
    source: { author: '', postNumber: 0 },
    ...overrides,
  };
}

// ── stopwords ────────────────────────────────────────────────────────────────

describe('STOPWORDS_VI', () => {
  it('contains common Vietnamese function words', () => {
    for (const word of ['của', 'là', 'và', 'có', 'được', 'trong', 'với', 'không']) {
      expect(STOPWORDS_VI.has(word)).toBe(true);
    }
  });

  it('does NOT contain content-bearing words', () => {
    for (const word of ['máy', 'học', 'mua', 'bán', 'giá', 'tốt', 'xấu', 'nhanh']) {
      expect(STOPWORDS_VI.has(word)).toBe(false);
    }
  });
});

// ── tokenizeForSearch ────────────────────────────────────────────────────────

describe('tokenizeForSearch', () => {
  it('filters out stopwords', () => {
    const tokens = tokenizeForSearch('cách mua xe của bạn');
    expect(tokens).not.toContain('của');
    expect(tokens).not.toContain('bạn');
    expect(tokens).toContain('cách');
    expect(tokens).toContain('mua');
  });

  it('keeps content-bearing terms', () => {
    const tokens = tokenizeForSearch('kinh nghiệm mua laptop');
    expect(tokens).toContain('kinh');
    expect(tokens).toContain('nghiệm');
    expect(tokens).toContain('mua');
    expect(tokens).toContain('laptop');
  });

  it('returns empty array for all-stopword input', () => {
    expect(tokenizeForSearch('và hoặc là của')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(tokenizeForSearch('')).toEqual([]);
  });
});

// ── BM25 scoring properties ──────────────────────────────────────────────────

describe('buildBm25Index + scoreBm25', () => {
  it('IDF: rare term ranks higher than frequent term given equal TF', () => {
    // 'mèo' appears in all 3 docs; 'cá' appears in only 1
    const entries = [
      makeEntry({ id: '1', title: 'mèo nhà mèo cá', content: '' }),
      makeEntry({ id: '2', title: 'mèo ngoài đường', content: '' }),
      makeEntry({ id: '3', title: 'mèo cánh đồng', content: '' }),
    ];
    const index = buildBm25Index(entries);

    const scoreOnRare = scoreBm25(['cá'], index.docs[0], index);    // 'cá' in doc 0 only
    const scoreOnCommon = scoreBm25(['mèo'], index.docs[0], index); // 'mèo' in all 3

    // 'cá' has higher IDF than 'mèo' → its per-term contribution is larger
    expect(scoreOnRare).toBeGreaterThan(scoreOnCommon);
  });

  it('length normalization: short doc wins over long doc with same TF', () => {
    const entries = [
      makeEntry({ id: 'short', content: 'laptop mạnh' }),
      makeEntry({ id: 'long', content: Array(20).fill('word').concat('laptop', 'mạnh').join(' ') }),
    ];
    const index = buildBm25Index(entries);
    const shortScore = scoreBm25(['laptop'], index.docs[0], index);
    const longScore = scoreBm25(['laptop'], index.docs[1], index);
    expect(shortScore).toBeGreaterThan(longScore);
  });

  it('field boost: title match scores higher than content match for the same term', () => {
    const entries = [
      makeEntry({ id: 'title-match', title: 'kinh nghiệm', content: 'thứ khác' }),
      makeEntry({ id: 'content-match', title: 'thứ khác', content: 'kinh nghiệm' }),
    ];
    const index = buildBm25Index(entries);
    const titleScore = scoreBm25(['kinh', 'nghiệm'], index.docs[0], index);
    const contentScore = scoreBm25(['kinh', 'nghiệm'], index.docs[1], index);
    expect(titleScore).toBeGreaterThan(contentScore);
  });

  it('exact-token: "ca" does NOT match "café" or "canh"', () => {
    const entries = [
      makeEntry({ id: '1', title: 'café canh cá', content: '' }),
    ];
    const index = buildBm25Index(entries);
    // tokenizeForSearch('café canh cá') produces tokens without 'ca'
    // scoreBm25 does exact match, so querying 'ca' should score 0
    const score = scoreBm25(['ca'], index.docs[0], index);
    expect(score).toBe(0);
  });

  it('returns 0 for empty query tokens', () => {
    const entries = [makeEntry({ id: '1', title: 'laptop', content: '' })];
    const index = buildBm25Index(entries);
    expect(scoreBm25([], index.docs[0], index)).toBe(0);
  });

  it('returns 0 when corpus has no docs', () => {
    const index = buildBm25Index([]);
    // N=0 → score is 0 by guard
    const emptyDoc = { id: 'x', title: [], content: [], tags: [], category: [], note: [] };
    expect(scoreBm25(['laptop'], emptyDoc, index)).toBe(0);
  });
});

// ── rankBm25 ─────────────────────────────────────────────────────────────────

describe('rankBm25', () => {
  it('returns entries sorted by descending score', () => {
    const entries = [
      makeEntry({ id: 'a', title: 'laptop gaming mạnh', content: '' }),
      makeEntry({ id: 'b', title: 'nồi cơm điện', content: '' }),
      makeEntry({ id: 'c', title: 'laptop văn phòng hiệu năng', content: '' }),
    ];
    const ranked = rankBm25('laptop hiệu năng', entries);
    expect(ranked[0].entry.id).toBe('c');   // "laptop" AND "hiệu năng" in title
    expect(ranked[1].entry.id).toBe('a');   // "laptop" only
    expect(ranked[2].entry.id).toBe('b');   // no match
  });

  it('falls back to original order when query is all-stopword', () => {
    const entries = [
      makeEntry({ id: 'a', title: 'alpha' }),
      makeEntry({ id: 'b', title: 'beta' }),
    ];
    const ranked = rankBm25('và hoặc là', entries);
    // scores are all 0 → rankBm25 returns as-is (score=0 for all)
    expect(ranked.map(r => r.entry.id)).toEqual(['a', 'b']);
  });

  it('returns empty array for empty entries', () => {
    expect(rankBm25('laptop', [])).toEqual([]);
  });

  it('does not throw for entries with missing optional fields', () => {
    const entries = [makeEntry({ id: 'x', title: 'laptop', content: '' })];
    expect(() => rankBm25('laptop', entries)).not.toThrow();
  });
});
