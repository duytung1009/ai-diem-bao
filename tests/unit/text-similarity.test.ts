import { describe, it, expect } from 'vitest';
import { tokenize, keywordSimilarity, scoreEntryByTokens, scoreGlobalKnowledgeEntry } from '@/lib/text-similarity';
import type { GlobalKnowledgeEntry } from '@/lib/types';

function makeKnowledgeEntry(overrides: Partial<GlobalKnowledgeEntry> = {}): GlobalKnowledgeEntry {
  return {
    id: 'entry-1',
    title: 'Title',
    content: 'Content',
    tags: [],
    sources: [],
    topicRefs: [],
    extractedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('tokenize', () => {
  it('splits simple text into lowercase tokens', () => {
    expect(tokenize('Hello world')).toEqual(['hello', 'world']);
  });

  it('removes punctuation', () => {
    expect(tokenize('Hello, world!')).toEqual(['hello', 'world']);
  });

  it('filters out single-character tokens', () => {
    expect(tokenize('a b c12 d e fg hi')).toEqual(['c12', 'fg', 'hi']);
  });

  it('handles Vietnamese characters', () => {
    const result = tokenize('mèo chó cần câu');
    expect(result).toContain('mèo');
    expect(result).toContain('chó');
    expect(result).toContain('cần');
    expect(result).toContain('câu');
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('keywordSimilarity', () => {
  it('returns ~1 for identical texts', () => {
    expect(keywordSimilarity('mèo chó', 'chó mèo')).toBeCloseTo(1, 5);
  });

  it('returns ~0 for completely different texts', () => {
    expect(keywordSimilarity('mèo', 'chó')).toBe(0);
  });

  it('returns ~0.5 for partial overlap', () => {
    const sim = keywordSimilarity('mèo chó', 'mèo cá');
    expect(sim).toBeCloseTo(1 / 3, 5);
  });

  it('is case-insensitive', () => {
    expect(keywordSimilarity('Hello World', 'hello world')).toBeCloseTo(1, 5);
  });

  it('handles empty inputs', () => {
    expect(keywordSimilarity('', '')).toBe(0);
    expect(keywordSimilarity('text', '')).toBe(0);
  });
});

describe('scoreGlobalKnowledgeEntry', () => {
  it('scores higher for title match', () => {
    const entry = makeKnowledgeEntry({ title: 'kinh tế vi mô', content: 'nội dung khác', tags: [] });
    const qTokens = tokenize('kinh tế');
    const score = scoreGlobalKnowledgeEntry(qTokens, entry);
    expect(score).toBeGreaterThanOrEqual(3);
  });

  it('scores for content match', () => {
    const entry = makeKnowledgeEntry({ title: 'khác', content: 'kinh tế vi mô', tags: [] });
    const qTokens = tokenize('kinh tế');
    const score = scoreGlobalKnowledgeEntry(qTokens, entry);
    expect(score).toBeGreaterThanOrEqual(1);
  });

  it('scores for tag match', () => {
    const entry = makeKnowledgeEntry({ title: 'khác', content: 'khác', tags: ['kinh tế'] });
    const qTokens = tokenize('kinh tế');
    const score = scoreGlobalKnowledgeEntry(qTokens, entry);
    expect(score).toBeGreaterThanOrEqual(2);
  });

  it('returns 0 for no match', () => {
    const entry = makeKnowledgeEntry({ title: 'xyz', content: 'abc', tags: ['def'] });
    const qTokens = tokenize('kinh tế');
    expect(scoreGlobalKnowledgeEntry(qTokens, entry)).toBe(0);
  });
});
