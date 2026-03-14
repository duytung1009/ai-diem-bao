<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { sendMessage } from '@/lib/messaging';
import type { DetectResult, TopicData } from '@/lib/types';
import TopicMeta from '../components/TopicMeta.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const topicInfo = ref<DetectResult | null>(null);
const summary = ref('');
const error = ref('');
const loadingText = ref('');
const isDetecting = ref(true);

onMounted(async () => {
  await detectTopic();
});

async function detectTopic() {
  isDetecting.value = true;
  error.value = '';
  topicInfo.value = null;

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      error.value = 'Không tìm thấy tab đang mở.';
      return;
    }
    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'DETECT_XF',
    }) as DetectResult | undefined;

    if (!result || result.version === 'unknown') {
      error.value = 'Trang này không phải forum XenForo.';
      return;
    }
    topicInfo.value = result;
  } catch {
    error.value = 'Không thể kết nối với trang. Hãy thử tải lại trang.';
  } finally {
    isDetecting.value = false;
  }
}

async function handleSummarize() {
  if (!topicInfo.value) return;
  error.value = '';
  summary.value = '';

  try {
    // Step 1: Scrape
    loadingText.value = 'Đang đọc bài viết...';
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Không tìm thấy tab');

    const scraped = await browser.tabs.sendMessage(tab.id, {
      type: 'SCRAPE_TOPIC',
    }) as TopicData & { error?: string };

    if (scraped.error) throw new Error(scraped.error);
    if (!scraped.posts?.length) throw new Error('Không tìm thấy bài viết nào.');

    // Step 2: Summarize via background
    loadingText.value = `Đang tóm tắt ${scraped.posts.length} bài viết...`;
    const result = await sendMessage<{ summary?: string; error?: string }>(
      'SUMMARIZE',
      scraped.posts,
    );

    if (result.error) throw new Error(result.error);
    summary.value = result.summary || 'Không có kết quả.';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingText.value = '';
  }
}
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- Detecting -->
    <LoadingSpinner v-if="isDetecting" text="Đang kiểm tra trang..." />

    <!-- Not XenForo -->
    <div v-else-if="error && !topicInfo" class="text-center py-8">
      <p class="text-sm text-gray-500">{{ error }}</p>
      <button
        class="mt-3 text-sm text-blue-600 hover:text-blue-700"
        @click="detectTopic"
      >
        Thử lại
      </button>
    </div>

    <!-- Topic detected -->
    <template v-else-if="topicInfo">
      <TopicMeta :info="topicInfo" />

      <!-- Summarize button -->
      <button
        v-if="!loadingText && !summary"
        class="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        @click="handleSummarize"
      >
        Tóm tắt
      </button>

      <!-- Loading -->
      <LoadingSpinner v-if="loadingText" :text="loadingText" />

      <!-- Error -->
      <div
        v-if="error"
        class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700"
      >
        {{ error }}
        <button
          class="block mt-2 text-red-600 hover:text-red-700 font-medium"
          @click="handleSummarize"
        >
          Thử lại
        </button>
      </div>

      <!-- Summary result -->
      <div v-if="summary" class="space-y-3">
        <div class="bg-white rounded-lg border border-gray-200 p-4">
          <p class="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {{ summary }}
          </p>
        </div>
        <button
          class="w-full py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          @click="handleSummarize"
        >
          Tóm tắt lại
        </button>
      </div>
    </template>
  </div>
</template>
