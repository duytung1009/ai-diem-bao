import type { CachedTopic, KnowledgeEntry, ResearchEntry, SummaryJSON } from './types';

export interface ExportedSegment {
  startPage: number;
  endPage: number;
  summary: string;
  summaryJson?: SummaryJSON;
  postCount: number;
  summarizedAt: number;
}

export interface ExportedTopic {
  url: string;
  title: string;
  topicType?: 'discussion' | 'news';
  cachedAt: number;
  llmConfig: { provider: string; model: string };
  totalPosts: number;
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
  researchHistory?: ResearchEntry[];
}

export interface CacheExport {
  exportedAt: string;
  version: '1.0';
  topicCount: number;
  topics: ExportedTopic[];
}

/** Strip heavy fields (raw posts, pre-reduce chunks) and build export payload. */
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
    cachedAt: topic.cachedAt,
    llmConfig: topic.llmConfig,
    totalPosts: topic.totalPosts,
    summarizedPostCount: topic.summarizedPostCount,
    totalPages: topic.totalPages,
    bookmarked: topic.bookmarked,
    summary: topic.summary,
    opinions: topic.opinions,
    overallSummary: topic.overallSummary,
    summaryJson: topic.summaryJson,
    segments: topic.segments?.filter(Boolean).map(({ startPage, endPage, summary, summaryJson, postCount, summarizedAt }) => ({
      startPage, endPage, summary, summaryJson, postCount, summarizedAt,
    })),
    knowledgeEntries: topic.knowledgeEntries,
    researchHistory: topic.researchHistory,
  };
}
