<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { DetectResult, CachedTopic } from '@/lib/types';
import { normalizeUrl, getCachedTopic, saveCachedTopic, isSameTopicUrl } from '@/lib/cache-manager';
import { useTopicStore } from './composables/useTopicStore';
import { useTheme } from './composables/useTheme';
import TopicMeta from './components/TopicMeta.vue';

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

// Shared TopicMeta displayed once above router-view on all topic-detail tabs
const isTopicDetailRoute = computed(() =>
  ['summary', 'knowledge', 'research'].includes(route.name as string),
);
const selectedTopicForMeta = computed<CachedTopic | null>(() =>
  isTopicDetailRoute.value ? store.selectedTopic.value as CachedTopic : null,
);

const isSummarizingCurrentTopic = computed(() =>
  !!(store.summarizingUrl.value &&
    store.selectedTopic.value &&
    isSameTopicUrl(store.summarizingUrl.value, store.selectedTopic.value.url)),
);

async function detectActiveTabTopic() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;

    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'DETECT_XF',
    }) as DetectResult | undefined;

    if (result && result.version !== 'unknown') {
      store.setActiveTab(result, tab.url);
      await autoUpdateCachedTopic(tab.url, result);
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
    const cached = await getCachedTopic(tabUrl);
    if (!cached) return;

    // Cập nhật forumPostCount (không ảnh hưởng incremental logic)
    // totalPosts, totalPages giữ nguyên giá trị lúc scrape
    const hasChanges =
      cached.forumPostCount !== detect.postCount ||
      (!!detect.title && cached.title !== detect.title);

    if (!hasChanges) return;

    if (detect.postCount > 0 && detect.postCount !== cached.forumPostCount) {
      await saveCachedTopic({
        ...cached,
        forumPostCount: detect.postCount,
        title: detect.title || cached.title,
      });
    } else if (!!detect.title && cached.title !== detect.title) {
      await saveCachedTopic({
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

function navigateTo(path: string) {
  router.push(path);
}
</script>

<template>
  <div class="min-h-screen bg-(--color-bg-base) text-(--color-text-primary) flex flex-col">
    <!-- Header -->
    <!-- <header class="bg-(--color-bg-surface) border-b border-(--color-border) px-4 py-3">
      <h1 class="text-lg font-bold text-blue-600">AI Điểm Báo</h1>
    </header> -->

    <!-- Tab Navigation -->
    <nav class="bg-(--color-bg-surface) border-b border-(--color-border) flex">
      <router-link to="/" class="flex-1 text-center py-2.5 text-xs font-medium transition-colors" :class="route.name === 'hub'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : 'text-(--color-text-secondary) hover:text-(--color-text-primary)'
        ">
        Chủ đề
      </router-link>
      <button class="flex-1 text-center py-2.5 text-xs font-medium transition-colors" :class="route.name === 'summary'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : hasSelectedTopic
            ? 'text-(--color-text-secondary) hover:text-(--color-text-primary)'
            : 'text-(--color-text-muted) cursor-not-allowed'
        " :disabled="!hasSelectedTopic" @click="hasSelectedTopic && navigateTo('/summary')">
        Tóm tắt
      </button>
      <button class="flex-1 text-center py-2.5 text-xs font-medium transition-colors" :class="route.name === 'knowledge'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : hasSelectedTopic
            ? 'text-(--color-text-secondary) hover:text-(--color-text-primary)'
            : 'text-(--color-text-muted) cursor-not-allowed'
        " :disabled="!hasSelectedTopic" @click="hasSelectedTopic && navigateTo('/knowledge')">
        Kiến thức
      </button>
      <button class="flex-1 text-center py-2.5 text-xs font-medium transition-colors" :class="route.name === 'research'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : hasSelectedTopic
            ? 'text-(--color-text-secondary) hover:text-(--color-text-primary)'
            : 'text-(--color-text-muted) cursor-not-allowed'
        " :disabled="!hasSelectedTopic" @click="hasSelectedTopic && navigateTo('/research')">
        Tra cứu
      </button>
      <router-link to="/settings" class="flex-1 text-center py-2.5 text-xs font-medium transition-colors" :class="route.name === 'settings'
          ? 'text-blue-600 border-b-2 border-blue-600'
          : 'text-(--color-text-secondary) hover:text-(--color-text-primary)'
        ">
        Cài đặt
      </router-link>
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