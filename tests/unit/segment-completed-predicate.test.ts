import { describe, it, expect } from 'vitest';
import { computeResumeState, isCompletedSegment } from '@/lib/segment-planner';
import type { TopicSegment } from '@/lib/types';

function makeSegment(overrides: Partial<TopicSegment> = {}): TopicSegment {
  return {
    startPage: 1,
    endPage: 20,
    posts: [],
    summary: 'Segment summary',
    summaryJson: { summary: 'Segment summary', opinions: [], conclusion: 'Conclusion' },
    postCount: 20,
    summarizedAt: Date.now(),
    ...overrides,
  };
}

describe('C2: unify segment completed predicate to truthy', () => {
  describe('isCompletedSegment', () => {
    it('returns true for segment with non-empty summary', () => {
      const seg = makeSegment({ summary: 'has content' });
      expect(isCompletedSegment(seg)).toBe(true);
    });

    it('returns false for segment with empty summary', () => {
      const seg = makeSegment({ summary: '' });
      expect(isCompletedSegment(seg)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isCompletedSegment(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isCompletedSegment(undefined)).toBe(false);
    });
  });

  describe('computeResumeState with empty summary segments', () => {
    it('only counts segments with non-empty summary as completed', () => {
      const segments: (TopicSegment | null)[] = [
        makeSegment({ startPage: 1, endPage: 20, summary: 'text' }),
        makeSegment({ startPage: 21, endPage: 40, summary: '' }),
        makeSegment({ startPage: 41, endPage: 60, summary: null as unknown as string }),
        null,
      ];

      const result = computeResumeState({ segments });

      expect(result).not.toBeNull();
      expect(result!.segmentIndex).toBe(0);
      expect(result!.fromPage).toBe(20);
    });

    it('returns null when no segments have non-empty summary', () => {
      const segments: (TopicSegment | null)[] = [
        makeSegment({ summary: '' }),
        makeSegment({ summary: '' }),
        null,
      ];

      const result = computeResumeState({ segments });

      expect(result).toBeNull();
    });

    it('returns null when all segments are null', () => {
      const segments: (TopicSegment | null)[] = [null, null, null];

      const result = computeResumeState({ segments });

      expect(result).toBeNull();
    });

    it('always merges into last completed segment', () => {
      const seg1 = makeSegment({ startPage: 1, endPage: 10, summary: 'seg1' });
      const seg2 = makeSegment({ startPage: 11, endPage: 20, summary: 'seg2' });
      const segments: (TopicSegment | null)[] = [seg1, seg2, null];

      const result = computeResumeState({ segments });

      expect(result).not.toBeNull();
      expect(result!.segmentIndex).toBe(1);
      expect(result!.fromPage).toBe(20);
      expect(result!.pendingPosts).toEqual(seg2.posts);
      expect(result!.pendingStartPage).toBe(11);
    });

    it('always merges even when last segment has high usage', () => {
      const manyPosts = Array.from({ length: 100 }, (_, i) => ({
        author: `user${i}`,
        content: 'x'.repeat(500),
        postNumber: i + 1,
        timestamp: '2024-01-01T00:00:00Z',
      }));

      const seg = makeSegment({
        startPage: 1,
        endPage: 5,
        posts: manyPosts,
        summary: 'heavy segment',
      });
      const segments: (TopicSegment | null)[] = [seg, null];

      const result = computeResumeState({ segments });

      expect(result).not.toBeNull();
      expect(result!.segmentIndex).toBe(0);
      expect(result!.fromPage).toBe(5);
      expect(result!.pendingPosts.length).toBe(100);
    });
  });
});
