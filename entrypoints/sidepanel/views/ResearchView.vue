<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import type { CachedTopic, ResearchEntry } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import MarkdownContent from '../components/MarkdownContent.vue';
import ErrorDisplay from '../components/ErrorDisplay.vue';
import { useTopicStore } from '../composables/useTopicStore';

const cachedTopic = ref<CachedTopic | null>(null);
const question = ref('');
const isLoading = ref(false);
const error = ref<string | null>(null);
const history = ref<ResearchEntry[]>([]);
const store = useTopicStore();

// Suggested questions derived from the topic title
const suggestedQuestions = computed(() => {
  const title = cachedTopic.value?.title;
  if (!title) return [];
  return [
    `Kết luận chính của topic "${title}" là gì?`,
    `Ai đề cập đến vấn đề quan trọng nhất trong topic này?`,
    `Các giải pháp nào được đề xuất?`,
    `Ai có quan điểm ủng hộ và ai phản đối?`,
  ];
});

onMounted(async () => {
  // Load from store first
  const topic = store.selectedTopic.value;
  if (topic) {
    cachedTopic.value = topic as CachedTopic;
    history.value = [...(topic.researchHistory ?? [])];
  }
  // Then try to reload from cache for freshest data
  if (topic?.url) {
    try {
      const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
      if (fresh) {
        cachedTopic.value = fresh;
        history.value = fresh.researchHistory ?? [];
      }
    } catch { /* no cache */ }
  }
});

async function handleResearch() {
  const q = question.value.trim();
  if (!q || !cachedTopic.value?.posts?.length) return;

  isLoading.value = true;
  error.value = null;

  try {
    const result = await sendMessage<{ answer?: string; error?: string }>(
      'RESEARCH_QUERY',
      { posts: cachedTopic.value.posts, question: q },
    );

    if (result?.error) {
      error.value = result.error;
      return;
    }

    if (result?.answer) {
      const entry: ResearchEntry = {
        question: q,
        answer: result.answer,
        askedAt: Date.now(),
      };
      history.value = [entry, ...history.value];
      question.value = '';

      // Persist to cache
      await sendMessage('SAVE_CACHED_TOPIC', {
        url: cachedTopic.value!.url,
        researchHistory: history.value,
      }).catch(() => {});
      store.updateSelectedTopic({ researchHistory: history.value });
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    isLoading.value = false;
  }
}

function useSuggestion(q: string) {
  question.value = q;
}

function clearHistory() {
  history.value = [];
  sendMessage('SAVE_CACHED_TOPIC', {
    url: cachedTopic.value!.url,
    researchHistory: [],
  }).catch(() => {});
  store.updateSelectedTopic({ researchHistory: [] });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}
</script>

<template>
  <div class="p-4 space-y-4">
    <h2 class="font-semibold text-sm text-gray-900">Tra cứu Topic</h2>

    <!-- No cache warning -->
    <div
      v-if="!cachedTopic?.posts?.length"
      class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800"
    >
      Chưa có dữ liệu bài viết. Vui lòng tóm tắt topic ở tab "Tóm tắt" trước.
    </div>

    <template v-if="cachedTopic?.posts?.length">
      <!-- Question input -->
      <div class="space-y-2">
        <textarea
          v-model="question"
          rows="2"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          placeholder="Đặt câu hỏi về nội dung topic..."
          :disabled="isLoading"
          @keydown.ctrl.enter="handleResearch"
        />
        <button
          class="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          :disabled="isLoading || !question.trim()"
          @click="handleResearch"
        >
          {{ isLoading ? 'Đang tra cứu...' : 'Tra cứu (Ctrl+Enter)' }}
        </button>
      </div>

      <!-- Suggested questions -->
      <div v-if="!isLoading && history.length === 0" class="space-y-2">
        <p class="text-xs text-gray-500 font-medium">Gợi ý câu hỏi:</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="q in suggestedQuestions"
            :key="q"
            class="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors text-left"
            @click="useSuggestion(q)"
          >
            {{ q }}
          </button>
        </div>
      </div>

      <!-- Loading -->
      <LoadingSpinner v-if="isLoading" text="Đang tra cứu câu trả lời..." />

      <!-- Error -->
      <ErrorDisplay v-if="error && !isLoading" :message="error" action="retry" @retry="handleResearch" />

      <!-- Q&A History -->
      <div v-if="history.length" class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-medium text-gray-600">Lịch sử tra cứu</h3>
          <button
            class="text-xs text-gray-400 hover:text-red-500 transition-colors"
            @click="clearHistory"
          >
            Xóa tất cả
          </button>
        </div>

        <div
          v-for="entry in history"
          :key="entry.askedAt"
          class="border border-gray-200 rounded-lg overflow-hidden"
        >
          <!-- Question -->
          <div class="bg-gray-50 px-3 py-2 border-b border-gray-200">
            <div class="flex items-start justify-between gap-2">
              <p class="text-sm font-medium text-gray-800">{{ entry.question }}</p>
              <span class="text-xs text-gray-400 shrink-0">{{ formatDate(entry.askedAt) }}</span>
            </div>
          </div>
          <!-- Answer -->
          <div class="px-3 py-2">
            <MarkdownContent :content="entry.answer" />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
