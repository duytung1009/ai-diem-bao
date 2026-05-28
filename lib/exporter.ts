import type { CachedTopic, KnowledgeChunk, KnowledgeEntry, ResearchEntry, ScrapedPost, SummaryJSON, ThreadAnalysisJSON } from './types';

export interface ExportedSegment {
  startPage: number;
  endPage: number;
  complete?: boolean;
  posts: ScrapedPost[];
  summary: string;
  summaryJson?: SummaryJSON;
  postCount: number;
  summarizedAt: number;
}

export interface ExportedTopic {
  url: string;
  title: string;
  topicType?: 'discussion' | 'news';
  version: CachedTopic['version'];
  posts: ScrapedPost[];
  lastPostNumber: number;
  cachedAt: number;
  llmConfig: { provider: string; model: string };
  totalPosts: number;
  forumPostCount?: number;
  summarizedPostCount?: number;
  totalPages: number;
  bookmarked?: boolean;

  // Summaries
  summary: string;
  opinions?: string;
  overallSummary?: string;
  summaryJson?: SummaryJSON;
  segments?: ExportedSegment[];

  // Knowledge & research
  knowledgeEntries?: KnowledgeEntry[];
  knowledgeChunks?: KnowledgeChunk[];
  lastKnowledgePostNumber?: number;
  excludedKnowledgePostNumbers?: number[];
  threadAnalysis?: ThreadAnalysisJSON;
  researchHistory?: ResearchEntry[];
}

export interface CacheExport {
  exportedAt: string;
  version: string;
  topicCount: number;
  topics: ExportedTopic[];
}

/** Build export payload with full topic data so imports can restore complete state. */
export function buildCacheExport(topics: CachedTopic[]): CacheExport {
  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    topicCount: topics.length,
    topics: topics.map(stripTopic),
  };
}

function stripTopic(topic: CachedTopic): ExportedTopic {
  return {
    url: topic.url,
    title: topic.title,
    topicType: topic.topicType,
    version: topic.version,
    posts: topic.posts,
    lastPostNumber: topic.lastPostNumber,
    cachedAt: topic.cachedAt,
    llmConfig: topic.llmConfig,
    totalPosts: topic.totalPosts,
    forumPostCount: topic.forumPostCount,
    summarizedPostCount: topic.summarizedPostCount,
    totalPages: topic.totalPages,
    bookmarked: topic.bookmarked,
    summary: topic.summary,
    opinions: topic.opinions,
    overallSummary: topic.overallSummary,
    summaryJson: topic.summaryJson,
    segments: topic.segments?.filter(Boolean).map(({ startPage, endPage, complete, posts, summary, summaryJson, postCount, summarizedAt }) => ({
      startPage, endPage, complete, posts, summary, summaryJson, postCount, summarizedAt,
    })),
    knowledgeEntries: topic.knowledgeEntries,
    knowledgeChunks: topic.knowledgeChunks,
    lastKnowledgePostNumber: topic.lastKnowledgePostNumber,
    excludedKnowledgePostNumbers: topic.excludedKnowledgePostNumbers,
    threadAnalysis: topic.threadAnalysis,
    researchHistory: topic.researchHistory,
  };
}
