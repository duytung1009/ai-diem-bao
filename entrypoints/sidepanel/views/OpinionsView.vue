<script setup lang="ts">
import { ref, onActivated, computed } from 'vue';
import { useRouter } from 'vue-router';
import type { CachedTopic } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import ProgressIndicator from '../components/ProgressIndicator.vue';
import MarkdownContent from '../components/MarkdownContent.vue';
import ErrorDisplay from '../components/ErrorDisplay.vue';
import AccordionItem from '../components/AccordionItem.vue';
import { useLLM } from '../composables/useLLM';
import { useTopicStore } from '../composables/useTopicStore';
import TopicMeta from '../components/TopicMeta.vue';

const { analyzeOpinions: runAnalysis } = useLLM();
const store = useTopicStore();
const router = useRouter();

const opinions = ref<string | null>(null);
const cachedTopic = ref<CachedTopic | null>(null);
const loadedTopicUrl = ref<string | null>(null);
const isLoading = ref(false);
const error = ref('');
const llmTaskId = ref<string | null>(null);

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

/**
 * Best-effort repair for LLM-generated JSON with unescaped double quotes inside string values.
 * Uses a state machine with lookahead: if we're inside a string and hit `"` but the next
 * non-whitespace char is NOT a structural JSON char, it's an internal quote — escape it.
 */
function repairJson(str: string): string {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    // Handle escape sequences: pass through and skip next char
    if (ch === '\\' && inString) {
      result += ch + (str[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += ch;
      } else {
        // Look ahead past whitespace to find next meaningful char
        let j = i + 1;
        while (j < str.length && (str[j] === ' ' || str[j] === '\n' || str[j] === '\r' || str[j] === '\t')) j++;
        const next = str[j];
        const isStructural = next === ':' || next === ',' || next === '}' || next === ']' || j >= str.length;
        if (isStructural) {
          inString = false;
          result += ch;
        } else {
          // Internal unescaped quote — escape it
          result += '\\"';
        }
      }
    } else {
      result += ch;
    }
    i++;
  }
  return result;
}

const parsedOpinions = computed(() => {
  if (!opinions.value) return null;
  try {
    const fenceMatch = opinions.value.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = (fenceMatch ? fenceMatch[1] : opinions.value).trim();
    try {
      return JSON.parse(jsonStr) as OpinionAnalysis;
    } catch {
      // Fallback: attempt to repair unescaped quotes then retry
      return JSON.parse(repairJson(jsonStr)) as OpinionAnalysis;
    }
  } catch {
    return null;
  }
});

const totalOpinionSupporters = computed(() =>
  parsedOpinions.value?.opinions.reduce((sum, op) => sum + op.supporterCount, 0) ?? 0,
);

async function loadTopicData() {
  const topic = store.selectedTopic.value;
  if (!topic) return;
  const url = topic.url; // capture before async boundary

  // Reset all view state for new topic
  opinions.value = null;
  cachedTopic.value = null;

  loadedTopicUrl.value = url;
  cachedTopic.value = topic as CachedTopic;
  if (topic.opinions) opinions.value = topic.opinions;
  try {
    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', url);
    if (loadedTopicUrl.value !== url) return; // topic switched during await — discard stale result
    if (fresh) {
      cachedTopic.value = fresh;
      store.updateSelectedTopic(fresh);
      if (fresh.opinions) opinions.value = fresh.opinions;
    }
  } catch { /* no cache */ }
}

onActivated(async () => {
  const url = store.selectedTopic.value?.url;
  if (!url) return;
  if (url !== loadedTopicUrl.value) {
    await loadTopicData();
  } else {
    // Same topic — refresh from cache in case opinions were updated elsewhere
    try {
      const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', url);
      if (fresh) {
        cachedTopic.value = fresh;
        store.updateSelectedTopic(fresh);
        if (fresh.opinions) opinions.value = fresh.opinions;
      }
    } catch { /* ignore */ }
  }
});

async function handleAnalyze() {
  if (!cachedTopic.value?.posts?.length) return;
  isLoading.value = true;
  error.value = '';

  try {
    const { taskId, result } = runAnalysis(cachedTopic.value.posts);
    llmTaskId.value = taskId;
    const llmResult = await result;
    const opinionsText = (llmResult.data as { opinions: string }).opinions;
    opinions.value = opinionsText;
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: cachedTopic.value.url,
      opinions: opinionsText,
    }).catch(() => { });
    store.updateSelectedTopic({ opinions: opinionsText });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    isLoading.value = false;
    llmTaskId.value = null;
  }
}

function getSentimentColor(sentiment: string): string {
  switch (sentiment) {
    case 'Tích cực': return 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800';
    case 'Tiêu cực': return 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800';
    default: return 'text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
  }
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

      <TopicMeta v-if="store.selectedTopic.value" :topic="store.selectedTopic.value as CachedTopic" />

      <h2 class="font-semibold text-sm text-(--color-text-primary)">Phân tích Ý kiến</h2>

      <!-- No cache warning -->
      <div v-if="!cachedTopic?.posts?.length" class="alert alert-warning">
        Chưa có dữ liệu bài viết. Vui lòng tóm tắt topic ở tab "Tóm tắt" trước.
      </div>

      <button v-if="cachedTopic?.posts?.length && !opinions && !isLoading" class="w-full btn btn-primary" @click="handleAnalyze">
        Phân tích Ý kiến
      </button>

      <!-- Progress -->
      <ProgressIndicator v-if="isLoading" :task-id="llmTaskId" fallback-message="Đang phân tích ý kiến..." />

      <!-- Error -->
      <ErrorDisplay v-if="error" :message="error" action="retry" @retry="handleAnalyze" />

      <!-- Opinions -->
      <div v-if="opinions && !isLoading" class="space-y-4">
        <!-- JSON format -->
        <div v-if="parsedOpinions" class="space-y-4">
          <!-- Main topic -->
          <div class="card">
            <p class="text-xs font-medium text-(--color-text-secondary) mb-1">Đề tài chính</p>
            <p class="text-sm text-(--color-text-primary)">{{ parsedOpinions.mainTopic }}</p>
          </div>

          <!-- Sentiment -->
          <div :class="`border rounded-lg p-3 ${getSentimentColor(parsedOpinions.sentiment)}`">
            <p class="text-xs font-medium mb-1">Sentiment tổng quan</p>
            <p class="text-sm font-semibold">{{ parsedOpinions.sentiment }}</p>
          </div>

          <!-- Opinions list -->
          <div class="space-y-2">
            <h3 class="font-semibold text-sm text-(--color-text-primary)">Các quan điểm chính</h3>
            <AccordionItem
              v-for="(opinion, idx) in parsedOpinions.opinions"
              :key="idx"
            >
              <template #title>
                <div class="w-full min-w-0">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-medium text-sm">{{ opinion.name }}</span>
                    <span class="text-xs text-(--color-text-secondary) ml-2 shrink-0">
                      {{ opinion.supporterCount }} người
                    </span>
                  </div>
                </div>
              </template>
              <div class="space-y-2 text-sm">
                <p class="text-xs text-(--color-text-secondary)">
                  <strong>Ủng hộ bởi:</strong> {{ (opinion.supporters ?? []).join(', ') }}
                </p>
                <p>{{ opinion.description }}</p>
                <div class="bg-(--color-bg-muted) border border-(--color-border) rounded-lg p-2">
                  <p class="text-xs text-(--color-text-secondary) italic">"{{ opinion.quote }}"</p>
                </div>
              </div>
            </AccordionItem>
          </div>

          <!-- Summary -->
          <div class="card">
            <p class="text-xs font-medium text-(--color-text-secondary) mb-2">Tổng kết</p>
            <p class="text-sm">{{ parsedOpinions.summary }}</p>
          </div>
        </div>

        <!-- Markdown format fallback -->
        <div v-else class="card">
          <MarkdownContent :content="opinions" />
        </div>

        <button
          v-if="cachedTopic?.posts?.length"
          class="w-full btn btn-secondary"
          @click="handleAnalyze"
        >
          Phân tích lại
        </button>
      </div>

      <!-- Empty state -->
      <div v-if="!isLoading && !opinions && cachedTopic?.posts?.length" class="text-center py-6">
        <p class="text-xs text-(--color-text-muted)">Bấm nút phía trên để phân tích ý kiến trong topic.</p>
      </div>
    </template>
  </div>
</template>