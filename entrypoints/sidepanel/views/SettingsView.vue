<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { sendMessage } from '@/lib/messaging';
import { DEFAULT_LLM_CONFIG } from '@/lib/constants';
import type { LLMConfig, CustomPrompts } from '@/lib/types';
import { SUMMARY_PROMPT, OPINION_ANALYSIS_PROMPT, RESEARCH_PROMPT } from '@/lib/prompts';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const config = ref<LLMConfig>({ ...DEFAULT_LLM_CONFIG });
const saving = ref(false);
const testing = ref(false);
const testResult = ref<'success' | 'fail' | ''>('');
const saveMessage = ref('');
const cacheSizeBytes = ref(0);
const MAX_CACHE_BYTES = 8 * 1024 * 1024; // 8MB soft limit

// Custom prompts
const customPrompts = ref<CustomPrompts>({});
const activePromptTab = ref<'summary' | 'opinions' | 'research'>('summary');
const promptSaveMessage = ref('');
const promptError = ref('');

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

const cacheSizeMB = computed(() => (cacheSizeBytes.value / (1024 * 1024)).toFixed(1));
const cacheUsagePercent = computed(() => Math.round((cacheSizeBytes.value / MAX_CACHE_BYTES) * 100));
const cacheNearFull = computed(() => cacheUsagePercent.value >= 80);
const isClaude = computed(() => config.value.provider === 'claude');

onMounted(async () => {
  const loaded = await sendMessage<LLMConfig>('GET_SETTINGS');
  if (loaded?.apiKey !== undefined) {
    config.value = { ...loaded, timeoutMs: loaded.timeoutMs ?? 120000 };
  }
  const sizeResult = await sendMessage<{ bytes: number }>('GET_CACHE_SIZE').catch(() => null);
  if (sizeResult) cacheSizeBytes.value = sizeResult.bytes;
  const loadedPrompts = await sendMessage<CustomPrompts>('GET_CUSTOM_PROMPTS').catch(() => ({}));
  if (loadedPrompts) customPrompts.value = loadedPrompts;
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
</script>

<template>
  <div class="p-4 space-y-4">
    <h2 class="font-semibold text-sm text-gray-900">Cấu hình LLM</h2>

    <!-- Provider -->
    <div>
      <label class="block text-xs font-medium text-gray-600 mb-1">Provider</label>
      <select
        v-model="config.provider"
        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
      >
        <option value="openai">OpenAI</option>
        <option value="custom">Custom (OpenAI-compatible)</option>
        <option value="claude">Anthropic Claude</option>
      </select>
    </div>

    <!-- API Key -->
    <div>
      <label class="block text-xs font-medium text-gray-600 mb-1">
        {{ isClaude ? 'Anthropic API Key' : 'API Key' }}
      </label>
      <input
        v-model="config.apiKey"
        type="password"
        :placeholder="isClaude ? 'sk-ant-...' : 'sk-...'"
        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
      />
    </div>

    <!-- Base URL (only for OpenAI/Custom) -->
    <div v-if="!isClaude">
      <label class="block text-xs font-medium text-gray-600 mb-1">Base URL</label>
      <input
        v-model="config.baseUrl"
        type="text"
        placeholder="https://api.openai.com/v1"
        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
      />
    </div>

    <!-- Model selector for Claude -->
    <div v-if="isClaude">
      <label class="block text-xs font-medium text-gray-600 mb-1">Model</label>
      <select
        v-model="config.model"
        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
      >
        <option v-for="model in claudeModels" :key="model" :value="model">
          {{ model }}
        </option>
      </select>
    </div>

    <!-- Model input for OpenAI/Custom -->
    <div v-if="!isClaude">
      <label class="block text-xs font-medium text-gray-600 mb-1">Model</label>
      <input
        v-model="config.model"
        type="text"
        placeholder="gpt-4o-mini"
        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
      />
    </div>

    <!-- Temperature -->
    <div>
      <label class="block text-xs font-medium text-gray-600 mb-1">
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
      <label class="block text-xs font-medium text-gray-600 mb-1">
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
      <div class="flex justify-between text-xs text-gray-400 mt-0.5">
        <span>30s</span>
        <span>600s</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex gap-2">
      <button
        class="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? 'Đang lưu...' : 'Lưu' }}
      </button>
      <button
        class="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
        :disabled="testing || !config.apiKey"
        @click="testConnection"
      >
        {{ testing ? 'Đang test...' : 'Test Connection' }}
      </button>
    </div>

    <!-- Save message -->
    <p v-if="saveMessage" class="text-xs text-green-600 text-center">
      {{ saveMessage }}
    </p>

    <!-- Cache storage info -->
    <div class="border border-gray-200 rounded-lg p-3 space-y-2">
      <div class="flex items-center justify-between text-xs">
        <span class="font-medium text-gray-700">Cache local</span>
        <span :class="cacheNearFull ? 'text-orange-600 font-medium' : 'text-gray-500'">
          {{ cacheSizeMB }} MB / 8 MB ({{ cacheUsagePercent }}%)
        </span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-1.5">
        <div
          class="h-1.5 rounded-full transition-all"
          :class="cacheNearFull ? 'bg-orange-500' : 'bg-blue-500'"
          :style="{ width: `${Math.min(cacheUsagePercent, 100)}%` }"
        />
      </div>
      <p v-if="cacheNearFull" class="text-xs text-orange-600">
        ⚠ Cache gần đầy. Các cache cũ sẽ tự động bị xoá khi lưu mới.
      </p>
    </div>

    <!-- Test result -->
    <LoadingSpinner v-if="testing" text="Đang kiểm tra kết nối..." />
    <div
      v-if="testResult === 'success'"
      class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 text-center"
    >
      Kết nối thành công!
    </div>
    <div
      v-if="testResult === 'fail'"
      class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 text-center"
    >
      Kết nối thất bại. Kiểm tra lại API Key và Base URL.
    </div>

    <!-- ─── Custom Prompt Templates ──────────────────────────────── -->
    <div class="border border-gray-200 rounded-lg overflow-hidden">
      <div class="bg-gray-50 px-3 py-2 border-b border-gray-200">
        <h3 class="text-xs font-semibold text-gray-700">Prompt Templates</h3>
        <p class="text-xs text-gray-500 mt-0.5">Để trống để dùng prompt mặc định.</p>
      </div>

      <!-- Tabs -->
      <div class="flex border-b border-gray-200">
        <button
          v-for="tab in (['summary', 'opinions', 'research'] as const)"
          :key="tab"
          class="flex-1 py-1.5 text-xs font-medium transition-colors"
          :class="activePromptTab === tab
            ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
            : 'text-gray-500 hover:text-gray-700'"
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
          class="w-full border border-gray-300 rounded px-2 py-1.5 text-xs font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
          :placeholder="defaultPrompts[activePromptTab].slice(0, 120) + '...'"
        />
        <div class="flex gap-2">
          <button
            class="flex-1 text-xs py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            @click="savePrompts"
          >
            Lưu Prompts
          </button>
          <button
            class="text-xs py-1.5 px-3 border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors"
            :disabled="!customPrompts[activePromptTab]"
            @click="resetPrompt"
          >
            Reset mặc định
          </button>
        </div>
        <p v-if="promptSaveMessage" class="text-xs text-green-600">{{ promptSaveMessage }}</p>
        <p v-if="promptError" class="text-xs text-red-600">{{ promptError }}</p>
      </div>
    </div>
  </div>
</template>
