import { ref, readonly } from 'vue';
import type { CachedTopic, DetectResult } from '@/lib/types';

// Module-level state (singleton, shared across all components)
const selectedTopic = ref<CachedTopic | null>(null);
const activeTabDetect = ref<DetectResult | null>(null);
const activeTabUrl = ref<string | null>(null);

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
    selectedTopic.value = { ...selectedTopic.value, ...partial };
  }

  return {
    // State (readonly để tránh mutation trực tiếp từ bên ngoài)
    selectedTopic: readonly(selectedTopic),
    activeTabDetect: readonly(activeTabDetect),
    activeTabUrl: readonly(activeTabUrl),
    // Actions
    selectTopic,
    clearSelection,
    setActiveTab,
    updateSelectedTopic,
  };
}
