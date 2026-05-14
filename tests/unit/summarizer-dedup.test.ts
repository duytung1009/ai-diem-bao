import { describe, it, expect } from 'vitest';
import { deduplicateSupporters } from '@/lib/llm/summarizer';
import type { SummaryJSON } from '@/lib/types';

describe('deduplicateSupporters', () => {
  it('removes case-insensitive duplicates', () => {
    const input: SummaryJSON = {
      summary: 'Test',
      opinions: [
        {
          title: 'Opinion A',
          description: 'Desc',
          supporters: ['User1', 'user1', 'USER1', 'User2'],
          quotes: [],
        },
      ],
      conclusion: 'End',
    };

    const result = deduplicateSupporters(input);
    expect(result.opinions[0].supporters).toEqual(['User1', 'User2']);
  });

  it('preserves first occurrence casing', () => {
    const input: SummaryJSON = {
      summary: 'Test',
      opinions: [
        {
          title: 'Opinion A',
          description: 'Desc',
          supporters: ['NguyenVanA', 'nguyenvana', 'NGUYENVANA'],
          quotes: [],
        },
      ],
      conclusion: 'End',
    };

    const result = deduplicateSupporters(input);
    expect(result.opinions[0].supporters).toEqual(['NguyenVanA']);
  });

  it('handles empty supporters array', () => {
    const input: SummaryJSON = {
      summary: 'Test',
      opinions: [
        {
          title: 'Opinion A',
          description: 'Desc',
          supporters: [],
          quotes: [],
        },
      ],
      conclusion: 'End',
    };

    const result = deduplicateSupporters(input);
    expect(result.opinions[0].supporters).toEqual([]);
  });

  it('handles no duplicates', () => {
    const input: SummaryJSON = {
      summary: 'Test',
      opinions: [
        {
          title: 'Opinion A',
          description: 'Desc',
          supporters: ['Alice', 'Bob', 'Charlie'],
          quotes: [],
        },
      ],
      conclusion: 'End',
    };

    const result = deduplicateSupporters(input);
    expect(result.opinions[0].supporters).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('deduplicates across multiple opinions independently', () => {
    const input: SummaryJSON = {
      summary: 'Test',
      opinions: [
        {
          title: 'Opinion A',
          description: 'Desc A',
          supporters: ['User1', 'user1', 'User2'],
          quotes: [],
        },
        {
          title: 'Opinion B',
          description: 'Desc B',
          supporters: ['User1', 'USER1', 'User3'],
          quotes: [],
        },
      ],
      conclusion: 'End',
    };

    const result = deduplicateSupporters(input);
    expect(result.opinions[0].supporters).toEqual(['User1', 'User2']);
    expect(result.opinions[1].supporters).toEqual(['User1', 'User3']);
  });

  it('handles Vietnamese diacritics in names', () => {
    const input: SummaryJSON = {
      summary: 'Test',
      opinions: [
        {
          title: 'Opinion A',
          description: 'Desc',
          supporters: ['Nguyễn Văn A', 'nguyễn văn a', 'NGUYỄN VĂN A', 'Trần Văn B'],
          quotes: [],
        },
      ],
      conclusion: 'End',
    };

    const result = deduplicateSupporters(input);
    expect(result.opinions[0].supporters).toEqual(['Nguyễn Văn A', 'Trần Văn B']);
  });

  it('preserves other opinion fields unchanged', () => {
    const input: SummaryJSON = {
      summary: 'Original summary',
      opinions: [
        {
          title: 'Original title',
          description: 'Original description',
          supporters: ['User1', 'user1'],
          quotes: [{ author: 'User1', postNumber: 1, text: 'Quote' }],
        },
      ],
      conclusion: 'Original conclusion',
    };

    const result = deduplicateSupporters(input);
    expect(result.summary).toBe('Original summary');
    expect(result.opinions[0].title).toBe('Original title');
    expect(result.opinions[0].description).toBe('Original description');
    expect(result.opinions[0].quotes).toEqual(input.opinions[0].quotes);
    expect(result.conclusion).toBe('Original conclusion');
  });

  it('handles undefined supporters gracefully', () => {
    const input = {
      summary: 'Test',
      opinions: [
        {
          title: 'Opinion A',
          description: 'Desc',
          quotes: [],
        },
      ],
      conclusion: 'End',
    } as unknown as SummaryJSON;

    const result = deduplicateSupporters(input);
    expect(result.opinions[0].supporters).toEqual([]);
  });
});
