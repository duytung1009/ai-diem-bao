<script setup lang="ts">
import { ref, onActivated, computed } from 'vue';
import type { CachedTopic, ResearchEntry } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import ProgressIndicator from '../components/ProgressIndicator.vue';
import MarkdownContent from '../components/MarkdownContent.vue';
import ErrorDisplay from '../components/ErrorDisplay.vue';
import { useLLM } from '../composables/useLLM';
import { useTopicStore } from '../composables/useTopicStore';
const cachedTopic = ref<CachedTopic | null>(null);

// Posts may live in segments (F20 Unified Segment Mode) rather than top-level posts
const allPosts = computed(() => {
  const t = cachedTopic.value;
  if (!t) return [];
  if (t.posts?.length) return t.posts;
  return t.segments?.flatMap(s => s.posts ?? []) ?? [];
});
const question = ref('');
const isLoading = ref(false);
const error = ref<string | null>(null);
const history = ref<ResearchEntry[]>([]);
const llmTaskId = ref<string | null>(null);
const { researchTopic: runResearch } = useLLM();
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

const loadedTopicUrl = ref<string | null>(null);

async function loadTopicData() {
  const topic = store.selectedTopic.value;
  if (!topic) return;
  loadedTopicUrl.value = topic.url;
  cachedTopic.value = topic as CachedTopic;
  history.value = [...(topic.researchHistory ?? [])];
  try {
    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (fresh) {
      cachedTopic.value = fresh;
      history.value = fresh.researchHistory ?? [];
    }
  } catch { /* no cache */ }
}

onActivated(async () => {
  const url = store.selectedTopic.value?.url;
  if (url && url !== loadedTopicUrl.value) await loadTopicData();
});

async function handleResearch() {
  const q = question.value.trim();
  if (!q || !allPosts.value.length) return;

  isLoading.value = true;
  error.value = null;

  try {
    const { taskId, result } = runResearch(allPosts.value, q);
    llmTaskId.value = taskId;
    const llmResult = await result;
    const answer = (llmResult.data as { answer: string }).answer;

    const entry: ResearchEntry = {
      question: q,
      answer,
      askedAt: Date.now(),
    };
    history.value = [entry, ...history.value];
    question.value = '';

    // Persist to cache
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: cachedTopic.value!.url,
      researchHistory: history.value,
    }).catch(() => { });
    store.updateSelectedTopic({ researchHistory: history.value });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    isLoading.value = false;
    llmTaskId.value = null;
  }
}

function useSuggestion(q: string) {
  question.value = q;
}

function clearHistory() {
  if (!cachedTopic.value) return;
  history.value = [];
  sendMessage('SAVE_CACHED_TOPIC', {
    url: cachedTopic.value!.url,
    researchHistory: [],
  }).catch(() => { });
  store.updateSelectedTopic({ researchHistory: [] });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- No topic selected -->
    <div v-if="!cachedTopic" class="text-center py-8">
      <p class="text-sm text-(--color-text-secondary)">Chưa chọn chủ đề.</p>
      <button class="mt-3 text-sm text-blue-600 hover:text-blue-700" @click="$router.push('/')">
        ← Quay lại danh sách
      </button>
    </div>

    <!-- Topic loaded -->
    <template v-else>
      <!-- Back button + Refresh -->
      <div class="flex items-center justify-between">
        <button class="text-xs text-blue-600 hover:text-blue-700" @click="$router.push('/')">
          ← Quay lại danh sách
        </button>
      </div>

      <h2 class="font-semibold text-sm text-(--color-text-primary)">Tra cứu Topic</h2>

      <!-- No cache warning -->
      <div v-if="!allPosts.length" class="alert alert-warning">
        Chưa có dữ liệu bài viết. Vui lòng tóm tắt topic ở tab "Tóm tắt" trước.
      </div>

      <template v-if="allPosts.length">
        <!-- Question input -->
        <div class="space-y-2">
          <textarea v-model="question" rows="2" class="input resize-none" placeholder="Đặt câu hỏi về nội dung topic..." :disabled="isLoading"
            @keydown.ctrl.enter="handleResearch" />
          <button class="w-full btn btn-primary" :disabled="isLoading || !question.trim()" @click="handleResearch">
            {{ isLoading ? 'Đang tra cứu...' : 'Tra cứu (Ctrl+Enter)' }}
          </button>
        </div>

        <!-- Suggested questions -->
        <div v-if="!isLoading && history.length === 0" class="space-y-2">
          <p class="text-xs text-(--color-text-secondary) font-medium">Gợi ý câu hỏi:</p>
          <div class="flex flex-wrap gap-2">
            <button v-for="q in suggestedQuestions" :key="q"
              class="text-xs px-2 py-1 rounded-full bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft) hover:text-(--color-accent-text) transition-colors text-left"
              @click="useSuggestion(q)">
              {{ q }}
            </button>
          </div>
        </div>

        <!-- Loading -->
        <ProgressIndicator v-if="isLoading" :task-id="llmTaskId" fallback-message="Đang tra cứu câu trả lời..." />

        <!-- Error -->
        <ErrorDisplay v-if="error && !isLoading" :message="error" action="retry" @retry="handleResearch" />

        <!-- Q&A History -->
        <div v-if="history.length" class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-medium text-(--color-text-secondary)">Lịch sử tra cứu</h3>
            <button class="text-xs text-(--color-text-muted) hover:text-red-500 transition-colors" @click="clearHistory">
              Xóa tất cả
            </button>
          </div>

          <div v-for="entry in history" :key="entry.askedAt" class="border border-(--color-border) rounded-lg overflow-hidden">
            <!-- Question -->
            <div class="bg-(--color-bg-muted) px-3 py-2 border-b border-(--color-border)">
              <div class="flex items-start justify-between gap-2">
                <p class="text-sm font-medium text-(--color-text-primary)">{{ entry.question }}</p>
                <span class="text-xs text-(--color-text-muted) shrink-0">{{ formatDate(entry.askedAt) }}</span>
              </div>
            </div>
            <!-- Answer -->
            <div class="px-3 py-2">
              <MarkdownContent :content="entry.answer" />
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>