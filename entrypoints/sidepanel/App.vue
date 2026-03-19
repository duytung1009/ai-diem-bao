<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { DetectResult } from '@/lib/types';
import { useTopicStore } from './composables/useTopicStore';
import { useTheme } from './composables/useTheme';

const route = useRoute();
const router = useRouter();
const store = useTopicStore();
const { loadTheme } = useTheme();

let tabActivatedListener: ((activeInfo: { tabId: number }) => void) | null = null;
let tabUpdatedListener: ((tabId: number, changeInfo: { status?: string }) => void) | null = null;

// Detect topic on active tab when sidepanel opens, re-detect on tab switch/navigate
onMounted(async () => {
  await loadTheme();
  await detectActiveTabTopic();

  tabActivatedListener = async (_activeInfo) => {
    await detectActiveTabTopic();
  };
  browser.tabs.onActivated.addListener(tabActivatedListener);

  tabUpdatedListener = async (tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return;
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id === tabId) {
      await detectActiveTabTopic();
    }
  };
  browser.tabs.onUpdated.addListener(tabUpdatedListener);
});

onUnmounted(() => {
  if (tabActivatedListener) browser.tabs.onActivated.removeListener(tabActivatedListener);
  if (tabUpdatedListener) browser.tabs.onUpdated.removeListener(tabUpdatedListener);
});

// Topic-specific tabs disabled when no topic selected
const hasSelectedTopic = computed(() => !!store.selectedTopic.value);

async function detectActiveTabTopic() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;
    console.log('detectActiveTabTopic: Active tab URL:', tab.url);

    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'DETECT_XF',
    }) as DetectResult | undefined;
    console.log('Detect result for active tab:', result);

    if (result && result.version !== 'unknown') {
      store.setActiveTab(result, tab.url);
    } else {
      store.setActiveTab(null, null);
    }
  } catch {
    // Content script not available on this tab (chrome://, about:blank, etc.)
    store.setActiveTab(null, null);
  }
}

function navigateTo(path: string) {
  router.push(path);
}
</script>

<template>
  <div class="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] flex flex-col">
    <!-- Header -->
    <header class="bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] px-4 py-3">
      <h1 class="text-lg font-bold text-blue-600">AI Điểm Báo</h1>
    </header>

    <!-- Tab Navigation -->
    <nav class="bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] flex">
      <router-link to="/" class="flex-1 text-center py-2.5 text-xs font-medium transition-colors" :class="route.name === 'hub'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
        ">
        Chủ đề
      </router-link>
      <button class="flex-1 text-center py-2.5 text-xs font-medium transition-colors" :class="route.name === 'summary'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : hasSelectedTopic
            ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-muted)] cursor-not-allowed'
        " :disabled="!hasSelectedTopic" @click="hasSelectedTopic && navigateTo('/summary')">
        Tóm tắt
      </button>
      <button class="flex-1 text-center py-2.5 text-xs font-medium transition-colors" :class="route.name === 'opinions'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : hasSelectedTopic
            ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-muted)] cursor-not-allowed'
        " :disabled="!hasSelectedTopic" @click="hasSelectedTopic && navigateTo('/opinions')">
        Ý kiến
      </button>
      <button class="flex-1 text-center py-2.5 text-xs font-medium transition-colors" :class="route.name === 'research'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : hasSelectedTopic
            ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-muted)] cursor-not-allowed'
        " :disabled="!hasSelectedTopic" @click="hasSelectedTopic && navigateTo('/research')">
        Tra cứu
      </button>
      <router-link to="/settings" class="flex-1 text-center py-2.5 text-xs font-medium transition-colors" :class="route.name === 'settings'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
        ">
        Cài đặt
      </router-link>
    </nav>

    <!-- Content -->
    <main class="flex-1 overflow-y-auto">
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>