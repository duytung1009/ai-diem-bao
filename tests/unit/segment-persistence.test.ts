import { describe, it, expect } from 'vitest';
import { makeDenseSegments, buildSegmentSavePayload } from '@/lib/segment-persistence';
import type { TopicSegment } from '@/lib/types';
import { postFactory } from '@/tests/fixtures/post-factory';
import { mockSummaryResponses } from '@/tests/fixtures/mock-llm-responses';

const BASE_TOPIC = {
  url: 'https://voz.vn/threads/test.123/',
  title: 'Test Topic',
  version: 'xf2' as const,
  totalPages: 1,
  totalPosts: 20,
};

function makeSegment(overrides: Partial<TopicSegment> = {}): TopicSegment {
  return {
    startPage: 1,
    endPage: 1,
    posts: postFactory.shortThread(10),
    summary: 'test summary',
    summaryJson: mockSummaryResponses.singleSegment,
    postCount: 10,
    summarizedAt: Date.now(),
    ...overrides,
  };
}

describe('Segment-Persistence', () => {
  describe('makeDenseSegments', () => {
    it('creates empty array when no existing segments', () => {
      const result = makeDenseSegments({ existing: [], segIdx: 0, totalSegments: 1 });
      expect(result.length).toBe(1);
      expect(result[0]).toBeNull();
    });

    it('creates dense array with padding for higher segIdx', () => {
      const result = makeDenseSegments({ existing: [], segIdx: 2, totalSegments: 3 });
      expect(result.length).toBe(3);
      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull();
      expect(result[2]).toBeNull();
    });

    it('preserves existing segments at their positions', () => {
      const seg0 = makeSegment({ startPage: 1, endPage: 1 });
      const existing: (TopicSegment | null)[] = [seg0];
      const result = makeDenseSegments({ existing, segIdx: 1, totalSegments: 2 });
      expect(result.length).toBe(2);
      expect(result[0]).toBe(seg0);
      expect(result[1]).toBeNull();
    });

    it('uses totalSegments when larger than existing or segIdx', () => {
      const existing: (TopicSegment | null)[] = [null];
      const result = makeDenseSegments({ existing, segIdx: 0, totalSegments: 5 });
      expect(result.length).toBe(5);
    });
  });

  describe('buildSegmentSavePayload', () => {
    it('CHAR-P1: single segment, fresh — includes top-level summary', () => {
      const newSeg = makeSegment();
      const updated = makeDenseSegments({ existing: [], segIdx: 0, totalSegments: 1 });
      updated[0] = newSeg;

      const payload = buildSegmentSavePayload({
        topic: BASE_TOPIC,
        updatedSegments: updated,
        newSeg,
        forumPostCount: 20,
        isSingleSegment: true,
      });

      expect(payload.url).toBe(BASE_TOPIC.url);
      expect(payload.totalPosts).toBe(10);
      expect(payload.summarizedPostCount).toBe(10);
      expect(payload.segments.length).toBe(1);
      expect(payload.summary).toBe(newSeg.summary);
      expect(payload.summaryJson).toEqual(newSeg.summaryJson);
    });

    it('CHAR-P2: multi segment, fresh — no top-level summary', () => {
      const newSeg = makeSegment();
      const existing: (TopicSegment | null)[] = [
        makeSegment({ startPage: 1, endPage: 3, postCount: 30 }),
      ];
      const updated = makeDenseSegments({ existing, segIdx: 1, totalSegments: 2 });
      updated[1] = newSeg;

      const payload = buildSegmentSavePayload({
        topic: { ...BASE_TOPIC, totalPages: 5, totalPosts: 100 },
        updatedSegments: updated,
        newSeg,
        forumPostCount: 40,
        isSingleSegment: false,
      });

      expect(payload.totalPosts).toBe(40); // 30 + 10
      expect(payload.summarizedPostCount).toBe(40);
      expect(payload.segments.length).toBe(2);
      expect(payload.summary).toBeUndefined();
    });

    it('CHAR-P3: useMaxTotal — totalPosts uses Math.max', () => {
      const newSeg = makeSegment({ postCount: 5 });
      const updated = makeDenseSegments({ existing: [], segIdx: 0, totalSegments: 1 });
      updated[0] = newSeg;

      const payload = buildSegmentSavePayload({
        topic: { ...BASE_TOPIC, totalPosts: 100 },
        updatedSegments: updated,
        newSeg,
        forumPostCount: 10,
        isSingleSegment: true,
        useMaxTotal: true,
      });

      expect(payload.totalPosts).toBe(100); // Math.max(100, 5)
      expect(payload.summarizedPostCount).toBe(5);
    });

    it('CHAR-P4: useMaxTotal false — totalPosts is sum of segment postCounts', () => {
      const newSeg = makeSegment({ postCount: 5 });
      const updated = makeDenseSegments({ existing: [], segIdx: 0, totalSegments: 1 });
      updated[0] = newSeg;

      const payload = buildSegmentSavePayload({
        topic: { ...BASE_TOPIC, totalPosts: 100 },
        updatedSegments: updated,
        newSeg,
        forumPostCount: 10,
        isSingleSegment: true,
        useMaxTotal: false,
      });

      expect(payload.totalPosts).toBe(5); // just the sum, not Math.max
    });

    it('payload includes all required fields', () => {
      const newSeg = makeSegment();
      const updated = makeDenseSegments({ existing: [], segIdx: 0, totalSegments: 1 });
      updated[0] = newSeg;

      const payload = buildSegmentSavePayload({
        topic: BASE_TOPIC,
        updatedSegments: updated,
        newSeg,
        forumPostCount: 20,
        isSingleSegment: true,
      });

      expect(payload.url).toBeDefined();
      expect(payload.title).toBeDefined();
      expect(payload.version).toBeDefined();
      expect(payload.totalPages).toBeDefined();
      expect(typeof payload.forumPostCount).toBe('number');
      expect(typeof payload.totalPosts).toBe('number');
      expect(typeof payload.summarizedPostCount).toBe('number');
      expect(Array.isArray(payload.segments)).toBe(true);
    });
  });
});
