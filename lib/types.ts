export type XenForoVersion = 'xf1' | 'xf2' | 'unknown';

export interface ScrapedPost {
  author: string;
  content: string;
  timestamp: string;
  postNumber: number;
}

export interface TopicData {
  url: string;
  title: string;
  version: XenForoVersion;
  posts: ScrapedPost[];
  totalPages: number;
  currentPage: number;
}

export interface SummaryResult {
  main?: string;
  opinions?: string;
  research?: string;
}

export interface QuoteItem {
  author: string;
  postNumber: number;
  text: string;
}

export interface OpinionItem {
  title: string;
  description: string;
  supporters: string[];
  quotes: QuoteItem[];
}

export interface SummaryJSON {
  summary: string;
  opinions: OpinionItem[];
  conclusion: string;
}

export interface LLMConfig {
  provider: 'openai' | 'claude' | 'gemini' | 'custom';
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  maxTokens?: number;
  timeoutMs?: number;
  scrapeDelayMs?: number;
  segmentSize?: number;
}

export type MessageType =
  | 'DETECT_XF'
  | 'SCRAPE_TOPIC'
  | 'SCRAPE_ALL_PAGES'
  | 'SCRAPE_PAGE_RANGE'
  | 'SCRAPE_PROGRESS'
  | 'SCRAPE_ARTICLE'
  | 'CANCEL_SCRAPE'
  | 'START_LLM_TASK'
  | 'LLM_PROGRESS'
  | 'LLM_RESULT'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS'
  | 'TEST_CONNECTION'
  | 'GET_CUSTOM_PROMPTS'
  | 'SAVE_CUSTOM_PROMPTS'
  | 'GET_CACHED_TOPIC'
  | 'SAVE_CACHED_TOPIC'
  | 'DELETE_CACHED_TOPIC'
  | 'GET_CACHE_SIZE'
  | 'GET_ALL_CACHED_TOPICS';

export interface LLMTaskRequest {
  taskId: string;
  taskType: 'summarize' | 'summarize_incremental' | 'analyze_opinions' | 'research';
  payload: unknown;
}

export interface LLMProgressMessage {
  taskId: string;
  step: number;
  totalSteps: number;
  message: string;
  elapsedMs: number;
}

export interface LLMResultMessage {
  taskId: string;
  taskType: string;
  success: boolean;
  data?: unknown;
  error?: string;
  stats: {
    elapsedMs: number;
    inputTokens: number;
    outputTokens: number;
    mapReduceSteps: number;
  };
}

export interface ModelSpeedStats {
  model: string;
  tokensPerSecond: number;
  samples: number;
  lastUpdated: number;
}

export interface Message<T = unknown> {
  type: MessageType;
  payload?: T;
}

export interface DetectResult {
  version: XenForoVersion;
  title: string;
  postCount: number;
  pageCount: number;
}

export interface PageProgress {
  currentPage: number;
  totalPages: number;
  postsScraped: number;
}

export type CacheFreshness = 'fresh' | 'stale' | 'outdated';

export interface CachedTopic {
  url: string;
  title: string;
  version: XenForoVersion;
  posts: ScrapedPost[];
  summary: string;
  opinions?: string;
  researchHistory?: ResearchEntry[];
  llmConfig: { provider: string; model: string };
  cachedAt: number;
  lastPostNumber: number;
  totalPosts: number;
  summarizedPostCount?: number;
  totalPages: number;
  topicType?: 'discussion' | 'news';
  segments?: TopicSegment[];
  overallSummary?: string;
  summaryJson?: SummaryJSON;
}

export interface TopicSegment {
  startPage: number;
  endPage: number;
  posts: ScrapedPost[];
  summary: string;
  summaryJson?: SummaryJSON;
  postCount: number;
  summarizedAt: number;
}

export interface ResearchEntry {
  question: string;
  answer: string;
  askedAt: number;
}

export interface CustomPrompts {
  summary?: string;
  opinions?: string;
  research?: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';
