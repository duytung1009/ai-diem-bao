<script setup lang="ts">
import { ref, onActivated, computed, watch } from 'vue';
import type { CachedTopic, ResearchEntry } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import ProgressIndicator from '../components/ProgressIndicator.vue';
import StepTimeline from '../components/StepTimeline.vue';
import MarkdownContent from '../components/MarkdownContent.vue';
import ErrorDisplay from '../components/ErrorDisplay.vue';
import { useLLM } from '../composables/useLLM';
import type { PipelineDefinition } from '@/lib/types';
import { buildResearchPipeline, markFirstStepRunning } from '@/lib/pipeline-builder';
import { useTopicStore } from '../composables/useTopicStore';
import { useOptimisticUpdate } from '../composables/useOptimisticUpdate';
import BackButton from '../components/BackButton.vue';
import EmptyState from '../components/EmptyState.vue';
import OperationConflictAlert from '../components/OperationConflictAlert.vue';

const store = useTopicStore();
const { optimisticUpdate } = useOptimisticUpdate(store);
const cachedTopic = computed(() => store.selectedTopic.value);

// Posts may live in segments (F20 Unified Segment Mode) rather than top-level posts
const allPosts = computed(() => {
  const t = cachedTopic.value;
  if (!t) return [];
  const posts = t.posts?.length ? t.posts : t.segments?.flatMap(s => s.posts ?? []) ?? [];
  return [...posts]; // mutable copy for runResearch
});
const question = ref('');
const isLoading = ref(false);

watch(isLoading, (val) => {
  store.setCurrentOperation('research', val);
});
const error = ref<string | null>(null);
const history = ref<ResearchEntry[]>([]);
const llmTaskId = ref<string | null>(null);
const { researchTopic: runResearch, getTaskState, cancelTask, checkLLMConfigured } = useLLM();

const activePipeline = computed<PipelineDefinition | null>(() => {
  if (!llmTaskId.value) return null;
  return getTaskState(llmTaskId.value)?.pipeline ?? null;
});

// Suggested questions derived from the topic title
const suggestedQuestions = computed(() => {
  const title = cachedTopic.value?.title;
  if (!title) return [];
  return [
    `Kết luận chính của thớt là gì?`,
    `Ai đề cập đến vấn đề quan trọng nhất trong thớt này?`,
    `Các giải pháp nào được đề xuất?`,
    `Ai có quan điểm ủng hộ và ai phản đối?`,
  ];
});

const loadedTopicUrl = ref<string | null>(null);
const loadedTopicTitle = ref('');
const pendingConflict = ref<{ newUrl: string; newTitle: string } | null>(null);

async function loadTopicData() {
  const topic = store.selectedTopic.value;
  if (!topic) return;

  // Show conflict alert if research running for a different topic
  if (isLoading.value && loadedTopicUrl.value && topic.url !== loadedTopicUrl.value) {
    pendingConflict.value = { newUrl: topic.url, newTitle: topic.title ?? '...' };
    return;
  }

  loadedTopicUrl.value = topic.url;
  loadedTopicTitle.value = topic.title ?? '';
  history.value = [...(topic.researchHistory ?? [])];
  try {
    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (fresh) {
      store.updateSelectedTopic(fresh);
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

  const configCheck = await checkLLMConfigured();
  if (!configCheck.ok) { error.value = configCheck.error!; return; }

  isLoading.value = true;
  error.value = null;
  const pipeline = buildResearchPipeline();
  markFirstStepRunning(pipeline);

  try {
    const { taskId, result } = runResearch(allPosts.value, q);
    llmTaskId.value = taskId;
    // Set detailed pipeline in task state for timeline display
    const st = getTaskState(taskId);
    if (st) st.pipeline = JSON.parse(JSON.stringify(pipeline));
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
    await optimisticUpdate({ researchHistory: history.value });
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
  optimisticUpdate({ researchHistory: [] });
}

function handleConflictCancel() {
  if (llmTaskId.value) cancelTask(llmTaskId.value);
  isLoading.value = false;
  llmTaskId.value = null;
  pendingConflict.value = null;
  loadTopicData();
}

async function handleConflictGoBack() {
  const oldUrl = loadedTopicUrl.value;
  if (oldUrl) {
    const oldTopic = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', oldUrl);
    if (oldTopic) store.selectTopic(oldTopic);
  }
  pendingConflict.value = null;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}
</script>

<template>
  <div class="p-3 space-y-2">
    <!-- No topic selected -->
    <EmptyState v-if="!cachedTopic" icon="🧵" title="Chưa chọn thớt">
      <template #action>
        <BackButton />
      </template>
    </EmptyState>

    <!-- Topic loaded -->
    <template v-else>
      <!-- Back button + Refresh -->
      <div class="flex items-center justify-between">
        <BackButton />
        <h2 class="section-heading">Tra cứu thớt</h2>
      </div>

      <!-- Conflict alert: running task for old topic -->
      <OperationConflictAlert
        v-if="pendingConflict"
        operation="tra cứu"
        :oldTopicTitle="loadedTopicTitle"
        :newTopicTitle="pendingConflict.newTitle"
        @cancel="handleConflictCancel"
        @goBack="handleConflictGoBack"
      />

      <template v-if="!pendingConflict">

      <!-- No cache warning -->
      <div v-if="!allPosts.length" class="alert alert-warning text-xs">
        Chưa có dữ liệu của thớt. Vui lòng tóm tắt thớt ở tab "Tóm tắt" trước.
      </div>

      <template v-if="allPosts.length">
        <!-- Question input -->
        <div class="space-y-2">
          <!-- eslint-disable-next-line vuejs-accessibility/form-control-has-label -- will be fixed in task 407 -->
          <textarea v-model="question" rows="3" class="input resize-none" placeholder="Đặt câu hỏi về nội dung thớt..." :disabled="isLoading"
            @keydown.ctrl.enter="handleResearch" />
          <button class="btn-llm" :disabled="isLoading || !question.trim()" @click="handleResearch">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
            </svg>
            {{ isLoading ? 'Đang tra cứu...' : 'Tra cứu' }}
          </button>
        </div>

        <!-- Suggested questions -->
        <div v-if="!isLoading && history.length === 0" class="space-y-2">
          <p class="text-xs text-(--color-text-secondary) font-medium">Gợi ý câu hỏi:</p>
          <div class="flex flex-wrap gap-2">
            <button v-for="q in suggestedQuestions" :key="q"
              class="badge badge-neutral text-left"
              @click="useSuggestion(q)">
              {{ q }}
            </button>
          </div>
        </div>

        <!-- Loading -->
        <StepTimeline v-if="isLoading && activePipeline" :pipeline="activePipeline" />
        <ProgressIndicator v-else-if="isLoading" :task-id="llmTaskId" fallback-message="Đang tra cứu câu trả lời..." />

        <!-- Error -->
        <ErrorDisplay v-if="error && !isLoading" :message="error" action="retry" @retry="handleResearch" />

        <!-- Q&A History -->
        <div v-if="history.length" class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-medium text-(--color-text-secondary)">Lịch sử tra cứu</h3>
            <button class="btn btn-ghost btn-sm text-xs hover:text-(--color-error-text)" @click="clearHistory">
              Xóa tất cả
            </button>
          </div>

          <div v-for="entry in history" :key="entry.askedAt" class="card overflow-hidden">
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
    </template>
  </div>
</template>
