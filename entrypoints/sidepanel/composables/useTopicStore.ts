import { ref, readonly } from 'vue';
import type { CachedTopic, DetectResult } from '@/lib/types';

// Module-level state (singleton, shared across all components)
const selectedTopic = ref<CachedTopic | null>(null);
const activeTabDetect = ref<DetectResult | null>(null);
const activeTabUrl = ref<string | null>(null);
const summarizingUrl = ref<string | null>(null);
const currentOperation = ref<Set<string>>(new Set());

export function useTopicStore() {
  function selectTopic(topic: CachedTopic) {
    selectedTopic.value = topic;
  }

  function clearSelection() {
    selectedTopic.value = null;
  }

  function setActiveTab(detect: DetectResult | null, url: string | null) {
    activeTabDetect.value = detect;
    activeTabUrl.value = url;
  }

  function updateSelectedTopic(partial: Partial<CachedTopic>) {
    if (!selectedTopic.value) return;
    const merged = { ...selectedTopic.value };
    for (const key of Object.keys(partial) as (keyof CachedTopic)[]) {
      const val = partial[key];
      if (val !== undefined) (merged as any)[key] = val;
    }
    selectedTopic.value = merged;
  }

  function setSummarizing(url: string | null) {
    summarizingUrl.value = url;
  }

  function setCurrentOperation(name: string, active: boolean) {
    const next = new Set(currentOperation.value);
    if (active) next.add(name);
    else next.delete(name);
    currentOperation.value = next;
  }

  return {
    selectedTopic: readonly(selectedTopic),
    activeTabDetect: readonly(activeTabDetect),
    activeTabUrl: readonly(activeTabUrl),
    summarizingUrl: readonly(summarizingUrl),
    currentOperation: readonly(currentOperation),
    // Actions
    selectTopic,
    clearSelection,
    setActiveTab,
    updateSelectedTopic,
    setSummarizing,
    setCurrentOperation,
  };
}
