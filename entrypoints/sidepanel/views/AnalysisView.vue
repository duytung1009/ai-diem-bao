<script setup lang="ts">
import { onActivated, computed, ref, onMounted } from 'vue';
import { useTopicStore } from '../composables/useTopicStore';
import { sendMessage } from '@/lib/messaging';
import type { CachedTopic } from '@/lib/types';
import { useThreadAnalysis } from '../composables/useThreadAnalysis';
import { useSeederDetection } from '../composables/useSeederDetection';
import type { PipelineDefinition } from '@/lib/types';
import ErrorDisplay from '../components/ErrorDisplay.vue';
import ThreadAnalysisContent from '../components/ThreadAnalysisContent.vue';
import StepTimeline from '../components/StepTimeline.vue';
import BackButton from '../components/BackButton.vue';
import OperationConflictAlert from '../components/OperationConflictAlert.vue';

const store = useTopicStore();
const { threadAnalysis, isAnalyzing, error, hasSummary, llmTaskId, generateAnalysis, getTaskState, cancelTask } = useThreadAnalysis(store);
const { showTrustBadges, loadSetting: loadSeederSetting } = useSeederDetection();

onMounted(() => { loadSeederSetting().catch(() => {}); });

const cachedTopic = computed(() => store.selectedTopic.value);
const loadedTopicUrl = ref<string | null>(null);
const loadedTopicTitle = ref('');
const pendingConflict = ref<{ newUrl: string; newTitle: string } | null>(null);

const activePipeline = computed<PipelineDefinition | null>(() => {
  if (!llmTaskId.value) return null;
  return getTaskState(llmTaskId.value)?.pipeline ?? null;
});

onActivated(() => {
  const url = store.selectedTopic.value?.url;
  if (!url) return;

  // Show conflict alert if analyzing for a different topic
  if (isAnalyzing.value && loadedTopicUrl.value && url !== loadedTopicUrl.value) {
    pendingConflict.value = { newUrl: url, newTitle: store.selectedTopic.value?.title ?? '...' };
    return;
  }

  loadedTopicUrl.value = url;
  loadedTopicTitle.value = store.selectedTopic.value?.title ?? '';
});

function handleConflictCancel() {
  if (llmTaskId.value) cancelTask(llmTaskId.value);
  isAnalyzing.value = false;
  llmTaskId.value = null;
  pendingConflict.value = null;
  loadedTopicUrl.value = store.selectedTopic.value?.url ?? null;
  loadedTopicTitle.value = store.selectedTopic.value?.title ?? '';
}

async function handleConflictGoBack() {
  const oldUrl = loadedTopicUrl.value;
  if (oldUrl) {
    const oldTopic = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', oldUrl);
    if (oldTopic) store.selectTopic(oldTopic);
  }
  pendingConflict.value = null;
}
</script>

<template>
  <div class="p-4 space-y-4">
    <div v-if="!cachedTopic" class="text-center py-8">
      <p class="text-sm text-(--color-text-secondary)">Chưa chọn thớt.</p>
      <BackButton class="mt-3" />
    </div>

    <template v-else>
      <div class="flex items-center justify-between">
        <BackButton />
        <h2 class="font-semibold text-sm text-(--color-text-primary)">Phân tích thớt</h2>
      </div>

      <OperationConflictAlert
        v-if="pendingConflict"
        operation="phân tích thớt"
        :oldTopicTitle="loadedTopicTitle"
        :newTopicTitle="pendingConflict.newTitle"
        @cancel="handleConflictCancel"
        @goBack="handleConflictGoBack"
      />

      <template v-if="!pendingConflict">
        <StepTimeline v-if="isAnalyzing && activePipeline" :pipeline="activePipeline" :show-cancel="true" @cancel="cancelTask(llmTaskId!)" />

        <div v-if="!hasSummary" class="text-xs alert alert-warning">
          Chưa có dữ liệu của thớt. Vui lòng tóm tắt thớt ở tab "Tóm tắt" trước.
        </div>

        <template v-else>
          <ErrorDisplay v-if="error" :message="error" />

          <ThreadAnalysisContent v-if="threadAnalysis" :analysis="threadAnalysis" :thread-title="cachedTopic.title" :total-pages="cachedTopic.totalPages" :user-trust-scores="cachedTopic?.userTrustScores" :show-trust-badges="showTrustBadges">
            <template #actions>
              <button class="btn text-xs flex items-center gap-1" :disabled="isAnalyzing" @click="generateAnalysis">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {{ isAnalyzing ? 'Đang phân tích...' : 'Phân tích lại' }}
              </button>
            </template>
          </ThreadAnalysisContent>

          <div v-else-if="!isAnalyzing" class="flex flex-col items-center space-y-2">
            <p class="text-sm text-(--color-text-secondary)">Chưa có phân tích cho thớt này.</p>
            <button class="btn-llm" @click="generateAnalysis">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
              </svg>
              {{ 'Phân tích thớt' }}
            </button>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
