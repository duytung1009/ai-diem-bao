import { ref, computed } from 'vue';
import { useLLM } from './useLLM';
import type { NotebookEntry, NotebookEntryForQA } from '@/lib/types';
import type { NotebookQAResult } from '@/lib/llm/summarizer';
import { rankBm25 } from '@/lib/lexical-search';

export interface QAMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  usedEntryIds?: string[];
  /** IDs ordered the same as entries passed to the LLM — [n] in text maps to selectedEntryIds[n-1] */
  selectedEntryIds?: string[];
  ts: number;
}

const TOP_K = 30;
/** Must match QA_DIRECT_THRESHOLD in lib/llm/summarizer.ts */
const QA_DIRECT_THRESHOLD = 20;

function projectEntry(entry: NotebookEntry): NotebookEntryForQA {
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    userNote: entry.userNote,
    category: entry.category,
    tags: entry.tags,
    sourceTopicTitle: entry.sourceTopicTitle,
    source: entry.source,
  };
}

export interface QAPendingConfirm {
  question: string;
  callEstimate: number; // 1 or 2
  selectedEntries: NotebookEntryForQA[];
}

export function useNotebookQA() {
  const llm = useLLM();
  const history = ref<QAMessage[]>([]);
  const isLoading = ref(false);
  const progressMessage = ref('');
  const error = ref('');
  const currentTaskId = ref<string | null>(null);
  const pendingConfirm = ref<QAPendingConfirm | null>(null);

  async function runTask(question: string, selected: NotebookEntryForQA[], selectedIds: string[]) {
    isLoading.value = true;
    progressMessage.value = 'Đang chuẩn bị...';
    error.value = '';

    const { taskId, result } = llm.notebookQATask(question, selected);
    currentTaskId.value = taskId;

    const progressInterval = setInterval(() => {
      const state = llm.getTaskState(taskId);
      if (state?.progress?.message) progressMessage.value = state.progress.message;
    }, 300);

    try {
      const res = await result;
      if (res.success) {
        const qaResult = res.data as NotebookQAResult;
        history.value = [
          ...history.value,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: qaResult.answer,
            usedEntryIds: qaResult.usedEntryIds,
            selectedEntryIds: selectedIds,
            ts: Date.now(),
          },
        ];
      } else {
        error.value = res.error ?? 'Đã xảy ra lỗi khi tra cứu.';
      }
    } catch (err) {
      error.value = String(err);
    } finally {
      clearInterval(progressInterval);
      isLoading.value = false;
      progressMessage.value = '';
      currentTaskId.value = null;
    }
  }

  async function ask(question: string, allEntries: NotebookEntry[]) {
    if (!question.trim() || isLoading.value) return;

    const userMsg: QAMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: question.trim(),
      ts: Date.now(),
    };
    history.value = [...history.value, userMsg];
    error.value = '';

    // Project entries and apply client-side BM25 ranking
    const projected = allEntries.map(projectEntry);
    let selected: NotebookEntryForQA[];

    if (projected.length <= TOP_K) {
      selected = projected;
    } else {
      const ranked = rankBm25(question, projected);
      const hasScores = ranked.some(x => x.score > 0);
      if (hasScores) {
        selected = ranked.slice(0, TOP_K).map(x => x.entry);
      } else {
        selected = projected;
      }
    }

    // Cost guard: if > QA_DIRECT_THRESHOLD entries, need 2 calls — show confirm
    const callEstimate = selected.length > QA_DIRECT_THRESHOLD ? 2 : 1;
    if (callEstimate > 3) {
      pendingConfirm.value = { question: question.trim(), callEstimate, selectedEntries: selected };
      return;
    }

    await runTask(question.trim(), selected, selected.map(e => e.id));
  }

  async function confirmAsk() {
    if (!pendingConfirm.value) return;
    const { question, selectedEntries } = pendingConfirm.value;
    pendingConfirm.value = null;
    await runTask(question, selectedEntries, selectedEntries.map(e => e.id));
  }

  function cancelConfirm() {
    // Remove the user message added before confirm
    if (pendingConfirm.value && history.value.length > 0 && history.value[history.value.length - 1].role === 'user') {
      history.value = history.value.slice(0, -1);
    }
    pendingConfirm.value = null;
  }

  function cancelQA() {
    if (currentTaskId.value) {
      llm.cancelTask(currentTaskId.value);
      isLoading.value = false;
      progressMessage.value = '';
      currentTaskId.value = null;
    }
  }

  function clearHistory() {
    history.value = [];
    error.value = '';
  }

  return {
    history: computed(() => history.value),
    isLoading,
    progressMessage,
    error,
    pendingConfirm,
    ask,
    confirmAsk,
    cancelConfirm,
    cancelQA,
    clearHistory,
  };
}
