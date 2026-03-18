<script setup lang="ts">
import { ref, onActivated, computed } from 'vue';
import type { CachedTopic } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import MarkdownContent from '../components/MarkdownContent.vue';
import ErrorDisplay from '../components/ErrorDisplay.vue';
import { useLLM } from '../composables/useLLM';
import { useTopicStore } from '../composables/useTopicStore';

const { analyzeOpinions: runAnalysis, isLoading, error, progress } = useLLM();
const store = useTopicStore();

const opinions = ref<string | null>(null);
const cachedTopic = ref<CachedTopic | null>(null);
const loadedTopicUrl = ref<string | null>(null);

interface OpinionAnalysis {
  mainTopic: string;
  sentiment: 'Tích cực' | 'Tiêu cực' | 'Trung lập';
  opinions: Array<{
    name: string;
    supporters: string[];
    supporterCount: number;
    description: string;
    quote: string;
  }>;
  summary: string;
}

const parsedOpinions = computed(() => {
  if (!opinions.value) return null;
  try {
    // Extract JSON from possible markdown code fences
    const jsonMatch = opinions.value.match(/```(?:json)?\s*([\s\S]*?)```/) || ['', opinions.value];
    return JSON.parse(jsonMatch[1].trim()) as OpinionAnalysis;
  } catch {
    return null;
  }
});

async function loadTopicData() {
  const topic = store.selectedTopic.value;
  if (!topic) return;
  loadedTopicUrl.value = topic.url;
  cachedTopic.value = topic as CachedTopic;
  if (topic.opinions) opinions.value = topic.opinions;
  try {
    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (fresh) {
      cachedTopic.value = fresh;
      if (fresh.opinions) opinions.value = fresh.opinions;
    }
  } catch { /* no cache */ }
}

onActivated(async () => {
  const url = store.selectedTopic.value?.url;
  if (url && url !== loadedTopicUrl.value) await loadTopicData();
});

async function handleAnalyze() {
  if (!cachedTopic.value?.posts?.length) return;

  const result = await runAnalysis(cachedTopic.value.posts);
  if (result) {
    opinions.value = result;
    // Persist opinions to cache so it survives a reload
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: cachedTopic.value.url,
      opinions: result,
    }).catch(() => {});
    store.updateSelectedTopic({ opinions: result });
  }
}

function getSentimentColor(sentiment: string): string {
  switch (sentiment) {
    case 'Tích cực': return 'text-green-700 bg-green-50 border-green-200';
    case 'Tiêu cực': return 'text-red-700 bg-red-50 border-red-200';
    default: return 'text-gray-700 bg-gray-50 border-gray-200';
  }
}
</script>

<template>
  <div class="p-4 space-y-4">
    <h2 class="font-semibold text-sm text-gray-900">Phân tích Ý kiến</h2>

    <!-- No cache warning -->
    <div
      v-if="!cachedTopic?.posts?.length"
      class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800"
    >
      Chưa có dữ liệu bài viết. Vui lòng tóm tắt topic ở tab "Tóm tắt" trước.
    </div>

    <button
      v-if="cachedTopic?.posts?.length"
      class="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
      :disabled="isLoading"
      @click="handleAnalyze"
    >
      {{ isLoading ? 'Đang phân tích...' : 'Phân tích Ý kiến' }}
    </button>

    <!-- Progress -->
    <LoadingSpinner v-if="isLoading" :text="progress || 'Đang phân tích ý kiến...'" />

    <!-- Error -->
    <ErrorDisplay v-if="error" :message="error" action="retry" @retry="handleAnalyze" />

    <!-- Opinions -->
    <div v-if="opinions && !isLoading" class="space-y-4">
      <!-- JSON format -->
      <div v-if="parsedOpinions" class="space-y-4">
        <!-- Main topic -->
        <div class="border border-gray-200 rounded-lg p-3">
          <p class="text-xs font-medium text-gray-600 mb-1">Đề tài chính</p>
          <p class="text-sm text-gray-900">{{ parsedOpinions.mainTopic }}</p>
        </div>

        <!-- Sentiment -->
        <div :class="`border rounded-lg p-3 ${getSentimentColor(parsedOpinions.sentiment)}`">
          <p class="text-xs font-medium mb-1">Sentiment tổng quan</p>
          <p class="text-sm font-semibold">{{ parsedOpinions.sentiment }}</p>
        </div>

        <!-- Opinions list -->
        <div class="space-y-3">
          <h3 class="font-semibold text-sm text-gray-900">Các quan điểm chính</h3>
          <div
            v-for="(opinion, idx) in parsedOpinions.opinions"
            :key="idx"
            class="border border-gray-200 rounded-lg p-3 space-y-2"
          >
            <div class="flex items-center justify-between">
              <h4 class="font-medium text-sm text-gray-900">{{ opinion.name }}</h4>
              <span class="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-1 rounded">
                {{ opinion.supporterCount }} người
              </span>
            </div>
            <p class="text-xs text-gray-600">
              <strong>Ủng hộ bởi:</strong> {{ opinion.supporters.join(', ') }}
            </p>
            <p class="text-sm text-gray-700">{{ opinion.description }}</p>
            <div class="bg-gray-50 border border-gray-200 rounded p-2">
              <p class="text-xs text-gray-600 italic">"{{ opinion.quote }}"</p>
            </div>
          </div>
        </div>

        <!-- Summary -->
        <div class="border border-gray-200 rounded-lg p-3 bg-gray-50">
          <p class="text-xs font-medium text-gray-600 mb-2">Tổng kết</p>
          <p class="text-sm text-gray-700">{{ parsedOpinions.summary }}</p>
        </div>
      </div>

      <!-- Markdown format fallback -->
      <div v-else class="bg-white rounded-lg border border-gray-200 p-4">
        <MarkdownContent :content="opinions" />
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-if="!isLoading && !opinions && cachedTopic?.posts?.length"
      class="text-center py-6"
    >
      <p class="text-xs text-gray-400">Bấm nút phía trên để phân tích ý kiến trong topic.</p>
    </div>
  </div>
</template>
