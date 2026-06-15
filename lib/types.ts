export type XenForoVersion = 'xf1' | 'xf2' | 'unknown';

export interface UserMeta {
  messageCount?: number;   // Total posts in the whole forum
  reactionScore?: number;  // Reaction score / likes received
  joinDate?: string;       // ISO string or raw text from DOM
  userTitle?: string;      // Rank/title text (e.g. "Senior Member", "Junior Member")
}

export type TrustFlag =
  | 'new_account'          // join date < 90 days from scrape date
  | 'low_post_count'       // messageCount < 50
  | 'low_reaction_ratio'   // reactionScore / messageCount < 0.05
  | 'high_thread_activity' // postCountInThread > 5 AND score already low
  | 'voz_rank_restricted'    // VOZ rank is New Member or Junior Member (posting restricted)
  | 'otofun_rank_restricted' // OtoFun rank is Xe đạp or Xe máy (new member tier)
  | 'no_meta';             // No metadata available to evaluate

export interface TrustScore {
  username: string;
  score: number;              // 0–100, lower = more suspicious
  flags: readonly TrustFlag[];
  postCountInThread: number;
  meta?: UserMeta;
}

export interface PostReactions {
  like?: number;
  dislike?: number;
}

export interface TopReactItem {
  type: 'like' | 'dislike';
  count: number;
  author: string;
  postNumber: number;
}

export interface ScrapedPost {
  author: string;
  content: string;
  timestamp: string;
  postNumber: number;
  page?: number;
  userMeta?: UserMeta;
  reactions?: PostReactions;
}

export interface ForumThreadSummary {
  title: string;
  url: string;
  author: string;
  authorUrl?: string;
  startDate: string;
  replyCount: number;
  viewCount: number;
  lastPostAuthor: string;
  lastPostTime: string;
  lastPostUrl?: string;
  isSticky: boolean;
  isLocked: boolean;
  pageCount: number;
  forumName?: string;
  hasPoll?: boolean;
}

export interface ForumListRequest {
  forumUrl: string;
  page?: number;
}

export interface ForumListResult {
  threads: ForumThreadSummary[];
  page: number;
  totalPages?: number;
  errors: string[];
  forumUrl: string;
  forumName?: string;
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

export interface CostEstimate {
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedMs: number;
  costUsd: number | null; // null if model has no pricing (local/unknown)
  model: string;
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

export type LLMProvider = 'openai' | 'claude' | 'gemini' | 'openrouter' | 'custom' | 'deepseek' | 'grok';

export interface ProviderSpecificConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  timeoutMs: number;
  maxTokens?: number;
  knowledgeMaxTokens?: number;
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
  knowledgeMaxTokens?: number;
  contextWindow?: number;  // Override context window (tokens) for models not in PRICING_TABLE (e.g. local LLMs)
  timeoutMs?: number;
  scrapeDelayMs?: number;
  segmentSize?: number;
  dynamicSegments?: boolean;
  thinkingEnabled?: boolean;  // Enable/disable thinking mode (Gemini thinking models)
  thinkingBudget?: number;    // Max tokens for thinking (0..model max, undefined=auto)
  perProvider?: Partial<Record<LLMProvider, ProviderSpecificConfig>>;
}

export interface UserForum {
  id: string;
  hostname: string;
  matchPattern: string;
  origins: string[];
  addedAt: number;
}

export interface NewsFeedSettings {
  maxThreads: number;
  maxAgeHours: number;
  autoRefresh: boolean;
  selectedForums: string[];
  heatThresholds: { fire: number; hot: number };
  weights: { reply: number; view: number; page: number };
}

export type MessageType =
  | 'DETECT_XF'
  | 'SCRAPE_ARTICLE'
  | 'FETCH_HTML'
  | 'IMPORT_CACHE'
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
  | 'GET_ALL_CACHED_TOPICS'
  | 'GET_NOTEBOOK_ENTRIES'
  | 'GET_NOTEBOOK_STATS'
  | 'UPSERT_NOTEBOOK_ENTRY'
  | 'DELETE_NOTEBOOK_ENTRY'
  | 'ORPHAN_NOTEBOOK_BY_TOPIC'
  | 'DELETE_NOTEBOOK_BY_TOPIC'
  | 'BULK_UPDATE_NOTEBOOK_ENTRIES'
  | 'BULK_DELETE_NOTEBOOK_ENTRIES'
  | 'GET_USER_FORUMS'
  | 'ADD_USER_FORUM'
  | 'REMOVE_USER_FORUM'
  | 'FETCH_FORUM_LIST'
  | 'FORUM_LIST_RESULT'
  | 'GET_PAGE_URL'
  | 'GET_ALL_KNOWLEDGE'
  | 'UPSERT_KNOWLEDGE_ENTRY'
  | 'DELETE_KNOWLEDGE_ENTRY'
  | 'INSERT_KNOWLEDGE_WITH_DEDUP';

export interface LLMTaskRequest {
  taskId: string;
  taskType: 'summarize' | 'analyze_opinions' | 'research' | 'summarize_segments' | 'extract_knowledge_chunk' | 'reduce_knowledge_chunks' | 'thread_analysis' | 'notebook_qa';
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
  /** URL của tab, lấy từ location.href trong content script (không cần tabs permission) */
  url?: string;
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
  /** Only entries with saved=true are persisted to cache; unsaved entries are in-memory only */
  knowledgeEntries?: KnowledgeEntry[];
  knowledgeChunks?: KnowledgeChunk[];     // raw chunks, persistent (F24)
  knowledgeReducedAt?: number;            // F33: timestamp of last reduce phase; for staleness detection
  lastKnowledgePostNumber?: number;
  excludedKnowledgePostNumbers?: number[];
  threadAnalysis?: ThreadAnalysisJSON;
  threadLocked?: boolean;
  threadDeleted?: boolean;
  lastScrapedPage?: number;    // last page fully scraped (for resume after cancel during scrape phase)
  userTrustScores?: Record<string, TrustScore>;
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

export interface KnowledgeSource {
  topicUrl?: string;
  topicTitle?: string;
  author: string;
  postNumber: number;
  timestamp?: string;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  category?: string;
  source: KnowledgeSource;
  extractedAt: number;
  saved?: boolean;
}

export interface GlobalKnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  category?: string;
  sources: KnowledgeSource[];
  topicRefs: string[];
  extractedAt: number;
  updatedAt: number;
  mergedCount?: number;
  vector?: number[];
}

export interface NotebookEntry extends KnowledgeEntry {
  sourceTopicUrl: string;
  sourceTopicTitle: string;
  savedAt: number;
  orphaned?: number;
  orphanedAt?: number;
  userNote?: string;    // ghi chú cá nhân của user
  pinned?: number;      // 1 = ghim lên đầu (number để IDB index được)
  editedAt?: number;    // timestamp lần sửa cuối
  manual?: number;      // 1 = entry user tự tạo, không từ LLM extract
  fromQA?: number;     // 1 = lưu từ câu trả lời Hỏi đáp
}

export interface NotebookEntryForQA {
  id: string;
  title: string;
  content: string;
  userNote?: string;
  category?: string;
  tags: string[];
  sourceTopicTitle: string;
  source: { author: string; postNumber: number };
}

export interface KnowledgeChunk {
  index: number;                // thứ tự chunk, 0-based
  startPostNumber: number;      // post đầu (inclusive)
  endPostNumber: number;        // post cuối (inclusive)
  entries: KnowledgeEntry[];    // raw entries từ chunk này (PRE-reduce)
  extractedAt: number;          // timestamp
  complete?: boolean;           // false = chunk cuối, chưa đầy budget, cho phép append posts mới
  failed?: boolean;             // true = chunk bị truncate (max_tokens), entries là partial
  segmentIndex?: number;        // F33: index vào cachedTopic.segments[], undefined = legacy chunk
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
