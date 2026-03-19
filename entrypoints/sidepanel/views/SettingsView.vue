<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch } from 'vue';
import { sendMessage } from '@/lib/messaging';
import { DEFAULT_LLM_CONFIG } from '@/lib/constants';
import type { LLMConfig, CustomPrompts, CachedTopic } from '@/lib/types';
import { SUMMARY_PROMPT, OPINION_ANALYSIS_PROMPT, RESEARCH_PROMPT } from '@/lib/prompts';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import { useTheme } from '../composables/useTheme';

const config = ref<LLMConfig>({ ...DEFAULT_LLM_CONFIG });
const saving = ref(false);
const testing = ref(false);
const testResult = ref<'success' | 'fail' | ''>('');
const saveMessage = ref('');
const cacheSizeBytes = ref(0);
const MAX_CACHE_BYTES = 50 * 1024 * 1024; // 50MB — IndexedDB cho phép nhiều hơn
const showClearConfirm = ref(false);

const { themeMode: currentTheme, setTheme } = useTheme();
const themeOptions = [
  { value: 'light' as const, label: 'Sáng' },
  { value: 'dark' as const, label: 'Tối' },
  { value: 'system' as const, label: 'Hệ thống' },
];

// Custom prompts
const customPrompts = ref<CustomPrompts>({});
const activePromptTab = ref<'summary' | 'opinions' | 'research'>('summary');
const promptSaveMessage = ref('');
const promptError = ref('');
const showDefaultPrompt = ref(false);

const defaultPrompts = {
  summary: SUMMARY_PROMPT,
  opinions: OPINION_ANALYSIS_PROMPT,
  research: RESEARCH_PROMPT,
};

const promptTabLabels = {
  summary: 'Tóm tắt',
  opinions: 'Ý kiến',
  research: 'Tra cứu',
};

const activePromptValue = computed({
  get: () => customPrompts.value[activePromptTab.value] ?? '',
  set: (val: string) => {
    customPrompts.value = { ...customPrompts.value, [activePromptTab.value]: val || undefined };
  },
});

const claudeModels = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
];

const geminiModels = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

const cacheSizeMB = computed(() => (cacheSizeBytes.value / (1024 * 1024)).toFixed(1));
const cacheUsagePercent = computed(() => Math.round((cacheSizeBytes.value / MAX_CACHE_BYTES) * 100));
const cacheNearFull = computed(() => cacheUsagePercent.value >= 80);
const isClaude = computed(() => config.value.provider === 'claude');
const isGemini = computed(() => config.value.provider === 'gemini');

async function refreshCacheSize() {
  const sizeResult = await sendMessage<{ bytes: number }>('GET_CACHE_SIZE').catch(() => null);
  if (sizeResult) cacheSizeBytes.value = sizeResult.bytes;
}

onMounted(async () => {
  const loaded = await sendMessage<LLMConfig>('GET_SETTINGS');
  if (loaded?.apiKey !== undefined) {
    config.value = { ...loaded, timeoutMs: loaded.timeoutMs ?? 120000 };
  }
  await refreshCacheSize();
  const loadedPrompts = await sendMessage<CustomPrompts>('GET_CUSTOM_PROMPTS').catch(() => ({}));
  if (loadedPrompts) customPrompts.value = loadedPrompts;
});

onActivated(async () => {
  await refreshCacheSize();
});

watch(activePromptTab, () => {
  showDefaultPrompt.value = false;
});

async function save() {
  saving.value = true;
  saveMessage.value = '';
  try {
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
  try {
    await sendMessage('SAVE_SETTINGS', config.value);
    const result = await sendMessage<{ ok: boolean; error?: string }>('TEST_CONNECTION');
    testResult.value = result.ok ? 'success' : 'fail';
  } catch {
    testResult.value = 'fail';
  } finally {
    testing.value = false;
  }
}

async function savePrompts() {
  promptError.value = '';
  try {
    await sendMessage('SAVE_CUSTOM_PROMPTS', customPrompts.value);
    promptSaveMessage.value = 'Đã lưu prompt!';
    setTimeout(() => (promptSaveMessage.value = ''), 2000);
  } catch {
    promptError.value = 'Lỗi khi lưu prompt.';
  }
}

function resetPrompt() {
  customPrompts.value = { ...customPrompts.value, [activePromptTab.value]: undefined };
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
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- Theme -->
    <div>
      <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">Giao diện</label>
      <div class="flex gap-2">
        <button
          v-for="option in themeOptions"
          :key="option.value"
          class="flex-1 py-1.5 text-xs rounded-lg border transition-colors"
          :class="currentTheme === option.value
            ? 'bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500'
            : 'border-(--color-border-strong) text-(--color-text-secondary) hover:bg-(--color-bg-muted)'"
          @click="setTheme(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <h2 class="font-semibold text-sm text-(--color-text-primary)">Cấu hình LLM</h2>

    <!-- Provider -->
    <div>
      <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">Provider</label>
      <select
        v-model="config.provider"
        class="input"
      >
        <option value="openai">OpenAI</option>
        <option value="custom">Custom (OpenAI-compatible)</option>
        <option value="claude">Anthropic Claude</option>
        <option value="gemini">Google Gemini</option>
      </select>
    </div>

    <!-- API Key -->
    <div>
      <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">
        {{ isClaude ? 'Anthropic API Key' : isGemini ? 'Google AI API Key' : 'API Key' }}
      </label>
      <input
        v-model="config.apiKey"
        type="password"
        :placeholder="isClaude ? 'sk-ant-...' : isGemini ? 'AIza...' : 'sk-...'"
        class="input"
      />
    </div>

    <!-- Base URL (only for OpenAI/Custom) -->
    <div v-if="!isClaude && !isGemini">
      <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">Base URL</label>
      <input
        v-model="config.baseUrl"
        type="text"
        placeholder="https://api.openai.com/v1"
        class="input"
      />
    </div>

    <!-- Model selector for Claude -->
    <div v-if="isClaude">
      <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">Model</label>
      <select
        v-model="config.model"
        class="input"
      >
        <option v-for="model in claudeModels" :key="model" :value="model">
          {{ model }}
        </option>
      </select>
    </div>

    <!-- Model selector for Gemini -->
    <div v-if="isGemini">
      <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">Model</label>
      <select
        v-model="config.model"
        class="input"
      >
        <option v-for="model in geminiModels" :key="model" :value="model">
          {{ model }}
        </option>
      </select>
    </div>

    <!-- Model input for OpenAI/Custom -->
    <div v-if="!isClaude && !isGemini">
      <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">Model</label>
      <input
        v-model="config.model"
        type="text"
        placeholder="gpt-4o-mini"
        class="input"
      />
    </div>

    <!-- Temperature -->
    <div>
      <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">
        Temperature: {{ config.temperature.toFixed(1) }}
      </label>
      <input
        v-model.number="config.temperature"
        type="range"
        min="0"
        max="1"
        step="0.1"
        class="w-full"
      />
    </div>

    <!-- Timeout -->
    <div>
      <label class="block text-xs font-medium text-(--color-text-secondary) mb-1">
        Timeout: {{ Math.round((config.timeoutMs ?? 120000) / 1000) }}s
      </label>
      <input
        v-model.number="config.timeoutMs"
        type="range"
        :min="30000"
        :max="600000"
        :step="30000"
        class="w-full"
      />
      <div class="flex justify-between text-xs text-(--color-text-muted) mt-0.5">
        <span>30s</span>
        <span>600s</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex gap-2">
      <button
        class="flex-1 btn btn-primary"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? 'Đang lưu...' : 'Lưu' }}
      </button>
      <button
        class="flex-1 btn btn-secondary"
        :disabled="testing || !config.apiKey"
        @click="testConnection"
      >
        {{ testing ? 'Đang test...' : 'Test Connection' }}
      </button>
    </div>

    <!-- Save message -->
    <p v-if="saveMessage" class="text-xs text-(--color-success-text) text-center">
      {{ saveMessage }}
    </p>

    <!-- Cache storage info -->
    <div class="card space-y-2">
      <div class="flex items-center justify-between text-xs">
        <span class="font-medium text-(--color-text-primary)">Cache local</span>
        <span :class="cacheNearFull ? 'text-orange-600 dark:text-orange-400 font-medium' : 'text-(--color-text-secondary)'">
          {{ cacheSizeMB }} MB / 50 MB ({{ cacheUsagePercent }}%)
        </span>
      </div>
      <div class="w-full bg-(--color-bg-muted) rounded-full h-1.5">
        <div
          class="h-1.5 rounded-full transition-all"
          :class="cacheNearFull ? 'bg-orange-500' : 'bg-(--color-accent)'"
          :style="{ width: `${Math.min(cacheUsagePercent, 100)}%` }"
        />
      </div>
      <p v-if="cacheNearFull" class="text-xs text-orange-600 dark:text-orange-400">
        ⚠ Cache gần đầy. Các cache cũ sẽ tự động bị xoá khi lưu mới.
      </p>
      <button
        v-if="!showClearConfirm"
        class="w-full btn btn-sm btn-danger"
        @click="confirmClearAll"
      >
        Xóa tất cả cache
      </button>
      <div v-if="showClearConfirm" class="alert alert-error space-y-2">
        <p class="text-xs font-medium">Xóa tất cả cache?</p>
        <div class="flex gap-2">
          <button
            class="flex-1 btn btn-danger"
            @click="executeClearAll"
          >
            Xóa
          </button>
          <button
            class="flex-1 btn btn-sm btn-secondary"
            @click="cancelClearAll"
          >
            Hủy
          </button>
        </div>
      </div>
    </div>

    <!-- Test result -->
    <LoadingSpinner v-if="testing" text="Đang kiểm tra kết nối..." />
    <div
      v-if="testResult === 'success'"
      class="alert alert-success text-center"
    >
      Kết nối thành công!
    </div>
    <div
      v-if="testResult === 'fail'"
      class="alert alert-error text-center"
    >
      Kết nối thất bại. Kiểm tra lại API Key và Base URL.
    </div>

    <!-- ─── Custom Prompt Templates ──────────────────────────────── -->
    <div class="border border-(--color-border) rounded-lg overflow-hidden">
      <div class="bg-(--color-bg-muted) px-3 py-2 border-b border-(--color-border)">
        <h3 class="text-xs font-semibold text-(--color-text-primary)">Prompt Templates</h3>
        <p class="text-xs text-(--color-text-secondary) mt-0.5">Để trống để dùng prompt mặc định.</p>
      </div>

      <!-- Tabs -->
      <div class="flex border-b border-(--color-border)">
        <button
          v-for="tab in (['summary', 'opinions', 'research'] as const)"
          :key="tab"
          class="flex-1 py-1.5 text-xs font-medium transition-colors"
          :class="activePromptTab === tab
            ? 'text-(--color-accent) border-b-2 border-(--color-accent) bg-(--color-bg-surface)'
            : 'text-(--color-text-secondary) hover:text-(--color-text-primary)'"
          @click="activePromptTab = tab"
        >
          {{ promptTabLabels[tab] }}
          <span
            v-if="customPrompts[tab]"
            class="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-blue-500"
          />
        </button>
      </div>

      <!-- Prompt editor -->
      <div class="p-3 space-y-2">
        <textarea
          v-model="activePromptValue"
          rows="6"
          class="w-full border border-(--color-border-strong) rounded-lg px-2 py-1.5 text-xs font-mono focus:border-(--color-accent) focus:outline-none focus:ring-1 focus:ring-(--color-accent) resize-y bg-(--color-bg-surface) text-(--color-text-primary)"
          placeholder="Nhập prompt tuỳ chỉnh... (bấm 'Xem prompt mặc định' để xem prompt gốc)"
        />
        <!-- Default prompt viewer -->
        <button
          type="button"
          class="text-xs text-(--color-accent-text) hover:text-(--color-accent-hover) transition-colors"
          @click="showDefaultPrompt = !showDefaultPrompt"
        >
          {{ showDefaultPrompt ? '▾ Ẩn prompt mặc định' : '▸ Xem prompt mặc định' }}
        </button>
        <div
          v-if="showDefaultPrompt"
          class="border border-(--color-border) rounded-lg p-2 bg-(--color-bg-muted) max-h-48 overflow-y-auto"
        >
          <pre class="text-xs text-(--color-text-secondary) whitespace-pre-wrap font-mono leading-relaxed">{{ defaultPrompts[activePromptTab] }}</pre>
        </div>
        <div class="flex gap-2">
          <button
            class="flex-1 btn btn-sm btn-primary"
            @click="savePrompts"
          >
            Lưu Prompts
          </button>
          <button
            class="btn btn-sm btn-secondary"
            :disabled="!customPrompts[activePromptTab]"
            @click="resetPrompt"
          >
            Reset mặc định
          </button>
        </div>
        <p v-if="promptSaveMessage" class="text-xs text-(--color-success-text)">{{ promptSaveMessage }}</p>
        <p v-if="promptError" class="text-xs text-(--color-error-text)">{{ promptError }}</p>
      </div>
    </div>
  </div>
</template>
