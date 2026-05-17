import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSegmentSavePayload, type SegmentSavePayload } from '@/lib/segment-persistence';
import type { TopicSegment, XenForoVersion } from '@/lib/types';

function makeTopic(overrides: Partial<{ url: string; title: string; version: XenForoVersion; totalPages: number; totalPosts: number }> = {}) {
  return {
    url: 'https://example.com/thread/123/',
    title: 'Test Topic',
    version: 'xf2' as XenForoVersion,
    totalPages: 5,
    totalPosts: 100,
    ...overrides,
  };
}

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

describe('C3: stale-save does not promote summary', () => {
  it('stale payload (isSingleSegment: false) excludes summary/summaryJson', () => {
    const topic = makeTopic();
    const newSeg = makeSegment();
    const updatedSegments: (TopicSegment | null)[] = [newSeg];

    const stalePayload = buildSegmentSavePayload({
      topic,
      updatedSegments,
      newSeg,
      forumPostCount: 100,
      isSingleSegment: false,
    });

    expect(stalePayload.summary).toBeUndefined();
    expect(stalePayload.summaryJson).toBeUndefined();
    expect(stalePayload.segments).toEqual(updatedSegments);
  });

  it('non-stale payload (isSingleSegment: true) includes summary/summaryJson', () => {
    const topic = makeTopic();
    const newSeg = makeSegment();
    const updatedSegments: (TopicSegment | null)[] = [newSeg];

    const savePayload = buildSegmentSavePayload({
      topic,
      updatedSegments,
      newSeg,
      forumPostCount: 100,
      isSingleSegment: true,
    });

    expect(savePayload.summary).toBe('Segment summary');
    expect(savePayload.summaryJson).toEqual(newSeg.summaryJson);
  });

  it('dynamic mode stale payload excludes summary/summaryJson', () => {
    const topic = makeTopic({ totalPages: 50, totalPosts: 1000 });
    const newSeg = makeSegment({ startPage: 1, endPage: 25, summary: 'Dynamic segment 1' });
    const updatedSegments: (TopicSegment | null)[] = [newSeg, null];

    const stalePayload = buildSegmentSavePayload({
      topic,
      updatedSegments,
      newSeg,
      forumPostCount: 1000,
      isSingleSegment: false,
      useMaxTotal: true,
    });

    expect(stalePayload.summary).toBeUndefined();
    expect(stalePayload.summaryJson).toBeUndefined();
    expect(stalePayload.totalPosts).toBe(1000);
  });

  it('dynamic mode non-stale payload includes summary/summaryJson', () => {
    const topic = makeTopic({ totalPages: 50, totalPosts: 1000 });
    const newSeg = makeSegment({ startPage: 1, endPage: 25, summary: 'Dynamic segment 1' });
    const updatedSegments: (TopicSegment | null)[] = [newSeg];

    const savePayload = buildSegmentSavePayload({
      topic,
      updatedSegments,
      newSeg,
      forumPostCount: 1000,
      isSingleSegment: true,
      useMaxTotal: true,
    });

    expect(savePayload.summary).toBe('Dynamic segment 1');
    expect(savePayload.summaryJson).toEqual(newSeg.summaryJson);
  });

  it('multi-segment non-stale payload excludes summary/summaryJson', () => {
    const topic = makeTopic();
    const newSeg = makeSegment({ startPage: 21, endPage: 40 });
    const existingSeg = makeSegment({ startPage: 1, endPage: 20 });
    const updatedSegments: (TopicSegment | null)[] = [existingSeg, newSeg];

    const savePayload = buildSegmentSavePayload({
      topic,
      updatedSegments,
      newSeg,
      forumPostCount: 100,
      isSingleSegment: false,
    });

    expect(savePayload.summary).toBeUndefined();
    expect(savePayload.summaryJson).toBeUndefined();
    expect(savePayload.segments.length).toBe(2);
  });
});
