export type XenForoVersion = 'xf1' | 'xf2' | 'unknown';

export interface ScrapedPost {
  author: string;
  content: string;
  timestamp: string;
  postNumber: number;
  page?: number;
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

export type LLMProvider = 'openai' | 'claude' | 'gemini' | 'gemini-free' | 'custom';

export interface ProviderSpecificConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  timeoutMs: number;
  maxTokens?: number;
  contextWindow?: number;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
}

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  maxTokens?: number;
  contextWindow?: number;  // Override context window (tokens) for models not in PRICING_TABLE (e.g. local LLMs)
  timeoutMs?: number;
  scrapeDelayMs?: number;
  segmentSize?: number;
  dynamicSegments?: boolean;
  thinkingEnabled?: boolean;  // Enable/disable thinking mode (Gemini thinking models)
  thinkingBudget?: number;    // Max tokens for thinking (0..model max, undefined=auto)
  perProvider?: Partial<Record<LLMProvider, ProviderSpecificConfig>>;
}

export type MessageType =
  | 'DETECT_XF'
  | 'SCRAPE_ARTICLE'
  | 'FETCH_HTML'
  | 'START_LLM_TASK'
  | 'CANCEL_LLM_TASK'
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
  taskType: 'summarize' | 'analyze_opinions' | 'research' | 'extract_knowledge' | 'summarize_segments' | 'extract_knowledge_chunk' | 'reduce_knowledge_chunks' | 'thread_analysis';
  payload: unknown;
}

export interface LLMProgressMessage {
  taskId: string;
  step: number;
  totalSteps: number;
  message: string;
  elapsedMs: number;
  pipeline?: PipelineDefinition;
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
  threadDeleted?: boolean;
  threadLocked?: boolean;
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
  forumPostCount?: number;
  summarizedPostCount?: number;
  totalPages: number;
  topicType?: 'discussion' | 'news';
  segments?: TopicSegment[];
  overallSummary?: string;
  summaryJson?: SummaryJSON;
  bookmarked?: boolean;
  knowledgeEntries?: KnowledgeEntry[];
  knowledgeChunks?: KnowledgeChunk[];     // raw chunks, persistent (F24)
  lastKnowledgePostNumber?: number;
  excludedKnowledgePostNumbers?: number[];
  threadAnalysis?: ThreadAnalysisJSON;
  threadLocked?: boolean;
  threadDeleted?: boolean;
  lastScrapedPage?: number;    // last page fully scraped (for resume after cancel during scrape phase)
}

export interface TopicSegment {
  startPage: number;
  endPage: number;
  posts: ScrapedPost[];
  complete?: boolean;  // false = last segment not yet at budget, more posts may be appended
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

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  category?: string;
  source: {
    author: string;
    postNumber: number;
    timestamp?: string;
  };
  extractedAt: number;
  saved?: boolean;
}

export interface KnowledgeChunk {
  index: number;                // thứ tự chunk, 0-based
  startPostNumber: number;      // post đầu (inclusive)
  endPostNumber: number;        // post cuối (inclusive)
  entries: KnowledgeEntry[];    // raw entries từ chunk này (PRE-reduce)
  extractedAt: number;          // timestamp
  complete?: boolean;           // false = chunk cuối, chưa đầy budget, cho phép append posts mới
}

// --- Thread Analysis types (F25) ---

export interface ThreadUserProfile {
  role: string;
  description: string;
  note: string;
  quote: string;
}

export interface ThreadDebateStream {
  title: string;
  heat: 'high' | 'medium' | 'low';
  description: string;
}

export interface ThreadCombat {
  title: string;
  sideA: string;
  sideB: string;
  note: string;
}

export interface ThreadTimelinePhase {
  name: string;
  pageRange: string;
  events: string[];
}

export interface ThreadNotableComment {
  type: 'defining' | 'insightful' | 'meme';
  author: string;
  text: string;
}

export interface ThreadAnalysisJSON {
  overview: {
    heat: 'hot' | 'normal' | 'low';
    coreConflict: string;
    keyFacts: readonly string[];
    misconception: string;
  };
  userProfiles: ThreadUserProfile[];
  debateStreams: ThreadDebateStream[];
  combats: ThreadCombat[];
  timeline: ThreadTimelinePhase[];
  notableComments: ThreadNotableComment[];
  conclusion: {
    breakdown: { label: string; percent: number }[];
    insightPolicy: string;
    insightPublic: string;
    finalNote: string;
  };
  wuxia: string;
}

export interface SummaryPromptParts {
  task?: string;
  rules?: string;
  structure?: string;
}

export interface SummaryPromptSections {
  direct?: SummaryPromptParts;
  map?: SummaryPromptParts;
  reduce?: SummaryPromptParts;
}

export interface KnowledgePromptParts {
  task?: string;
  rules?: string;
  structure?: string;
}

export interface KnowledgePromptSections {
  extract?: KnowledgePromptParts;
  chunk?: KnowledgePromptParts;
  reduce?: KnowledgePromptParts;
}

export interface CustomPrompts {
  summary?: string | SummaryPromptSections;
  opinions?: string;
  research?: string;
  knowledge?: string | KnowledgePromptSections;
  threadAnalysis?: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export type LLMProgressCallback = (message: string, step?: number, totalSteps?: number) => void;

// --- Pipeline types (Phase 7: Timeline Loading Indicator) ---

export type PipelineStepStatus = 'pending' | 'running' | 'done' | 'error';
export type PipelineWorkflow = 'summarize' | 'knowledge' | 'research';

export interface PipelineStep {
  id: string;
  label: string;
  status: PipelineStepStatus;
  etaMs?: number;
  error?: string;
}

export interface PipelineDefinition {
  workflow: PipelineWorkflow;
  steps: PipelineStep[];
}
