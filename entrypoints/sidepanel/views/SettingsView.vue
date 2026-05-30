<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch } from 'vue';
import { sendMessage } from '@/lib/messaging';
import { STORAGE_KEYS, DEFAULT_LLM_CONFIG, DEFAULT_SCRAPE_DELAY_MS, DEFAULT_SEGMENT_SIZE, DEFAULT_DYNAMIC_SEGMENTS } from '@/lib/constants';
import type { LLMConfig, LLMProvider, CustomPrompts, CachedTopic, CostEstimate } from '@/lib/types';
import { getProviderOrigin } from '@/lib/llm/provider-origins';
import { requestOriginPermission, hasOriginPermission } from '@/lib/permissions';
import { buildCacheExport } from '@/lib/exporter';
import { validateCacheExport, type ImportConflictMode, type ImportResult } from '@/lib/importer';
import { getModelThinkingBudget, modelSupportsThinking } from '@/lib/token-estimator';
import PillTabs from '../components/PillTabs.vue';
import { useForumManager } from '../composables/useForumManager';
import ShowDefaultButton from '../components/ShowDefaultButton.vue';
import {
  SUMMARY_DEFAULT_TASKS,
  SUMMARY_DEFAULT_RULES,
  SUMMARY_DEFAULT_STRUCTURE,
  buildSummaryPrompt,
  KNOWLEDGE_DEFAULT_TASKS,
  KNOWLEDGE_DEFAULT_RULES,
  KNOWLEDGE_DEFAULT_STRUCTURE,
  buildKnowledgePrompt,
  RESEARCH_PROMPT,
  THREAD_ANALYSIS_PROMPT,
} from '@/lib/prompts';
import type { KnowledgePromptSections, SummaryPromptSections } from '@/lib/types';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import CostConfirmModal from '../components/CostConfirmModal.vue';
import { useTheme } from '../composables/useTheme';
import { useSeederDetection } from '../composables/useSeederDetection';

const config = ref<LLMConfig>({ ...DEFAULT_LLM_CONFIG });
const showApiKey = ref(false);
const saving = ref(false);
const testing = ref(false);

const providerDefaults: Record<LLMProvider, { model: string; apiKey: string; baseUrl: string; temperature: number; timeoutMs: number; maxTokens: number; contextWindow: number | undefined; thinkingEnabled: boolean; thinkingBudget: number | undefined }> = {
  openai: { model: 'gpt-4o-mini', apiKey: '', baseUrl: 'https://api.openai.com/v1', temperature: 0.3, timeoutMs: 120000, maxTokens: 4096, contextWindow: 128000, thinkingEnabled: false, thinkingBudget: undefined },
  openrouter: { model: 'openai/gpt-oss-20b:free', apiKey: '', baseUrl: 'https://openrouter.ai/api/v1', temperature: 0.3, timeoutMs: 120000, maxTokens: 8192, contextWindow: 131100, thinkingEnabled: false, thinkingBudget: undefined },
  custom: { model: '', apiKey: '', baseUrl: 'https://api.openai.com/v1', temperature: 0.3, timeoutMs: 120000, maxTokens: 4096, contextWindow: undefined, thinkingEnabled: false, thinkingBudget: undefined },
  claude: { model: 'claude-sonnet-4-6', apiKey: '', baseUrl: '', temperature: 0.3, timeoutMs: 120000, maxTokens: 4096, contextWindow: 1000000, thinkingEnabled: false, thinkingBudget: undefined },
  gemini: { model: 'gemini-2.5-flash', apiKey: '', baseUrl: '', temperature: 0.3, timeoutMs: 120000, maxTokens: 4096, contextWindow: 1000000, thinkingEnabled: false, thinkingBudget: undefined },

};

function syncCurrentProvider() {
  if (!config.value.perProvider) config.value.perProvider = {};
  config.value.perProvider[config.value.provider] = {
    model: config.value.model,
    apiKey: config.value.apiKey,
    baseUrl: config.value.baseUrl,
    temperature: config.value.temperature,
    timeoutMs: config.value.timeoutMs ?? 120000,
    maxTokens: config.value.maxTokens ?? 4096,
    knowledgeMaxTokens: config.value.knowledgeMaxTokens,
    contextWindow: config.value.contextWindow,
    thinkingEnabled: config.value.thinkingEnabled,
    thinkingBudget: config.value.thinkingBudget,
  };
}
const testResult = ref<'success' | 'fail' | ''>('');
const testErrorDetail = ref('');
const saveMessage = ref('');
const cacheSizeBytes = ref(0);
const storageQuotaBytes = ref(0);
const showClearConfirm = ref(false);
const exporting = ref(false);
const importing = ref(false);
const importResult = ref<ImportResult | null>(null);
const importError = ref('');
const conflictMode = ref<ImportConflictMode>('skip');
const fileInput = ref<HTMLInputElement | null>(null);

const needsReauth = ref(false);
const reauthGranting = ref(false);
const reauthMessage = ref('');

async function checkReauthNeeded() {
  const result = await browser.storage.local.get(STORAGE_KEYS.NEEDS_PERMISSION_REAUTH);
  if (result[STORAGE_KEYS.NEEDS_PERMISSION_REAUTH] !== true) return;

  // Chỉ show banner nếu permission thực sự bị thiếu
  const origin = getProviderOrigin(config.value.provider, config.value.baseUrl);
  if (!origin) return;

  needsReauth.value = !(await hasOriginPermission(origin));
  if (!needsReauth.value) {
    await browser.storage.local.remove(STORAGE_KEYS.NEEDS_PERMISSION_REAUTH);
  }
}

async function handleReauthGrant() {
  reauthGranting.value = true;
  reauthMessage.value = '';
  try {
    const granted = await requestProviderPermission(config.value.provider, config.value.baseUrl);
    if (granted) {
      await browser.storage.local.remove(STORAGE_KEYS.NEEDS_PERMISSION_REAUTH);
      needsReauth.value = false;
      reauthMessage.value = 'Đã cấp quyền thành công!';
    } else {
      reauthMessage.value = 'Chưa được cấp quyền.';
    }
  } catch (err) {
    reauthMessage.value = `Lỗi: ${String(err)}`;
  } finally {
    reauthGranting.value = false;
  }
}

const clearCacheConfirmEstimate: CostEstimate = {
  apiCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedMs: 0,
  costUsd: 0,
  model: 'local-cache',
};

const { themeMode: currentTheme, setTheme } = useTheme();
const { showTrustBadges, loadSetting: loadSeederSetting, setShowTrustBadges } = useSeederDetection();
const { userForums, loadForums, addForumByHostname, addForumFromUrl, removeForum } = useForumManager();
const newForumUrl = ref('');
const addingForum = ref(false);
const addForumError = ref('');

async function addForum() {
  addForumError.value = '';
  const result = await addForumFromUrl(newForumUrl.value);
  if (result.ok) {
    newForumUrl.value = '';
  } else if (result.error) {
    addForumError.value = result.error;
  }
}
const themeOptions = [
  { value: 'light' as const, label: 'Sáng' },
  { value: 'dark' as const, label: 'Tối' },
  { value: 'system' as const, label: 'Hệ thống' },
];

// Custom prompts
const customPrompts = ref<CustomPrompts>({});
const activePromptTab = ref<'summary' | 'knowledge' | 'research' | 'threadAnalysis'>('summary');
const promptSaveMessage = ref('');
const promptError = ref('');
const showDefaultPrompt = ref(false);

// Summary sub-mode tabs
const activeSummaryMode = ref<'direct' | 'map' | 'reduce'>('direct');
const summarySections = ref<{
  direct: { task: string; rules: string; structure: string };
  map: { task: string; rules: string; structure: string };
  reduce: { task: string; rules: string; structure: string };
}>({
  direct: { task: '', rules: '', structure: '' },
  map: { task: '', rules: '', structure: '' },
  reduce: { task: '', rules: '', structure: '' },
});
const showSummaryDefault = ref<Record<string, boolean>>({ task: false, rules: false, structure: false });

function getSummaryDefault(mode: 'direct' | 'map' | 'reduce', section: 'task' | 'rules' | 'structure'): string {
  if (section === 'task') return SUMMARY_DEFAULT_TASKS[mode];
  if (section === 'rules') return SUMMARY_DEFAULT_RULES;
  return SUMMARY_DEFAULT_STRUCTURE;
}

function loadSummarySections() {
  const sp = customPrompts.value.summary;
  const modes: ('direct' | 'map' | 'reduce')[] = ['direct', 'map', 'reduce'];
  for (const mode of modes) {
    const saved = typeof sp === 'object' && sp ? sp[mode] : undefined;
    summarySections.value[mode] = {
      task: saved?.task ?? '',
      rules: saved?.rules ?? '',
      structure: saved?.structure ?? '',
    };
  }
}

function getSummarySectionValue(mode: 'direct' | 'map' | 'reduce', section: 'task' | 'rules' | 'structure'): string {
  const val = summarySections.value[mode][section];
  return val || getSummaryDefault(mode, section);
}

function setSummarySectionValue(mode: 'direct' | 'map' | 'reduce', section: 'task' | 'rules' | 'structure', val: string) {
  summarySections.value[mode][section] = val;
}

function resetSummarySection(mode: 'direct' | 'map' | 'reduce', section: 'task' | 'rules' | 'structure') {
  summarySections.value[mode][section] = '';
}

function resetSummaryMode(mode: 'direct' | 'map' | 'reduce') {
  summarySections.value[mode] = { task: '', rules: '', structure: '' };
}

function resetAllSummarySections() {
  const modes: ('direct' | 'map' | 'reduce')[] = ['direct', 'map', 'reduce'];
  for (const mode of modes) {
    summarySections.value[mode] = { task: '', rules: '', structure: '' };
  }
}

function buildSummarySectionsForSave(): SummaryPromptSections {
  const result: SummaryPromptSections = {};
  const modes: ('direct' | 'map' | 'reduce')[] = ['direct', 'map', 'reduce'];
  for (const mode of modes) {
    const s = summarySections.value[mode];
    const parts: { task?: string; rules?: string; structure?: string } = {};
    if (s.task) parts.task = s.task;
    if (s.rules) parts.rules = s.rules;
    if (s.structure) parts.structure = s.structure;
    if (Object.keys(parts).length > 0) {
      result[mode] = parts;
    }
  }
  return result;
}

const isSummaryCustomized = computed(() => {
  const modes: ('direct' | 'map' | 'reduce')[] = ['direct', 'map', 'reduce'];
  return modes.some(mode => {
    const s = summarySections.value[mode];
    return s.task || s.rules || s.structure;
  });
});

// Knowledge sub-mode tabs
const activeKnowledgeMode = ref<'extract' | 'chunk' | 'reduce'>('extract');
const knowledgeSections = ref<{
  extract: { task: string; rules: string; structure: string };
  chunk: { task: string; rules: string; structure: string };
  reduce: { task: string; rules: string; structure: string };
}>({
  extract: { task: '', rules: '', structure: '' },
  chunk: { task: '', rules: '', structure: '' },
  reduce: { task: '', rules: '', structure: '' },
});
const showKnowledgeDefault = ref<Record<string, boolean>>({ task: false, rules: false, structure: false });
const knowledgeSectionDefaults: Record<string, string> = {
  task: '', // set dynamically per mode
  rules: KNOWLEDGE_DEFAULT_RULES,
  structure: KNOWLEDGE_DEFAULT_STRUCTURE,
};

function getKnowledgeDefault(mode: 'extract' | 'chunk' | 'reduce', section: 'task' | 'rules' | 'structure'): string {
  if (section === 'task') return KNOWLEDGE_DEFAULT_TASKS[mode];
  if (section === 'rules') return KNOWLEDGE_DEFAULT_RULES;
  return KNOWLEDGE_DEFAULT_STRUCTURE;
}

function loadKnowledgeSections() {
  const kp = customPrompts.value.knowledge;
  const modes: ('extract' | 'chunk' | 'reduce')[] = ['extract', 'chunk', 'reduce'];
  for (const mode of modes) {
    const saved = typeof kp === 'object' && kp ? kp[mode] : undefined;
    knowledgeSections.value[mode] = {
      task: saved?.task ?? '',
      rules: saved?.rules ?? '',
      structure: saved?.structure ?? '',
    };
  }
}

function getSectionValue(mode: 'extract' | 'chunk' | 'reduce', section: 'task' | 'rules' | 'structure'): string {
  const val = knowledgeSections.value[mode][section];
  return val || getKnowledgeDefault(mode, section);
}

function setSectionValue(mode: 'extract' | 'chunk' | 'reduce', section: 'task' | 'rules' | 'structure', val: string) {
  knowledgeSections.value[mode][section] = val;
}

function resetKnowledgeSection(mode: 'extract' | 'chunk' | 'reduce', section: 'task' | 'rules' | 'structure') {
  knowledgeSections.value[mode][section] = '';
}

function resetKnowledgeMode(mode: 'extract' | 'chunk' | 'reduce') {
  knowledgeSections.value[mode] = { task: '', rules: '', structure: '' };
}

function resetAllKnowledgeSections() {
  const modes: ('extract' | 'chunk' | 'reduce')[] = ['extract', 'chunk', 'reduce'];
  for (const mode of modes) {
    knowledgeSections.value[mode] = { task: '', rules: '', structure: '' };
  }
}

function buildKnowledgeSectionsForSave(): KnowledgePromptSections {
  const result: KnowledgePromptSections = {};
  const modes: ('extract' | 'chunk' | 'reduce')[] = ['extract', 'chunk', 'reduce'];
  for (const mode of modes) {
    const s = knowledgeSections.value[mode];
    const parts: { task?: string; rules?: string; structure?: string } = {};
    if (s.task) parts.task = s.task;
    if (s.rules) parts.rules = s.rules;
    if (s.structure) parts.structure = s.structure;
    if (Object.keys(parts).length > 0) {
      result[mode] = parts;
    }
  }
  return result;
}

const isKnowledgeCustomized = computed(() => {
  const modes: ('extract' | 'chunk' | 'reduce')[] = ['extract', 'chunk', 'reduce'];
  return modes.some(mode => {
    const s = knowledgeSections.value[mode];
    return s.task || s.rules || s.structure;
  });
});

const defaultPrompts = {
  summary: buildSummaryPrompt('direct', {}, 500),
  knowledge: buildKnowledgePrompt('extract', {}, 20),
  threadAnalysis: THREAD_ANALYSIS_PROMPT,
  research: RESEARCH_PROMPT,
};

const promptTabLabels = {
  summary: 'Tóm tắt',
  knowledge: 'Kiến thức',
  threadAnalysis: 'Phân tích',
  research: 'Tra cứu',
};

const promptTabs: { value: 'summary' | 'knowledge' | 'research' | 'threadAnalysis'; label: string }[] = Object.entries(promptTabLabels).map(([value, label]) => ({ value: value as 'summary' | 'knowledge' | 'research' | 'threadAnalysis', label }));

const promptTabDots = computed(() => {
  const s = new Set<'summary' | 'knowledge' | 'research' | 'threadAnalysis'>();
  if (isSummaryCustomized.value) s.add('summary');
  if (isKnowledgeCustomized.value) s.add('knowledge');
  if (customPrompts.value.research) s.add('research');
  if (customPrompts.value.threadAnalysis) s.add('threadAnalysis');
  return s;
});

const activePromptValue = computed({
  get: () => {
    const val = customPrompts.value[activePromptTab.value];
    return typeof val === 'string' ? val : '';
  },
  set: (val: string) => {
    customPrompts.value = { ...customPrompts.value, [activePromptTab.value]: val || undefined };
  },
});

const claudeModels = [
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
];

const DEFAULT_GEMINI_MODELS = [
  'gemma-4-26b-a4b-it',
  'gemma-4-31b-it',
  'gemma-3-1b-it',
  'gemma-3-4b-it',
  'gemma-3-12b-it',
  'gemma-3-27b-it',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-pro-preview',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

const geminiModels = ref<string[]>([...DEFAULT_GEMINI_MODELS]);
const fetchingGeminiModels = ref(false);

const showModelDropdown = ref(false);

function selectModel(model: string) {
  config.value.model = model;
  showModelDropdown.value = false;
}

const GEMMA_PREFIXES = ['gemma-4', 'gemma-3'];

async function fetchGeminiModels() {
  const key = (config.value.apiKey || '').trim();
  if (!key) return;
  fetchingGeminiModels.value = true;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models: string[] = (data.models || [])
      .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: any) => m.name?.replace(/^models\//, '') || '')
      .filter(Boolean);
    if (models.length === 0) throw new Error('No models returned');
    const gemma = models.filter((m) => GEMMA_PREFIXES.some((p) => m.startsWith(p)));
    const rest = models.filter((m) => !GEMMA_PREFIXES.some((p) => m.startsWith(p)));
    geminiModels.value = [...gemma, ...rest];
  } catch {
    geminiModels.value = [...DEFAULT_GEMINI_MODELS];
  } finally {
    fetchingGeminiModels.value = false;
  }
}

watch(
  () => config.value.provider,
  (newProvider) => {
    if (newProvider === 'gemini' && (config.value.apiKey || '').length >= 20) {
      fetchGeminiModels();
    }
  },
);

function closeModelDropdown() {
  setTimeout(() => { showModelDropdown.value = false; }, 150);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const cacheSizeText = computed(() => formatBytes(cacheSizeBytes.value));
const cacheQuotaText = computed(() => storageQuotaBytes.value > 0 ? formatBytes(storageQuotaBytes.value) : '?');
const cacheUsagePercent = computed(() => storageQuotaBytes.value > 0 ? Math.round((cacheSizeBytes.value / storageQuotaBytes.value) * 100) : 0);
const cacheNearFull = computed(() => cacheUsagePercent.value >= 90);
const isClaude = computed(() => config.value.provider === 'claude');
const isGemini = computed(() => config.value.provider === 'gemini');
const isOpenRouter = computed(() => config.value.provider === 'openrouter');
const modelHasThinkingSupport = computed(() => modelSupportsThinking(config.value.model));
const modelMaxThinkingBudget = computed(() => getModelThinkingBudget(config.value.model));
const thinkingBudgetSliderMax = computed(() => {
  const base = modelHasThinkingSupport.value ? modelMaxThinkingBudget.value : 32768;
  return Math.max(base, config.value.thinkingBudget ?? 0, 2048);
});
const thinkingUnsupportedNote = computed(() => modelHasThinkingSupport.value
  ? ''
  : 'Model hiện tại không hỗ trợ thinking. Cấu hình bên dưới vẫn được lưu nhưng sẽ không có tác dụng cho tới khi bạn đổi sang model hỗ trợ thinking.');
const thinkingBudgetLabel = computed(() => {
  if (config.value.thinkingBudget == null) {
    return `Tự động (tối đa ${modelMaxThinkingBudget.value.toLocaleString()})`;
  }
  const budget = config.value.thinkingBudget;
  return budget === 0 ? 'Tắt (ảnh hưởng chất lượng)' : budget === modelMaxThinkingBudget.value ? budget.toLocaleString() : `${budget.toLocaleString()} / ${modelMaxThinkingBudget.value.toLocaleString()}`;
});

// Proxy to handle slider value: undefined → modelMax (auto), explicit value → as-is
const thinkingBudgetSlider = computed({
  get: () => config.value.thinkingBudget ?? thinkingBudgetSliderMax.value,
  set: (val: number) => { requestThinkingBudgetChange(val); },
});
const lowMaxTokensWarning = computed(() => {
  if (!modelHasThinkingSupport.value || !config.value.thinkingEnabled) return '';
  const maxT = config.value.maxTokens ?? 4096;
  const thinkingBudget = config.value.thinkingBudget ?? modelMaxThinkingBudget.value;
  const minForResponse = 2000;
  if (maxT < thinkingBudget + minForResponse) {
    return `Max output (${maxT.toLocaleString()}) quá thấp so với thinking budget (${thinkingBudget.toLocaleString()}). Model dễ gặp lỗi MAX_TOKEN. Khuyến nghị ≥ ${(thinkingBudget + minForResponse).toLocaleString()}.`;
  }
  return '';
});

function handleThinkingToggle(enabled: boolean) {
  if (!enabled) {
    config.value.thinkingEnabled = false;
    config.value.thinkingBudget = undefined;
    return;
  }

  config.value.thinkingEnabled = true;
  if (config.value.thinkingBudget === undefined) {
    config.value.thinkingBudget = Math.floor(thinkingBudgetSliderMax.value / 2);
  }
}

function requestThinkingBudgetChange(nextBudget: number | undefined) {
  config.value.thinkingEnabled = true;
  config.value.thinkingBudget = nextBudget;
}

async function refreshCacheSize() {
  const sizeResult = await sendMessage<{ bytes: number }>('GET_CACHE_SIZE').catch(() => null);
  if (sizeResult) cacheSizeBytes.value = sizeResult.bytes;
  try {
    const estimate = await navigator.storage.estimate();
    if (estimate.quota) storageQuotaBytes.value = estimate.quota;
  } catch { /* navigator.storage.estimate() not supported */ }
}

onMounted(async () => {
  await loadSeederSetting();
  await loadForums();
  const loaded = await sendMessage<LLMConfig>('GET_SETTINGS');
  if (loaded?.apiKey !== undefined) {
    config.value = {
      ...loaded,
      timeoutMs: loaded.timeoutMs ?? 120000,
      maxTokens: loaded.maxTokens ?? 4096,
      contextWindow: loaded.contextWindow,
      thinkingEnabled: loaded.thinkingEnabled,
      thinkingBudget: loaded.thinkingBudget,
      scrapeDelayMs: loaded.scrapeDelayMs ?? DEFAULT_SCRAPE_DELAY_MS,
      segmentSize: loaded.segmentSize ?? DEFAULT_SEGMENT_SIZE,
      dynamicSegments: loaded.dynamicSegments ?? DEFAULT_DYNAMIC_SEGMENTS,
    };
  }
  await checkReauthNeeded();
  await refreshCacheSize();
  const loadedPrompts = await sendMessage<CustomPrompts>('GET_CUSTOM_PROMPTS').catch(() => ({}));
  if (loadedPrompts) {
    customPrompts.value = loadedPrompts;
    loadSummarySections();
    loadKnowledgeSections();
  }
});

onActivated(async () => {
  await refreshCacheSize();
});

watch(() => config.value.provider, (newProvider, oldProvider) => {
  // Save old provider's specific settings
  if (!config.value.perProvider) config.value.perProvider = {};
  config.value.perProvider[oldProvider] = {
    model: config.value.model,
    apiKey: config.value.apiKey,
    baseUrl: config.value.baseUrl,
    temperature: config.value.temperature,
    timeoutMs: config.value.timeoutMs ?? 120000,
    maxTokens: config.value.maxTokens ?? 4096,
    knowledgeMaxTokens: config.value.knowledgeMaxTokens,
    contextWindow: config.value.contextWindow,
    thinkingEnabled: config.value.thinkingEnabled,
    thinkingBudget: config.value.thinkingBudget,
  };
  // Load new provider's settings (from saved or defaults)
  const saved = config.value.perProvider[newProvider];
  const defaults = providerDefaults[newProvider];
  config.value.model = saved?.model ?? defaults.model;
  config.value.apiKey = saved?.apiKey ?? defaults.apiKey;
  config.value.baseUrl = saved?.baseUrl ?? defaults.baseUrl;
  config.value.temperature = saved?.temperature ?? defaults.temperature;
  config.value.timeoutMs = saved?.timeoutMs ?? defaults.timeoutMs;
  config.value.maxTokens = saved?.maxTokens ?? defaults.maxTokens;
  config.value.knowledgeMaxTokens = saved?.knowledgeMaxTokens;
  config.value.contextWindow = saved?.contextWindow ?? defaults.contextWindow;
  config.value.thinkingEnabled = saved?.thinkingEnabled ?? defaults.thinkingEnabled;
  config.value.thinkingBudget = saved?.thinkingBudget ?? defaults.thinkingBudget;
  showApiKey.value = false;
  showModelDropdown.value = false;
});

watch(() => config.value.model, (newModel) => {
  if (modelSupportsThinking(newModel) && config.value.thinkingEnabled === undefined) {
    config.value.thinkingEnabled = true;
  }
  if (modelSupportsThinking(newModel) && config.value.thinkingBudget != null) {
    config.value.thinkingBudget = Math.min(config.value.thinkingBudget, modelMaxThinkingBudget.value);
  }
});

watch(activePromptTab, () => {
  showDefaultPrompt.value = false;
  showKnowledgeDefault.value = { task: false, rules: false, structure: false };
  showSummaryDefault.value = { task: false, rules: false, structure: false };
  if (activePromptTab.value === 'knowledge') {
    activeKnowledgeMode.value = 'extract';
  } else if (activePromptTab.value === 'summary') {
    activeSummaryMode.value = 'direct';
  }
});

// Request host permission for a custom endpoint at save-time (must be from a user gesture).
async function requestProviderPermission(provider: LLMProvider, baseUrl: string): Promise<boolean> {
  const origin = getProviderOrigin(provider, baseUrl);
  if (!origin) return false;

  const already = await hasOriginPermission(origin);
  if (already) return true;

  return requestOriginPermission(origin);
}

async function save() {
  saving.value = true;
  saveMessage.value = '';
  try {
    syncCurrentProvider();
    if (config.value.baseUrl) {
      const granted = await requestProviderPermission(config.value.provider, config.value.baseUrl);
      if (!granted) {
        saveMessage.value = 'Chưa cấp quyền truy cập provider.';
        return;
      }
    }
    await sendMessage('SAVE_SETTINGS', config.value);
    saveMessage.value = 'Đã lưu!';
    setTimeout(() => (saveMessage.value = ''), 2000);
  } catch {
    saveMessage.value = 'Lỗi khi lưu.';
  } finally {
    saving.value = false;
  }
}

async function testConnection() {
  testing.value = true;
  testResult.value = '';
  testErrorDetail.value = '';
  try {
    syncCurrentProvider();
    if (config.value.baseUrl) {
      const granted = await requestProviderPermission(config.value.provider, config.value.baseUrl);
      if (!granted) {
        testResult.value = 'fail';
        testErrorDetail.value = 'Permission denied for provider host.';
        return;
      }
    }
    await sendMessage('SAVE_SETTINGS', config.value);
    const result = await sendMessage<{ ok: boolean; error?: string }>('TEST_CONNECTION');
    testResult.value = result.ok ? 'success' : 'fail';
    if (!result.ok && result.error) {
      testErrorDetail.value = result.error;
    }
  } catch (err) {
    testResult.value = 'fail';
    testErrorDetail.value = String(err);
  } finally {
    testing.value = false;
  }
}

async function savePrompts() {
  promptError.value = '';
  try {
    const toSave: CustomPrompts = { ...customPrompts.value };

    if (activePromptTab.value === 'summary') {
      const sections = buildSummarySectionsForSave();
      if (Object.keys(sections).length > 0) {
        toSave.summary = sections;
      } else {
        toSave.summary = undefined;
      }
    } else if (activePromptTab.value === 'knowledge') {
      const sections = buildKnowledgeSectionsForSave();
      if (Object.keys(sections).length > 0) {
        toSave.knowledge = sections;
      } else {
        toSave.knowledge = undefined;
      }
    }

    await sendMessage('SAVE_CUSTOM_PROMPTS', toSave);
    promptSaveMessage.value = 'Đã lưu prompt!';
    setTimeout(() => (promptSaveMessage.value = ''), 2000);
  } catch {
    promptError.value = 'Lỗi khi lưu prompt.';
  }
}

function resetPrompt() {
  if (activePromptTab.value === 'summary') {
    resetSummaryMode(activeSummaryMode.value);
  } else if (activePromptTab.value === 'knowledge') {
    resetKnowledgeMode(activeKnowledgeMode.value);
  } else {
    customPrompts.value = { ...customPrompts.value, [activePromptTab.value]: undefined };
  }
  savePrompts();
}

function resetSummarySectionAndSave(mode: 'direct' | 'map' | 'reduce', section: 'task' | 'rules' | 'structure') {
  resetSummarySection(mode, section);
  savePrompts();
}

function resetKnowledgeSectionAndSave(mode: 'extract' | 'chunk' | 'reduce', section: 'task' | 'rules' | 'structure') {
  resetKnowledgeSection(mode, section);
  savePrompts();
}

function confirmClearAll() {
  showClearConfirm.value = true;
}

async function executeClearAll() {
  try {
    const topics = await sendMessage<CachedTopic[]>('GET_ALL_CACHED_TOPICS');
    await Promise.allSettled((topics || []).map((topic) => sendMessage('DELETE_CACHED_TOPIC', topic.url)));
    cacheSizeBytes.value = 0;
  } catch {
    // Silently fail
  } finally {
    showClearConfirm.value = false;
  }
}

function cancelClearAll() {
  showClearConfirm.value = false;
}

async function exportCache() {
  exporting.value = true;
  try {
    const topics = await sendMessage<CachedTopic[]>('GET_ALL_CACHED_TOPICS');
    const payload = buildCacheExport(topics || []);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `loi-thot-ho-export-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    exporting.value = false;
  }
}

function triggerImportPicker() {
  importError.value = '';
  fileInput.value?.click();
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Không thể đọc file'));
    reader.readAsText(file);
  });
}

async function onImportFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  importing.value = true;
  importError.value = '';
  importResult.value = null;

  try {
    const text = await readFileAsText(file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('File không đúng định dạng JSON');
    }

    const exportData = validateCacheExport(parsed);
    const result = await sendMessage<ImportResult>('IMPORT_CACHE', {
      topics: exportData.topics,
      notebookEntries: exportData.notebookEntries,
      conflictMode: conflictMode.value,
    });

    if (exportData.version !== '1.0') {
      result.errors = [
        `Cảnh báo: file version ${exportData.version} khác 1.0, đã import theo chế độ tương thích.`,
        ...result.errors,
      ];
    }

    importResult.value = result;
    await refreshCacheSize();
  } catch (err) {
    importError.value = String(err);
  } finally {
    importing.value = false;
    if (input) input.value = '';
  }
}
</script>

<template>
  <div class="p-3 space-y-2">
    <!-- Permission re-auth banner -->
    <div v-if="needsReauth" class="alert alert-warning flex items-center justify-between gap-3">
      <span class="text-xs">Extension đã được cập nhật. Cần cấp lại quyền truy cập LLM provider để tiếp tục sử dụng.</span>
      <button class="btn btn-sm btn-primary shrink-0" :disabled="reauthGranting" @click="handleReauthGrant">
        {{ reauthGranting ? 'Đang cấp...' : 'Cấp quyền' }}
      </button>
    </div>
    <p v-if="reauthMessage" class="text-xs" :class="reauthMessage === 'Đã cấp quyền thành công!' ? 'text-(--color-success-text)' : 'text-(--color-error-text)'">
      {{ reauthMessage }}
    </p>

    <!-- Theme -->
    <div class="card space-y-2">
      <h3 class="section-heading">Giao diện</h3>
      <PillTabs :tabs="themeOptions" :modelValue="currentTheme" @update:modelValue="setTheme" />
    </div>

    <!-- Seeder Detection -->
    <div class="card space-y-2">
      <h3 class="section-heading">Hiển thị chỉ số độ tin cậy tài khoản</h3>
      <div class="flex items-start gap-3">
        <label class="mt-1.5 relative inline-flex items-center cursor-pointer">
          <input :checked="showTrustBadges" @change="setShowTrustBadges(($event.target as HTMLInputElement).checked)" type="checkbox" class="sr-only peer" />
          <div
            class="w-9 h-5 bg-(--color-bg-muted) peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-(--color-accent)" />
        </label>
        <div>
          <p class="text-xs font-medium text-(--color-text-secondary)">Hiển thị chỉ số độ tin cậy tài khoản (Thử nghiệm)</p>
          <p class="text-xs text-(--color-text-muted)">Badge cảnh báo tài khoản mới hoặc ít hoạt động.</p>
        </div>
      </div>
    </div>

    <!-- LLM Configuration -->
    <div class="card space-y-3">
      <h2 class="section-heading">Cấu hình LLM</h2>

      <!-- Provider -->
      <div>
        <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">Provider</label>
        <select v-model="config.provider" class="input">
          <option value="custom">Custom (OpenAI-compatible)</option>
          <option value="openrouter">OpenRouter (multi-model)</option>
          <option value="gemini">Google Gemini (Google AI Studio)</option>
          <option value="openai">OpenAI</option>
          <option value="claude">Anthropic Claude</option>
        </select>
      </div>

      <!-- API Key -->
      <div>
        <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">
          {{ isClaude ? 'Anthropic API Key' : isGemini ? 'Google AI API Key' : 'API Key' }}
        </label>
        <div class="relative">
          <input v-model="config.apiKey" :type="showApiKey ? 'text' : 'password'" :placeholder="isClaude ? 'sk-ant-...' : isGemini ? 'AIza...' : 'sk-...'"
            class="input" style="padding-right: 2.25rem;" />
          <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-(--color-text-muted) hover:text-(--color-text-primary) transition-colors"
            :title="showApiKey ? 'Ẩn API Key' : 'Hiện API Key'" @click="showApiKey = !showApiKey">
            <svg v-if="!showApiKey" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <path
                d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Base URL (only for OpenAI/Custom) -->
      <div v-if="!isClaude && !isGemini">
        <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">Base URL</label>
        <input v-model="config.baseUrl" type="text" placeholder="https://api.openai.com/v1" class="input" />
        <p v-if="isOpenRouter" class="text-xs text-(--color-text-muted) mt-1">OpenRouter tự động route đến model bạn chọn. Không cần sửa Base URL.</p>
      </div>

      <!-- Model selector for Claude -->
      <div v-if="isClaude">
        <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">Model</label>
        <div class="relative">
          <input v-model="config.model" type="text" placeholder="claude-sonnet-4-6" class="input pr-7" @focus="showModelDropdown = true"
            @blur="closeModelDropdown" />
          <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-(--color-text-muted) hover:text-(--color-text-primary) text-xs"
            tabindex="-1" @click="showModelDropdown = !showModelDropdown">
            <svg class="w-4 h-4 text-(--color-text-secondary) transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </button>
          <ul v-if="showModelDropdown"
            class="absolute z-50 w-full mt-1 bg-(--color-bg-surface) border border-(--color-border) rounded-lg shadow-elevated overflow-hidden">
            <li v-for="model in claudeModels" :key="model" class="px-3 py-1.5 text-xs cursor-pointer hover:bg-(--color-bg-muted) text-(--color-text-primary)"
              :class="config.model === model ? 'font-medium text-(--color-accent)' : ''" @mousedown.prevent="selectModel(model)">{{ model }}</li>
          </ul>
        </div>
      </div>

      <!-- Model selector for Gemini -->
      <div v-if="isGemini">
        <label class="flex items-center justify-between text-xs font-medium text-(--color-text-secondary) mb-1">
          <span>Model</span>
          <button type="button" class="text-(--color-accent) hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!config.apiKey || fetchingGeminiModels" @click="fetchGeminiModels()">
            <span v-if="fetchingGeminiModels" class="inline-flex items-center gap-1">
              <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              Đang quét...
            </span>
            <span v-else>Quét model từ API</span>
          </button>
        </label>
        <p class="text-xs text-(--color-text-muted) mb-1">Nhập API key rồi bấm "Quét model từ API" để lấy danh sách model thực tế.</p>
        <div class="relative">
          <input v-model="config.model" type="text" placeholder="gemini-2.5-flash" class="input pr-7" @focus="showModelDropdown = true"
            @blur="closeModelDropdown" />
          <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-(--color-text-muted) hover:text-(--color-text-primary) text-xs"
            tabindex="-1" @click="showModelDropdown = !showModelDropdown">
            <svg class="w-4 h-4 text-(--color-text-secondary) transition-transform duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </button>
          <ul v-if="showModelDropdown"
            class="absolute z-50 w-full mt-1 bg-(--color-bg-surface) border border-(--color-border) rounded-lg shadow-elevated overflow-hidden">
            <li v-for="model in geminiModels" :key="model" class="px-3 py-1.5 text-xs cursor-pointer hover:bg-(--color-bg-muted) text-(--color-text-primary)"
              :class="config.model === model ? 'font-medium text-(--color-accent)' : ''" @mousedown.prevent="selectModel(model)">{{ model }}</li>
          </ul>
        </div>
      </div>

      <!-- Model input for OpenAI/Custom/OpenRouter -->
      <div v-if="!isClaude && !isGemini">
        <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">Model</label>
        <input v-model="config.model" type="text" placeholder="gpt-4o-mini" class="input" />
        <p v-if="isOpenRouter" class="text-xs text-(--color-text-muted) mt-1">Dùng format <code class="font-mono">provider/model</code>, VD: <code
            class="font-mono">meta-llama/llama-3.1-8b-instruct:free</code>, <code class="font-mono">openai/gpt-4o-mini</code>, <code
            class="font-mono">google/gemini-2.0-flash-001:free</code>. Xem đầy đủ tại <code class="font-mono">openrouter.ai/models</code></p>
      </div>

      <!-- Temperature -->
      <div>
        <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">
          Temperature: {{ config.temperature.toFixed(1) }}
        </label>
        <p class="text-xs text-(--color-text-muted) mb-1">Độ ngẫu nhiên trong câu trả lời. 0 = deterministic (nhất quán), 1 = sáng tạo hơn nhưng dễ hallucinate.
        </p>
        <input v-model.number="config.temperature" type="range" min="0" max="1" step="0.1" class="input-range" />
        <div class="flex justify-between text-xs text-(--color-text-muted) mt-0.5">
          <span>0</span>
          <span>1</span>
        </div>
      </div>

      <!-- Timeout -->
      <div>
        <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">
          Timeout: {{ Math.round((config.timeoutMs ?? 120000) / 1000) }}s
        </label>
        <p class="text-xs text-(--color-text-muted) mb-1">Thời gian tối đa chờ phản hồi từ API. Tăng nếu gặp lỗi timeout với topic dài hoặc model chậm.</p>
        <input v-model.number="config.timeoutMs" type="range" :min="30000" :max="3600000" :step="30000" class="input-range" />
        <div class="flex justify-between text-xs text-(--color-text-muted) mt-0.5">
          <span>30s</span>
          <span>3600s</span>
        </div>
      </div>

      <!-- Max output tokens (Tóm tắt) -->
      <div>
        <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">
          Max output tokens (Tóm tắt): {{ (config.maxTokens ?? 16384).toLocaleString() }}
        </label>
        <p class="text-xs text-(--color-text-muted) mb-1">
          Giới hạn số token LLM có thể trả về trong một lần gọi tóm tắt. Tăng nếu tóm tắt bị cắt ngắn.
        </p>
        <div class="flex gap-2">
          <input v-model.number="config.maxTokens" type="number" min="1024" step="1024" placeholder="16384" class="input flex-1" />
          <button v-if="config.maxTokens" class="btn btn-sm btn-ghost" @click="config.maxTokens = undefined" title="Reset về mặc định">
            Reset
          </button>
        </div>
      </div>

      <!-- Max output tokens (Kiến thức) -->
      <div>
        <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">
          Max output tokens (Kiến thức): {{ (config.knowledgeMaxTokens ?? ((config.maxTokens ?? 16384) * 2)).toLocaleString() }}
        </label>
        <p class="text-xs text-(--color-text-muted) mb-1">
          Giới hạn số token LLM có thể trả về riêng cho flow trích xuất kiến thức, nên để ít nhất gấp đôi Max output tokens (Tóm tắt). Để trống = Max output
          tokens (Tóm tắt) x 2.
        </p>
        <div class="flex gap-2">
          <input v-model.number="config.knowledgeMaxTokens" type="number" min="1024" step="1024" placeholder="Dùng giá trị Max output tokens (Tóm tắt) x 2"
            class="input flex-1" />
          <button v-if="config.knowledgeMaxTokens" class="btn btn-sm btn-ghost" @click="config.knowledgeMaxTokens = undefined"
            title="Reset về giá trị Max output tokens (Tóm tắt) x 2">
            Reset
          </button>
        </div>
      </div>

      <!-- Low maxTokens warning for thinking models -->
      <div v-if="lowMaxTokensWarning" class="alert alert-error text-xs">
        {{ lowMaxTokensWarning }}
      </div>

      <!-- Thinking config (all providers/models) -->
      <div class="space-y-2">
        <!-- Thinking toggle -->
        <div class="flex items-start gap-3">
          <label class="mt-1.5 relative inline-flex items-center cursor-pointer">
            <input :checked="config.thinkingEnabled !== false" @change="handleThinkingToggle(($event.target as HTMLInputElement).checked)" type="checkbox"
              class="sr-only peer" />
            <div
              class="w-9 h-5 bg-(--color-bg-muted) peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-(--color-accent)" />
          </label>
          <div>
            <p class="text-xs font-medium text-(--color-text-secondary)">Thinking mode</p>
            <p class="text-xs text-(--color-text-muted)">Model suy luận nội bộ trước khi trả lời (tốn token output).</p>
          </div>
        </div>

        <div v-if="config.thinkingEnabled !== false && thinkingUnsupportedNote" class="alert alert-warning text-xs">
          {{ thinkingUnsupportedNote }}
        </div>

        <!-- Thinking budget (only when thinking enabled) -->
        <div>
          <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">
            Thinking budget: {{ thinkingBudgetLabel }}
          </label>
          <p class="text-xs text-(--color-text-muted) mb-1">
            Giới hạn token dành cho suy luận nội bộ (nằm trong Max output tokens). Kéo về 0 = tắt thinking. Nhấn "Tự động" = model tự quyết định.
          </p>
          <input v-model.number="thinkingBudgetSlider" type="range" :min="0" :max="thinkingBudgetSliderMax" :step="2048" class="input-range" />
          <div class="flex justify-between text-xs text-(--color-text-muted) mt-0.5">
            <span>0 (tắt)</span>
            <span>{{ thinkingBudgetSliderMax.toLocaleString() }} (max)</span>
          </div>
          <div class="flex gap-1 mt-1">
            <button class="btn btn-sm btn-secondary text-xs" @click="requestThinkingBudgetChange(undefined)" title="Để model tự quyết định">
              Tự động
            </button>
            <button class="btn btn-sm btn-secondary text-xs" @click="requestThinkingBudgetChange(thinkingBudgetSliderMax)" title="Dùng tối đa thinking budget">
              Max
            </button>
            <button class="btn btn-sm btn-secondary text-xs" @click="requestThinkingBudgetChange(Math.floor(thinkingBudgetSliderMax / 2))"
              title="Dùng 50% thinking budget">
              50%
            </button>
          </div>
        </div>
      </div>

      <!-- Context window override (especially useful for custom/local LLMs) -->
      <div>
        <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">
          Context window (tokens): {{ config.contextWindow ? config.contextWindow.toLocaleString() : 'Tự động' }}
        </label>
        <p class="text-xs text-(--color-text-muted) mb-1">
          Giới hạn context window của model. Để trống hoặc 0 = dùng giá trị mặc định (theo model đã biết, hoặc 128K).
          Quan trọng với LLM local/custom có context nhỏ hơn.
        </p>
        <div class="flex gap-2">
          <input v-model.number="config.contextWindow" type="number" min="0" step="1000" placeholder="0 = tự động" class="input flex-1" />
          <button v-if="config.contextWindow" class="btn btn-sm btn-ghost" @click="config.contextWindow = undefined" title="Reset về tự động">
            Reset
          </button>
        </div>
      </div>
    </div>

    <!-- Scraping settings -->
    <div class="card space-y-3">
      <h2 class="section-heading">Cấu hình Scraping</h2>

      <!-- Scrape delay -->
      <div class="space-y-1">
        <label class="block text-xs font-medium text-(--color-text-secondary)">
          Delay giữa các lần tải trang: {{ config.scrapeDelayMs ?? DEFAULT_SCRAPE_DELAY_MS }}ms
        </label>
        <p class="text-xs text-(--color-text-muted)">
          Khoảng cách giữa mỗi request khi đọc topic nhiều trang. Tăng lên nếu bị chặn bởi forum.
        </p>
        <input v-model.number="config.scrapeDelayMs" type="range" min="500" max="10000" step="500" class="input-range" />
        <div class="flex justify-between text-xs text-(--color-text-muted)">
          <span>500ms</span>
          <span>10000ms</span>
        </div>
      </div>

      <!-- Dynamic segments toggle -->
      <div class="flex items-start gap-3">
        <label class="mt-1.5 relative inline-flex items-center cursor-pointer">
          <input v-model="config.dynamicSegments" type="checkbox" class="sr-only peer" />
          <div
            class="w-9 h-5 bg-(--color-bg-muted) peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-(--color-accent)" />
        </label>
        <div>
          <p class="text-xs font-medium text-(--color-text-secondary)">Tự động chia segment theo độ dài nội dung</p>
          <p class="text-xs text-(--color-text-muted)">Tính số trang mỗi phần dựa trên LLM Context window, tránh vượt quá giới hạn context.</p>
        </div>
      </div>

      <!-- Segment size (chỉ hiển khi dynamic segments tắt) -->
      <div v-if="!config.dynamicSegments" class="space-y-1">
        <label class="block text-xs font-medium text-(--color-text-secondary)">
          Số trang mỗi phần (Segment): {{ config.segmentSize ?? DEFAULT_SEGMENT_SIZE }}
        </label>
        <p class="text-xs text-(--color-text-muted)">
          Topic dài hơn giá trị này sẽ được chia thành nhiều phần để tóm tắt riêng.
        </p>
        <input v-model.number="config.segmentSize" type="range" min="10" max="200" step="10" class="input-range" />
        <div class="flex justify-between text-xs text-(--color-text-muted)">
          <span>10</span>
          <span>200</span>
        </div>
      </div>

      <!-- Config change warning -->
      <div class="alert alert-warning text-xs">
        ⚠️ Thay đổi cấu hình model/segment có thể khiến các thread đang tóm tắt dở phải tóm tắt và chia segment lại từ đầu.
      </div>
    </div>

    <!-- Actions -->
    <div class="card space-y-3">
      <div class="flex gap-2">
        <button class="flex-1 btn btn-sm btn-primary" :disabled="saving" @click="save">
          {{ saving ? 'Đang lưu...' : 'Lưu' }}
        </button>
        <button class="flex-1 btn btn-sm btn-secondary" :disabled="testing" @click="testConnection">
          {{ testing ? 'Đang test...' : 'Test Connection' }}
        </button>
      </div>

      <!-- Save message -->
      <div v-if="saveMessage" class="alert alert-success text-xs text-center">
        {{ saveMessage }}
      </div>

      <!-- Test result -->
      <LoadingSpinner v-if="testing" text="Đang kiểm tra kết nối..." />
      <div v-if="testResult === 'success'" class="alert alert-success text-xs text-center">
        Kết nối thành công!
      </div>
      <div v-if="testResult === 'fail'" class="alert alert-error text-xs">
        <p class="font-medium">Kết nối thất bại.</p>
        <p v-if="testErrorDetail" class="mt-0.5 break-all text-(--color-text-secondary)">{{ testErrorDetail }}</p>
      </div>
    </div>

    <!-- Cache storage info -->
    <div class="card space-y-3">
      <h3 class="section-heading">Dữ liệu</h3>
      <div class="space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="font-medium text-(--color-text-primary)">IndexedDB</span>
          <span :class="cacheNearFull ? 'text-(--color-warning-text) font-medium' : 'text-(--color-text-secondary)'">
            {{ cacheSizeText }} / {{ cacheQuotaText }} ({{ cacheUsagePercent }}%)
          </span>
        </div>
        <div class="w-full bg-(--color-bg-muted) rounded-full h-1.5">
          <div class="h-1.5 rounded-full transition-all" :class="cacheNearFull ? 'bg-(--color-warning-text)' : 'bg-(--color-accent)'"
            :style="{ width: `${Math.min(cacheUsagePercent, 100)}%` }" />
        </div>
        <p v-if="cacheNearFull" class="text-xs text-(--color-warning-text)">
          ⚠ Cache đang sử dụng {{ cacheUsagePercent }}% dung lượng lưu trữ. Cân nhắc xoá bớt cache cũ.
        </p>
        <button class="w-full btn btn-sm btn-danger" @click="confirmClearAll">
          Xóa tất cả cache
        </button>
        <input ref="fileInput" type="file" accept=".json,application/json" class="hidden" @change="onImportFileSelected" />
        <div class="grid grid-cols-2 gap-2">
          <button class="w-full btn btn-sm btn-secondary" :disabled="exporting || importing" @click="exportCache">
            {{ exporting ? 'Đang xuất...' : 'Xuất dữ liệu (JSON)' }}
          </button>
          <button class="w-full btn btn-sm btn-primary" :disabled="importing || exporting" @click="triggerImportPicker">
            {{ importing ? 'Đang nhập...' : 'Nhập dữ liệu (JSON)' }}
          </button>
        </div>
        <div class="space-y-1">
          <p class="block text-xs font-medium text-(--color-text-secondary)">Khi trùng dữ liệu, bạn muốn:</p>
          <div class="grid grid-cols-1 gap-1.5">
            <label class="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs transition-colors cursor-pointer" :class="conflictMode === 'skip'
              ? 'text-(--color-text-primary)'
              : 'text-(--color-text-primary) hover:bg-(--color-bg-muted)'">
              <input v-model="conflictMode" type="radio" name="import-conflict-mode" value="skip"
                class="h-4 w-4 shrink-0 appearance-none rounded-full border border-(--color-border-strong) bg-(--color-bg-surface) transition checked:border-(--color-accent) checked:bg-(--color-accent) checked:bg-[radial-gradient(circle,white_30%,transparent_32%)] focus:outline-none focus:ring-2 focus:ring-(--color-accent)/30" />
              <span class="text-xs font-medium text-(--color-text-secondary)">Giữ dữ liệu hiện có</span>
            </label>
            <label class="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs transition-colors cursor-pointer" :class="conflictMode === 'overwrite'
              ? 'text-(--color-text-primary)'
              : 'text-(--color-text-primary) hover:bg-(--color-bg-muted)'">
              <input v-model="conflictMode" type="radio" name="import-conflict-mode" value="overwrite"
                class="h-4 w-4 shrink-0 appearance-none rounded-full border border-(--color-border-strong) bg-(--color-bg-surface) transition checked:border-(--color-accent) checked:bg-(--color-accent) checked:bg-[radial-gradient(circle,white_30%,transparent_32%)] focus:outline-none focus:ring-2 focus:ring-(--color-accent)/30" />
              <span class="text-xs font-medium text-(--color-text-secondary)">Ghi đè bằng dữ liệu từ file</span>
            </label>
          </div>
        </div>
        <div v-if="importResult" class="alert text-xs" :class="importResult.failed > 0 ? 'alert-warning' : 'alert-success'">
          Đã nhập {{ importResult.imported }} topic (bỏ qua {{ importResult.skipped }}, lỗi {{ importResult.failed }}).
        </div>
        <div v-if="importError" class="alert alert-error text-xs">
          {{ importError }}
        </div>
        <ul v-if="importResult?.errors?.length" class="text-xs text-(--color-text-muted) list-disc pl-5 space-y-0.5">
          <li v-for="(err, idx) in importResult.errors.slice(0, 5)" :key="idx">{{ err }}</li>
        </ul>
      </div>
    </div>

    <CostConfirmModal v-if="showClearConfirm" title="Xóa tất cả cache" :estimate="clearCacheConfirmEstimate"
      warning="Hành động này sẽ xóa toàn bộ dữ liệu cache cục bộ và không thể hoàn tác." confirm-text="Xóa tất cả cache" @confirm="executeClearAll"
      @cancel="cancelClearAll" />

    <!-- ─── Forum Support ──────────────────────────────── -->
    <div class="card space-y-3">
      <h3 class="section-heading">Forum hỗ trợ</h3>

      <div v-if="userForums.length > 0" class="space-y-1">
        <div v-for="forum in userForums" :key="forum.id" class="flex items-center justify-between px-2 py-1.5 bg-(--color-bg-muted) rounded-md">
          <span class="text-xs text-(--color-text-primary)">{{ forum.hostname }}</span>
          <button class="text-xs text-(--color-error-text) hover:text-(--color-accent-hover) transition-colors" @click="removeForum(forum)">
            Xóa
          </button>
        </div>
      </div>

      <div v-if="!userForums.find(f => f.hostname === 'voz.vn') || !userForums.find(f => f.hostname === 'otofun.net')" class="space-y-1">
        <p class="text-xs text-(--color-text-secondary)">Thêm nhanh:</p>
        <div class="flex gap-3">
          <button v-if="!userForums.find(f => f.hostname === 'voz.vn')" class="text-xs link" @click="addForumByHostname('voz.vn')">
            + Thêm voz.vn
          </button>
          <button v-if="!userForums.find(f => f.hostname === 'otofun.net')" class="text-xs link" @click="addForumByHostname('otofun.net')">
            + Thêm otofun.net
          </button>
        </div>
      </div>

      <div class="flex gap-2">
        <input v-model="newForumUrl" type="text" placeholder="https://forum.example.com" class="input flex-1" @keydown.enter="addForum" />
        <button class="btn btn-sm btn-primary" :disabled="addingForum" @click="addForum">
          {{ addingForum ? 'Đang thêm...' : 'Thêm' }}
        </button>
      </div>
      <p v-if="addForumError" class="alert alert-error text-xs">{{ addForumError }}</p>

      <p class="text-xs text-(--color-text-muted)">
        Chỉ hoạt động với forum XenForo. Khi thêm, Chrome sẽ yêu cầu xác nhận cấp quyền cho domain đó.
      </p>
    </div>

    <!-- ─── Custom Prompt Templates ──────────────────────────────── -->
    <div class="card space-y-3">
      <div class="flex flex-col">
        <h3 class="section-heading">Prompt Templates</h3>
        <p class="text-xs text-(--color-text-secondary) mt-0.5">Để trống để dùng prompt mặc định.</p>
      </div>

      <!-- Tabs -->
      <PillTabs :tabs="promptTabs" :modelValue="activePromptTab" :dotTabs="promptTabDots" @update:modelValue="activePromptTab = $event" />

      <!-- Prompt editor -->
      <div class="space-y-1">
        <!-- Summary tab: show all 3 modes at once, task only -->
        <template v-if="activePromptTab === 'summary'">
          <div v-for="mode in (['direct', 'map', 'reduce'] as const)" :key="mode" class="rounded-lg space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-(--color-text-primary)">
                {{ { direct: 'Trực tiếp', map: 'Chunk', reduce: 'Gộp' }[mode] }}
              </span>
              <div class="flex gap-2">
                <ShowDefaultButton :expanded="showSummaryDefault[mode]" @toggle="showSummaryDefault[mode] = !showSummaryDefault[mode]" />
                <button type="button" class="text-xs text-(--color-text-muted) hover:text-(--color-text-primary) transition-colors"
                  :disabled="!summarySections[mode].task" @click="resetSummarySection(mode, 'task')">
                  Reset
                </button>
              </div>
            </div>
            <textarea v-model="summarySections[mode].task" rows="6" class="input font-mono resize-y"
              placeholder="Nhập prompt tuỳ chỉnh... (bấm 'Xem prompt mặc định' để xem prompt gốc)" />
            <div v-if="showSummaryDefault[mode]" class="border border-(--color-border) rounded-lg p-2 bg-(--color-bg-muted) max-h-36 overflow-y-auto">
              <pre class="text-xs text-(--color-text-secondary) whitespace-pre-wrap font-mono leading-relaxed">{{ getSummaryDefault(mode, 'task') }}</pre>
            </div>
          </div>

          <div class="flex gap-2 pt-1">
            <button class="flex-1 btn btn-sm btn-primary" @click="savePrompts">Lưu Prompts</button>
            <button class="btn btn-sm btn-secondary" :disabled="!summarySections.direct.task && !summarySections.map.task && !summarySections.reduce.task"
              @click="resetAllSummarySections">
              Reset mặc định
            </button>
          </div>
        </template>

        <!-- Knowledge tab: show all 3 modes at once, task only -->
        <template v-else-if="activePromptTab === 'knowledge'">
          <div v-for="mode in (['extract', 'chunk', 'reduce'] as const)" :key="mode" class="rounded-lg space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-(--color-text-primary)">
                {{ { extract: 'Trích xuất', chunk: 'Chunk', reduce: 'Gộp' }[mode] }}
              </span>
              <div class="flex gap-2">
                <ShowDefaultButton :expanded="!!showKnowledgeDefault[mode]" @toggle="showKnowledgeDefault[mode] = !showKnowledgeDefault[mode]" />
                <button type="button" class="text-xs text-(--color-text-muted) hover:text-(--color-text-primary) transition-colors"
                  :disabled="!knowledgeSections[mode].task" @click="resetKnowledgeSection(mode, 'task')">
                  Reset
                </button>
              </div>
            </div>
            <textarea v-model="knowledgeSections[mode].task" rows="6" class="input font-mono resize-y"
              placeholder="Nhập prompt tuỳ chỉnh... (bấm 'Xem prompt mặc định' để xem prompt gốc)" />
            <div v-if="showKnowledgeDefault[mode]" class="border border-(--color-border) rounded-lg p-2 bg-(--color-bg-muted) max-h-36 overflow-y-auto">
              <pre class="text-xs text-(--color-text-secondary) whitespace-pre-wrap font-mono leading-relaxed">{{ getKnowledgeDefault(mode, 'task') }}</pre>
            </div>
          </div>

          <div class="flex gap-2 pt-1">
            <button class="flex-1 btn btn-sm btn-primary" @click="savePrompts">Lưu Prompts</button>
            <button class="btn btn-sm btn-secondary"
              :disabled="!knowledgeSections.extract.task && !knowledgeSections.chunk.task && !knowledgeSections.reduce.task" @click="resetAllKnowledgeSections">
              Reset mặc định
            </button>
          </div>
        </template>

        <!-- Other tabs: single textarea (backward compat) -->
        <template v-else>
          <div class="rounded-lg space-y-1">
            <textarea v-model="activePromptValue" rows="6" class="input font-mono resize-y"
              placeholder="Nhập prompt tuỳ chỉnh... (bấm 'Xem prompt mặc định' để xem prompt gốc)" />
            <!-- Default prompt viewer -->
            <ShowDefaultButton :expanded="showDefaultPrompt" @toggle="showDefaultPrompt = !showDefaultPrompt" />
            <div v-if="showDefaultPrompt" class="border border-(--color-border) rounded-lg p-2 bg-(--color-bg-muted) max-h-48 overflow-y-auto">
              <pre class="text-xs text-(--color-text-secondary) whitespace-pre-wrap font-mono leading-relaxed">{{ defaultPrompts[activePromptTab] }}</pre>
            </div>
            <div class="flex gap-2">
              <button class="flex-1 btn btn-sm btn-primary" @click="savePrompts">
                Lưu Prompts
              </button>
              <button class="btn btn-sm btn-secondary" :disabled="!customPrompts[activePromptTab]" @click="resetPrompt">
                Reset mặc định
              </button>
            </div>
          </div>
        </template>

        <p v-if="promptSaveMessage" class="text-xs text-(--color-success-text)">{{ promptSaveMessage }}</p>
        <p v-if="promptError" class="text-xs text-(--color-error-text)">{{ promptError }}</p>
      </div>
    </div>
  </div>
</template>