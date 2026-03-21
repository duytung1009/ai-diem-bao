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
