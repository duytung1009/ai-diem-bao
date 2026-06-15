<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { DetectResult, CachedTopic } from '@/lib/types';
import { normalizeUrl, isSameTopicUrl } from '@/lib/cache-manager';
import { sendMessage } from '@/lib/messaging';
import { hasOriginPermission, requestOriginPermission } from '@/lib/permissions';
import { useTopicStore } from './composables/useTopicStore';
import { useTheme } from './composables/useTheme';
import TopicMeta from './components/TopicMeta.vue';
import PillTabs from './components/PillTabs.vue';
import { PermissionRequiredError } from '@/lib/scrapers/page-loader';

const route = useRoute();
const router = useRouter();
const store = useTopicStore();
const { loadTheme } = useTheme();

const pendingDetectOrigin = ref('');
let tabActivatedListener: ((activeInfo: { tabId: number }) => void) | null = null;
let tabUpdatedListener: ((tabId: number, changeInfo: { status?: string; url?: string }) => void) | null = null;

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

const hasSelectedTopic = computed(() => !!store.selectedTopic.value);

const isThreadActive = computed(() =>
  ['hub', 'summary', 'knowledge', 'analysis', 'research'].includes(route.name as string),
);

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
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    pendingDetectOrigin.value = '';

    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'DETECT_XF',
    }) as DetectResult | undefined;
    
    if (result && result.version !== 'unknown' && result.url) {
      const cleanUrl = result.url.replace(/#.*$/, '');
      store.setActiveTab({ ...result, url: cleanUrl }, cleanUrl);
      await autoUpdateCachedTopic(cleanUrl, { ...result, url: cleanUrl });
    } else {
      store.setActiveTab(null, null);
    }
  } catch (err) {
    console.info('[detectActiveTabTopic] Error detecting topic on active tab:', err);
    store.setActiveTab(null, null);
  }
}

async function handleGrantDetectPermission() {
  const origin = pendingDetectOrigin.value;
  if (!origin) return;
  const granted = await requestOriginPermission(origin + '/*');
  pendingDetectOrigin.value = '';
  if (granted) {
    // Inject content script into the active tab so DETECT_XF works immediately
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await browser.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['/content-scripts/content.js'],
        });
      }
    } catch {
      // Script already injected or injection failed — retry detection anyway
    }
    await detectActiveTabTopic();
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

    const hasChanges =
      cached.version !== detect.version ||
      cached.forumPostCount !== detect.postCount ||
      cached.totalPages !== detect.pageCount ||
      (!!detect.title && cached.title !== detect.title);

    if (!hasChanges) return;

    if (detect.postCount > 0 && detect.postCount !== cached.forumPostCount) {
      await sendMessage('SAVE_CACHED_TOPIC', {
        ...cached,
        version: detect.version,
        forumPostCount: detect.postCount,
        totalPages: detect.pageCount,
        title: detect.title || cached.title,
      });
    } else if (cached.totalPages !== detect.pageCount) {
      await sendMessage('SAVE_CACHED_TOPIC', {
        ...cached,
        version: detect.version,
        totalPages: detect.pageCount,
        title: detect.title || cached.title,
      });
    } else if (cached.version !== detect.version) {
      await sendMessage('SAVE_CACHED_TOPIC', {
        ...cached,
        version: detect.version,
        title: detect.title || cached.title,
      });
    } else if (!!detect.title && cached.title !== detect.title) {
      await sendMessage('SAVE_CACHED_TOPIC', {
        ...cached,
        version: detect.version,
        title: detect.title || cached.title,
      });
    }

    const normalizedTabUrl = normalizeUrl(tabUrl);
    const selectedUrl = store.selectedTopic.value?.url;
    if (selectedUrl && normalizeUrl(selectedUrl) === normalizedTabUrl) {
      store.updateSelectedTopic({
        version: detect.version,
        totalPages: detect.pageCount,
        forumPostCount: detect.postCount,
        title: detect.title || cached.title,
      });
    }
  } catch {
    // IndexedDB error — silent fail
  }
}

const topTabs = [
  {
    name: 'threads',
    label: 'Thớt',
    route: '/',
    icon: 'chat',
    isActive: computed(() => isThreadActive.value),
  },
  {
    name: 'newsfeed',
    label: 'Điểm báo',
    route: '/newsfeed',
    icon: 'news',
    isActive: computed(() => route.name === 'newsfeed'),
  },
  {
    name: 'notebook',
    label: 'Sổ tay',
    route: '/notebook',
    icon: 'book',
    isActive: computed(() => route.name === 'notebook'),
  },
  {
    name: 'settings',
    label: 'Cài đặt',
    route: '/settings',
    icon: 'gear',
    isActive: computed(() => route.name === 'settings'),
  },
  {
    name: 'help',
    label: '?',
    route: '/help',
    icon: 'help',
    isActive: computed(() => route.name === 'help'),
  },
];

const subTabs = [
  { value: 'hub', label: 'Danh sách' },
  { value: 'summary', label: 'Tóm tắt' },
  { value: 'analysis', label: 'Phân tích' },
  { value: 'research', label: 'Tra cứu' },
  { value: 'knowledge', label: 'Kiến thức' },
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
    <!-- Top Navigation Bar -->
    <nav class="bg-(--color-bg-surface) border-b border-(--color-border) px-2 py-1.5 flex items-center gap-1 shrink-0">
      <button
        v-for="tab in topTabs"
        :key="tab.name"
        class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium font-heading transition-all duration-150"
        :class="tab.isActive.value
          ? 'bg-(--color-accent-soft) text-(--color-accent)'
          : 'text-(--color-text-secondary) hover:text-(--color-text-primary) hover:bg-(--color-bg-muted)'"
        @click="navigateTo(tab.route)"
      >
        <svg v-if="tab.icon === 'chat'" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <svg v-else-if="tab.icon === 'news'" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
        </svg>
        <svg v-else-if="tab.icon === 'book'" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <svg v-else-if="tab.icon === 'gear'" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {{ tab.label }}
      </button>
    </nav>

    <!-- Sub-tab bar -->
    <nav v-if="isThreadActive" class="px-3 pt-2.5 pb-0 shrink-0">
      <PillTabs :tabs="subTabs" :modelValue="activeSubTab" :loadingTabs="loadingSubTab" @update:modelValue="onSubTabChange" />
    </nav>

    <!-- Permission prompt -->
    <div v-if="pendingDetectOrigin" class="px-3 pt-3 shrink-0">
      <div class="alert alert-warning text-xs flex items-center justify-between gap-2">
        <span>Cần cấp quyền truy cập <strong class="text-(--color-text-primary)">{{ pendingDetectOrigin }}</strong> để phát hiện thớt trên tab hiện tại.</span>
        <button class="btn btn-accent btn-xs shrink-0" @click="handleGrantDetectPermission()">Cấp quyền</button>
      </div>
    </div>

    <!-- Content -->
    <main class="flex-1 overflow-y-auto scrollbar-thin">
      <div v-if="selectedTopicForMeta" class="px-3 pt-3">
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
