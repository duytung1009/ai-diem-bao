import type { CachedTopic, KnowledgeChunk, KnowledgeEntry, NotebookEntry, ResearchEntry, ScrapedPost, SummaryJSON, ThreadAnalysisJSON } from './types';

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

export type ExportScope = 'full' | 'summary' | 'knowledge' | 'notebook';

export interface CacheExport {
  exportedAt: string;
  version: string;
  scope?: ExportScope;  // undefined = 'full' (backward compat)
  topicCount: number;
  topics: ExportedTopic[];
  notebookEntries?: NotebookEntry[];  // chỉ có khi scope = 'notebook'
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

/** Trigger a JSON file download in the browser. */
export function downloadJson(payload: object, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/** Sanitize a topic title into a safe filename fragment. */
export function safeFilename(title: string, maxLen = 60): string {
  return title.replace(/[^\p{L}\p{N}\s]/gu, '').trim().slice(0, maxLen) || 'topic';
}

/** Export tóm tắt của 1 thread (không có posts, segments, knowledge). */
export function buildSummaryExport(topic: CachedTopic): CacheExport {
  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    scope: 'summary',
    topicCount: 1,
    topics: [{
      url: topic.url,
      title: topic.title,
      topicType: topic.topicType,
      version: topic.version,
      posts: [],
      lastPostNumber: topic.lastPostNumber,
      cachedAt: topic.cachedAt,
      llmConfig: topic.llmConfig,
      totalPosts: topic.totalPosts,
      forumPostCount: topic.forumPostCount,
      summarizedPostCount: topic.summarizedPostCount,
      totalPages: topic.totalPages,
      summary: topic.summary,
      overallSummary: topic.overallSummary,
    }],
  };
}

/** Export kiến thức (KnowledgeEntry[]) của 1 thread. */
export function buildKnowledgeExport(topic: CachedTopic): CacheExport {
  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    scope: 'knowledge',
    topicCount: 1,
    topics: [{
      url: topic.url,
      title: topic.title,
      topicType: topic.topicType,
      version: topic.version,
      posts: [],
      lastPostNumber: topic.lastPostNumber,
      cachedAt: topic.cachedAt,
      llmConfig: topic.llmConfig,
      totalPosts: topic.totalPosts,
      totalPages: topic.totalPages,
      summary: '',
      knowledgeEntries: topic.knowledgeEntries,
      knowledgeChunks: topic.knowledgeChunks,
      lastKnowledgePostNumber: topic.lastKnowledgePostNumber,
      excludedKnowledgePostNumbers: topic.excludedKnowledgePostNumbers,
    }],
  };
}

/** Export các mục đã lưu trong sổ tay (NotebookEntry[]) theo nhóm thread. */
export function buildNotebookExport(entries: NotebookEntry[]): CacheExport {
  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    scope: 'notebook',
    topicCount: 0,
    topics: [],
    notebookEntries: entries,
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
