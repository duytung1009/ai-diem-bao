import type { LLMConfig, ThemeMode } from './types';

export const STORAGE_KEYS = {
  SETTINGS: 'llm-settings',
  CACHE_PREFIX: 'cache:',  // Legacy — chỉ dùng bởi one-time migration từ storage.local sang IndexedDB
  CUSTOM_PROMPTS: 'custom-prompts',
  THEME: 'theme-mode',
  MODEL_SPEED_STATS: 'model-speed-stats',
} as const;

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.3,
  timeoutMs: 120000,
};

export const DEFAULT_THEME: ThemeMode = 'system';

export const DEFAULT_SCRAPE_DELAY_MS = 2000;
export const DEFAULT_SEGMENT_SIZE = 20;

// Dynamic segments
export const CONTEXT_USAGE_RATIO = 0.75;
export const DEFAULT_DYNAMIC_SEGMENTS = true;

// LLM task
export const KEEPALIVE_INTERVAL_MS = 20_000;
export const FALLBACK_MS_PER_TOKEN = 20;
export const LLM_TASK_CLEANUP_DELAY_MS = 5_000;
export const MAP_REDUCE_CHUNK_DELAY_MS = 100;
export const RESPONSE_BUFFER_TOKENS = 2_000;

// LLM cost guard
export const LLM_WARN_THRESHOLD_CALLS = 5; // warn if estimated LLM calls > this

// Cache freshness
export const FRESHNESS_ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const FRESHNESS_ONE_WEEK_MS = 7 * FRESHNESS_ONE_DAY_MS;


// Knowledge reduce — output overflow prevention
export const TOKENS_PER_KNOWLEDGE_ENTRY = 100;
export const REDUCE_OUTPUT_FRACTION = 0.35;
// Knowledge chunks — hard cap on post tokens per chunk to prevent LLM overload
// (models with 128K+ context would otherwise get 80K+ token chunks, degrading output quality)
export const KNOWLEDGE_MAX_CHUNK_BUDGET = 12_000;
