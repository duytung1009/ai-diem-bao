<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { DetectResult, CachedTopic } from '@/lib/types';
import { normalizeUrl, isSameTopicUrl } from '@/lib/cache-manager';
import { sendMessage } from '@/lib/messaging';
import { useTopicStore } from './composables/useTopicStore';
import { useTheme } from './composables/useTheme';
import TopicMeta from './components/TopicMeta.vue';
import PillTabs from './components/PillTabs.vue';

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

// "Thớt" top-level tab is active for hub + all topic detail routes
const isThreadActive = computed(() =>
  ['hub', 'summary', 'knowledge', 'analysis', 'research'].includes(route.name as string),
);

// Shared TopicMeta displayed once above router-view on all topic-detail tabs
const isTopicDetailRoute = computed(() =>
  ['summary', 'knowledge', 'analysis', 'research'].includes(route.name as string),
);
const selectedTopicForMeta = computed<CachedTopic | null>(() =>
  isTopicDetailRoute.value ? store.selectedTopic.value as CachedTopic : null,
);

const isSummarizingCurrentTopic = computed(() =>
  !!(store.summarizingUrl.value &&
    store.selectedTopic.value &&
    isSameTopicUrl(store.summarizingUrl.value, store.selectedTopic.value.url)),
);

const loadingSubTab = computed(() => {
  const ops = store.currentOperation.value;
  if (!ops.size) return undefined;
  const result = new Set<string>();
  for (const op of ops) {
    if (op === 'summarize') result.add('summary');
    else if (op === 'extract') result.add('knowledge');
    else if (op === 'analyze') result.add('analysis');
    else if (op === 'research') result.add('research');
  }
  return result;
});

async function detectActiveTabTopic() {
  try {
    // Không đọc tab.url — cần tabs permission. Chỉ lấy tabId để sendMessage.
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'DETECT_XF',
    }) as DetectResult | undefined;

    // URL lấy từ content script response (location.href) thay vì tab.url
    if (result && result.version !== 'unknown' && result.url) {
      store.setActiveTab(result, result.url);
      await autoUpdateCachedTopic(result.url, result);
    } else {
      store.setActiveTab(null, null);
    }
  } catch {
    // Content script not available on this tab (chrome://, about:blank, etc.)
    store.setActiveTab(null, null);
  }
}

async function autoUpdateCachedTopic(tabUrl: string, detect: DetectResult) {
  try {
    const cached = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', tabUrl);
    if (!cached) return;

    if (detect.threadDeleted) {
      await sendMessage('SAVE_CACHED_TOPIC', { ...cached, threadDeleted: true });
      const normalizedTabUrl = normalizeUrl(tabUrl);
      const selectedUrl = store.selectedTopic.value?.url;
      if (selectedUrl && normalizeUrl(selectedUrl) === normalizedTabUrl) {
        store.updateSelectedTopic({ threadDeleted: true });
      }
      return;
    }

    if (detect.threadLocked) {
      await sendMessage('SAVE_CACHED_TOPIC', { ...cached, threadLocked: true });
      const normalizedTabUrl = normalizeUrl(tabUrl);
      const selectedUrl = store.selectedTopic.value?.url;
      if (selectedUrl && normalizeUrl(selectedUrl) === normalizedTabUrl) {
        store.updateSelectedTopic({ threadLocked: true });
      }
    }

    // Always update totalPages and forumPostCount from live detect
    const hasChanges =
      cached.forumPostCount !== detect.postCount ||
      cached.totalPages !== detect.pageCount ||
      (!!detect.title && cached.title !== detect.title);

    if (!hasChanges) return;

    if (detect.postCount > 0 && detect.postCount !== cached.forumPostCount) {
      await sendMessage('SAVE_CACHED_TOPIC', {
        ...cached,
        forumPostCount: detect.postCount,
        totalPages: detect.pageCount,
        title: detect.title || cached.title,
      });
    } else if (cached.totalPages !== detect.pageCount) {
      await sendMessage('SAVE_CACHED_TOPIC', {
        ...cached,
        totalPages: detect.pageCount,
        title: detect.title || cached.title,
      });
    } else if (!!detect.title && cached.title !== detect.title) {
      await sendMessage('SAVE_CACHED_TOPIC', {
        ...cached,
        title: detect.title || cached.title,
      });
    }

    const normalizedTabUrl = normalizeUrl(tabUrl);
    const selectedUrl = store.selectedTopic.value?.url;
    if (selectedUrl && normalizeUrl(selectedUrl) === normalizedTabUrl) {
      store.updateSelectedTopic({
        totalPages: detect.pageCount,
        forumPostCount: detect.postCount,
        title: detect.title || cached.title,
      });
    }
  } catch {
    // IndexedDB error — silent fail
  }
}

const subTabs = [
  { value: 'hub', label: 'Danh sách' },
  { value: 'summary', label: 'Tóm tắt' },
  { value: 'knowledge', label: 'Kiến thức' },
  { value: 'analysis', label: 'Phân tích' },
  { value: 'research', label: 'Tra cứu' },
];

const activeSubTab = computed(() => (route.name as string) || 'hub');

const subTabRoutes: Record<string, string> = {
  hub: '/',
  summary: '/summary',
  knowledge: '/knowledge',
  analysis: '/analysis',
  research: '/research',
};

function onSubTabChange(value: string) {
  router.push(subTabRoutes[value] || '/');
}

function navigateTo(path: string) {
  router.push(path);
}
</script>

<template>
  <div class="min-h-screen bg-(--color-bg-base) text-(--color-text-primary) flex flex-col">
    <!-- Header -->
    <!-- <header class="bg-(--color-bg-surface) border-b border-(--color-border) px-4 py-3">
      <h1 class="text-lg font-bold text-blue-600">Lội Thớt Hộ</h1>
    </header> -->

    <!-- Tab Navigation -->
    <nav class="bg-(--color-bg-surface) border-b border-(--color-border) flex">
      <button class="flex-1 flex items-center justify-center gap-1 py-2.5 font-medium transition-colors" :class="isThreadActive
          ? 'text-blue-600 border-b-2 border-blue-600'
          : 'text-(--color-text-secondary) hover:text-(--color-text-primary)'
        " @click="navigateTo('/')">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        Thớt
      </button>
      <button class="flex-1 flex items-center justify-center gap-1 py-2.5 font-medium transition-colors" :class="route.name === 'notebook'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : 'text-(--color-text-secondary) hover:text-(--color-text-primary)'
        " @click="navigateTo('/notebook')">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        Sổ tay
      </button>
      <button class="flex-1 flex items-center justify-center gap-1 py-2.5 font-medium transition-colors" :class="route.name === 'settings'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : 'text-(--color-text-secondary) hover:text-(--color-text-primary)'
        " @click="navigateTo('/settings')">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Cài đặt
      </button>
      <button title="Hướng dẫn sử dụng" class="w-8 text-center py-2.5 text-sm font-bold transition-colors shrink-0" :class="route.name === 'help'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : 'text-(--color-text-muted) hover:text-(--color-text-primary)'
        " @click="navigateTo('/help')">
        ?
      </button>
    </nav>

    <!-- Sub-tab bar: visible when a topic is selected -->
    <nav v-if="hasSelectedTopic && isThreadActive" class="mx-4 mt-3">
      <PillTabs :tabs="subTabs" :modelValue="activeSubTab" :loadingTabs="loadingSubTab" @update:modelValue="onSubTabChange" />
    </nav>

    <!-- Content -->
    <main class="flex-1 overflow-y-auto">
      <!-- Single TopicMeta shared across Tóm tắt / Kiến thức / Tra cứu tabs -->
      <div v-if="selectedTopicForMeta" class="px-4 pt-4">
        <TopicMeta
          :topic="selectedTopicForMeta"
          :is-summarizing="isSummarizingCurrentTopic"
        />
      </div>
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>