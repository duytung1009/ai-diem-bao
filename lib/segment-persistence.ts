import type { XenForoVersion, TopicSegment, SummaryJSON } from './types';

export interface DenseSegmentsInput {
  existing: (TopicSegment | null)[];
  segIdx: number;
  totalSegments: number;
}

export interface SegmentSavePayloadInput {
  topic: {
    url: string;
    title: string;
    version: XenForoVersion;
    totalPages: number;
    totalPosts: number;
  };
  updatedSegments: (TopicSegment | null)[];
  newSeg: TopicSegment;
  forumPostCount: number;
  /** Single-segment topics also write summary/summaryJson at top level. */
  isSingleSegment: boolean;
  /** When true, totalPosts = Math.max(topic.totalPosts, segTotalPosts). Default: false. */
  useMaxTotal?: boolean;
}

export interface SegmentSavePayload {
  url: string;
  title: string;
  version: XenForoVersion;
  totalPages: number;
  forumPostCount: number;
  totalPosts: number;
  summarizedPostCount: number;
  segments: (TopicSegment | null)[];
  summary?: string;
  summaryJson?: SummaryJSON;
}

/**
 * Build a dense segment array from existing segments, inserting the new segment
 * at segIdx. Pads to max(existing.length, segIdx + 1, totalSegments).
 */
export function makeDenseSegments(input: DenseSegmentsInput): (TopicSegment | null)[] {
  const { existing, segIdx, totalSegments } = input;
  return Array.from(
    { length: Math.max(existing.length, segIdx + 1, totalSegments) },
    (_, i) => existing[i] ?? null,
  );
}

/**
 * Build the payload for SAVE_CACHED_TOPIC after a segment is summarized.
 *
 * Single-segment topics receive `summary`/`summaryJson` at top level.
 * When useMaxTotal is true, totalPosts = Math.max(topic.totalPosts, segTotalPosts)
 * to avoid reducing the count during dynamic auto-summarize.
 */
export function buildSegmentSavePayload(input: SegmentSavePayloadInput): SegmentSavePayload {
  const { topic, updatedSegments, newSeg, forumPostCount, isSingleSegment, useMaxTotal } = input;

  const segTotalPosts = updatedSegments.reduce(
    (s, seg) => s + (seg?.postCount ?? 0), 0,
  );

  const totalPosts = useMaxTotal
    ? Math.max(topic.totalPosts, segTotalPosts)
    : segTotalPosts;

  const payload: SegmentSavePayload = {
    url: topic.url,
    title: topic.title,
    version: topic.version,
    totalPages: topic.totalPages,
    forumPostCount,
    totalPosts,
    summarizedPostCount: segTotalPosts,
    segments: updatedSegments,
  };

  if (isSingleSegment) {
    payload.summary = newSeg.summary;
    payload.summaryJson = newSeg.summaryJson;
  }

  return payload;
}
