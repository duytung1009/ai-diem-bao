import { ref, computed, watch } from 'vue';
import type { ThreadAnalysisJSON, SummaryJSON } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import { createRunGuard } from '@/lib/run-guard';
import { useTopicStore } from './useTopicStore';
import { useLLM } from './useLLM';

export function useThreadAnalysis(store: ReturnType<typeof useTopicStore>) {
  const { threadAnalysisTask, cancelTask, getTaskState } = useLLM();

  const isAnalyzing = ref(false);

  watch(isAnalyzing, (val) => {
    store.setCurrentOperation('analyze', val);
  });
  const error = ref('');
  const llmTaskId = ref<string | null>(null);
  const analysisGuard = createRunGuard();

  const cachedTopic = computed(() => store.selectedTopic.value);

  const threadAnalysis = computed<ThreadAnalysisJSON | null>(() => {
    const ct = cachedTopic.value;
    return (ct?.threadAnalysis as ThreadAnalysisJSON | undefined) ?? null;
  });

  const summaryJson = computed<SummaryJSON | null>(() => {
    const ct = cachedTopic.value;
    if (!ct) return null;
    if (ct.summaryJson) return ct.summaryJson as unknown as SummaryJSON;
    const segments = ct.segments ?? [];
    if (segments.length === 1 && segments[0].summaryJson) {
      return segments[0].summaryJson as unknown as SummaryJSON;
    }
    if (ct.overallSummary && segments.length > 1) {
      const lastSeg = segments[segments.length - 1];
      if (lastSeg?.summaryJson) return lastSeg.summaryJson as unknown as SummaryJSON;
    }
    return null;
  });

  const hasSummary = computed(() => !!summaryJson.value);

  async function generateAnalysis(): Promise<void> {
    const topic = store.selectedTopic.value;
    if (!topic || !summaryJson.value || isAnalyzing.value) return;

    const thisId = analysisGuard.begin();
    isAnalyzing.value = true;
    error.value = '';

    try {
      const task = threadAnalysisTask(summaryJson.value, {
        title: topic.title,
        totalPages: topic.totalPages,
        totalPosts: topic.totalPosts,
      });
      llmTaskId.value = task.taskId;
      const taskResult = await task.result;
      llmTaskId.value = null;

      if (analysisGuard.isStale(thisId)) return;

      const analysis = (taskResult.data as { analysis: unknown }).analysis as ThreadAnalysisJSON;

      store.updateSelectedTopic({ threadAnalysis: analysis });

      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        threadAnalysis: analysis,
      }).catch(() => { });
    } catch (err) {
      if (analysisGuard.isStale(thisId)) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (!analysisGuard.isStale(thisId)) {
        isAnalyzing.value = false;
        llmTaskId.value = null;
      }
    }
  }

  return {
    threadAnalysis,
    isAnalyzing,
    error,
    summaryJson,
    hasSummary,
    llmTaskId,
    generateAnalysis,
    cancelTask,
    getTaskState,
  };
}
