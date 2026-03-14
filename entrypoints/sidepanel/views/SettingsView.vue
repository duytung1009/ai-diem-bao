<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { sendMessage } from '@/lib/messaging';
import { DEFAULT_LLM_CONFIG } from '@/lib/constants';
import type { LLMConfig } from '@/lib/types';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const config = ref<LLMConfig>({ ...DEFAULT_LLM_CONFIG });
const saving = ref(false);
const testing = ref(false);
const testResult = ref<'success' | 'fail' | ''>('');
const saveMessage = ref('');

onMounted(async () => {
  const loaded = await sendMessage<LLMConfig>('GET_SETTINGS');
  if (loaded?.apiKey !== undefined) {
    config.value = loaded;
  }
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
    // Save first so background uses latest config
    await sendMessage('SAVE_SETTINGS', config.value);
    const result = await sendMessage<{ ok: boolean; error?: string }>('TEST_CONNECTION');
    testResult.value = result.ok ? 'success' : 'fail';
  } catch {
    testResult.value = 'fail';
  } finally {
    testing.value = false;
  }
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
      </select>
    </div>

    <!-- API Key -->
    <div>
      <label class="block text-xs font-medium text-gray-600 mb-1">API Key</label>
      <input
        v-model="config.apiKey"
        type="password"
        placeholder="sk-..."
        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
      />
    </div>

    <!-- Base URL -->
    <div>
      <label class="block text-xs font-medium text-gray-600 mb-1">Base URL</label>
      <input
        v-model="config.baseUrl"
        type="text"
        placeholder="https://api.openai.com/v1"
        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
      />
    </div>

    <!-- Model -->
    <div>
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
  </div>
</template>
