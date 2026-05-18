import { describe, it, expect } from 'vitest';
import { planDynamicSegments } from '@/lib/segment-planner';
import { estimateTokens } from '@/lib/token-estimator';
import { postFactory } from '@/tests/fixtures/post-factory';
import type { ScrapedPost } from '@/lib/types';

function makePost(page: number, content: string, postNumber = 1, author = 'user'): ScrapedPost {
  return { author, content, timestamp: '2024-01-01T00:00:00Z', postNumber, page };
}

describe('planDynamicSegments', () => {
  it('returns empty array for empty posts', () => {
    expect(planDynamicSegments([], 4000)).toEqual([]);
  });

  it('single page fits budget → one segment', () => {
    const posts = [makePost(1, 'hello world')];
    const result = planDynamicSegments(posts, 4000);
    expect(result).toEqual([{ start: 1, end: 1 }]);
  });

  it('multiple pages fit budget → one segment', () => {
    const posts = [
      makePost(1, 'page 1 content'),
      makePost(2, 'page 2 content'),
      makePost(3, 'page 3 content'),
    ];
    const result = planDynamicSegments(posts, 4000);
    expect(result).toEqual([{ start: 1, end: 3 }]);
  });

  it('small budget → multiple segments', () => {
    const posts = ['tiny', 'tiny', 'tiny'].map((t, i) => makePost(i + 1, t));
    const totalTokens = posts.reduce(
      (s, p) => s + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
      0,
    );
    const budget = Math.ceil(totalTokens / 2) + 1;
    const result = planDynamicSegments(posts, budget);
    expect(result.length).toBeGreaterThan(1);
    result.forEach((seg, i) => {
      if (i > 0) expect(seg.start).toBe(result[i - 1].end + 1);
    });
  });

  it('single page exceeding budget still included (only page pending)', () => {
    const posts = [makePost(1, 'a'.repeat(5000))];
    const result = planDynamicSegments(posts, 100);
    expect(result).toEqual([{ start: 1, end: 1 }]);
  });

  it('deterministic: same input → same output', () => {
    const posts = postFactory.shortThread(15);
    const resultA = planDynamicSegments(posts, 2000);
    const resultB = planDynamicSegments(posts, 2000);
    expect(resultA).toEqual(resultB);
  });

  it('deterministic: different input order → same output (sorted by page)', () => {
    const posts = [
      makePost(3, 'page 3'),
      makePost(2, 'page 2'),
      makePost(1, 'page 1'),
    ];
    const result = planDynamicSegments(posts, 4000);
    expect(result).toEqual([{ start: 1, end: 3 }]);
  });

  it('handles posts without page field (defaults to page 1)', () => {
    const posts: ScrapedPost[] = [
      { author: 'a', content: 'post1', timestamp: '', postNumber: 1 },
      { author: 'b', content: 'post2', timestamp: '', postNumber: 2 },
    ];
    const result = planDynamicSegments(posts, 4000);
    expect(result).toEqual([{ start: 1, end: 1 }]);
  });

  it('article posts (postNumber < 0) grouped by their page', () => {
    const posts = [
      makePost(1, 'article content', -1, 'news'),
      makePost(1, 'normal content', 1, 'user'),
      makePost(2, 'page 2 content', 2, 'user'),
    ];
    const result = planDynamicSegments(posts, 4000);
    expect(result).toEqual([{ start: 1, end: 2 }]);
  });

  it('empty posts → empty result', () => {
    expect(planDynamicSegments([], 5000)).toEqual([]);
  });

  it('boundary matches online algorithm on short thread', () => {
    const posts = postFactory.shortThread(10);
    const budget = 2000;
    const result = planDynamicSegments(posts, budget);

    let segmentIndex = 0;
    let pendingPosts: ScrapedPost[] = [];
    let pendingTokens = 0;
    let pendingStartPage = 1;
    const pageMap = new Map<number, ScrapedPost[]>();
    for (const p of posts) {
      const pg = p.page ?? 1;
      if (!pageMap.has(pg)) pageMap.set(pg, []);
      pageMap.get(pg)!.push(p);
    }
    const pageNumbers = [...pageMap.keys()].sort((a, b) => a - b);
    const onlineBoundaries: { start: number; end: number }[] = [];

    for (const page of pageNumbers) {
      const pagePosts = pageMap.get(page)!;
      const pageTokens = pagePosts.reduce(
        (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
        0,
      );
      if (pendingTokens + pageTokens > budget && pendingPosts.length > 0) {
        onlineBoundaries.push({ start: pendingStartPage, end: page - 1 });
        pendingPosts = [];
        pendingTokens = 0;
        pendingStartPage = page;
        segmentIndex++;
      }
      pendingPosts.push(...pagePosts);
      pendingTokens += pageTokens;
    }
    if (pendingPosts.length > 0) {
      onlineBoundaries.push({ start: pendingStartPage, end: pageNumbers[pageNumbers.length - 1] });
    }

    expect(result).toEqual(onlineBoundaries);
  });

  it('large budget with medium thread → single segment', () => {
    const posts = postFactory.mediumThread(30);
    const result = planDynamicSegments(posts, 100000);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(1);
  });
});
