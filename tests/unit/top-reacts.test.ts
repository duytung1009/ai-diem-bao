import { describe, it, expect } from 'vitest';
import { computeTopReacts } from '@/lib/top-reacts';
import type { ScrapedPost } from '@/lib/types';

function makePost(overrides: Partial<ScrapedPost>): ScrapedPost {
  return {
    author: 'user',
    content: 'content',
    timestamp: '2024-01-01T00:00:00Z',
    postNumber: 1,
    ...overrides,
  };
}

describe('computeTopReacts', () => {
  it('returns empty array when posts empty', () => {
    expect(computeTopReacts([])).toEqual([]);
  });

  it('returns empty when no posts have reactions', () => {
    const posts = [makePost({ postNumber: 1 }), makePost({ postNumber: 2 })];
    expect(computeTopReacts(posts)).toEqual([]);
  });

  it('returns empty when all reactions are 0', () => {
    const posts = [makePost({ postNumber: 1, reactions: { like: 0, dislike: 0 } })];
    expect(computeTopReacts(posts)).toEqual([]);
  });

  it('returns top likes sorted descending', () => {
    const posts = [
      makePost({ author: 'a', postNumber: 1, reactions: { like: 5 } }),
      makePost({ author: 'b', postNumber: 2, reactions: { like: 10 } }),
      makePost({ author: 'c', postNumber: 3, reactions: { like: 3 } }),
    ];
    const result = computeTopReacts(posts, 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'like', count: 10, author: 'b', postNumber: 2 });
    expect(result[1]).toMatchObject({ type: 'like', count: 5, author: 'a', postNumber: 1 });
  });

  it('returns top dislikes after likes', () => {
    const posts = [
      makePost({ author: 'a', postNumber: 1, reactions: { dislike: 7 } }),
      makePost({ author: 'b', postNumber: 2, reactions: { dislike: 3 } }),
    ];
    const result = computeTopReacts(posts, 3);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'dislike', count: 7, author: 'a', postNumber: 1 });
    expect(result[1]).toMatchObject({ type: 'dislike', count: 3, author: 'b', postNumber: 2 });
  });

  it('combines likes then dislikes in correct order', () => {
    const posts = [
      makePost({ author: 'a', postNumber: 1, reactions: { like: 5, dislike: 2 } }),
      makePost({ author: 'b', postNumber: 2, reactions: { dislike: 10 } }),
      makePost({ author: 'c', postNumber: 3, reactions: { like: 8 } }),
    ];
    const result = computeTopReacts(posts, 2);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ type: 'like', count: 8 });
    expect(result[1]).toMatchObject({ type: 'like', count: 5 });
    expect(result[2]).toMatchObject({ type: 'dislike', count: 10 });
    expect(result[3]).toMatchObject({ type: 'dislike', count: 2 });
  });

  it('respects topN limit per type', () => {
    const posts = Array.from({ length: 10 }, (_, i) =>
      makePost({ author: `u${i}`, postNumber: i, reactions: { like: i * 10 } }),
    );
    const result = computeTopReacts(posts, 3);
    expect(result).toHaveLength(3);
    expect(result[0].count).toBe(90);
    expect(result[1].count).toBe(80);
    expect(result[2].count).toBe(70);
  });

  it('handles fewer results than topN', () => {
    const posts = [makePost({ author: 'a', postNumber: 1, reactions: { like: 3 } })];
    const result = computeTopReacts(posts, 5);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(3);
  });

  it('ignores posts with reactions undefined', () => {
    const posts = [
      makePost({ author: 'a', postNumber: 1, reactions: { like: 5 } }),
      makePost({ author: 'b', postNumber: 2 }),
      makePost({ author: 'c', postNumber: 3, reactions: undefined }),
    ];
    const result = computeTopReacts(posts, 3);
    expect(result).toHaveLength(1);
    expect(result[0].author).toBe('a');
  });
});
