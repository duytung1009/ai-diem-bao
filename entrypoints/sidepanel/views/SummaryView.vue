<script setup lang="ts">
import { ref, onMounted, onUnmounted, onActivated, onDeactivated, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage } from '@/lib/messaging';
import { willExceedContext, estimateCost, formatTokenCount, formatCost } from '@/lib/token-estimator';
import type { DetectResult, ScrapedPost, CachedTopic, CacheFreshness, LLMConfig, Message, PageProgress } from '@/lib/types';
import type { MultiPageResult } from '@/lib/scrapers/page-loader';
import { useTopicStore } from '../composables/useTopicStore';
import TopicMeta from '../components/TopicMeta.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import SummaryContent from '../components/SummaryContent.vue';
import CacheIndicator from '../components/CacheIndicator.vue';
import ErrorDisplay from '../components/ErrorDisplay.vue';

const router = useRouter();
const store = useTopicStore();

const summary = ref('');
const error = ref('');
const loadingText = ref('');
const summarizedPostCount = ref(0);
const isScraping = ref(false);
const scrapingWarnings = ref<string[]>([]);

// Token estimation state
const pendingPosts = ref<ScrapedPost[] | null>(null);
const pendingIncremental = ref(false);
const currentConfig = ref<LLMConfig | null>(null);

// Cache state
const cachedTopic = ref<CachedTopic | null>(null);
const cacheFreshness = ref<CacheFreshness | null>(null);

// Derived from store — replaces topicInfo ref
const topicInfo = computed<DetectResult | null>(() => {
  const topic = store.selectedTopic.value;
  if (!topic) return null;
  return {
    version: topic.version,
    title: topic.title,
    postCount: topic.totalPosts,
    pageCount: topic.totalPages,
  } satisfies DetectResult;
});

const tokenEstimation = computed(() => {
  if (!pendingPosts.value || !currentConfig.value) return null;
  const check = willExceedContext(pendingPosts.value, currentConfig.value.model);
  const cost = estimateCost(check.estimatedTokens, 800, currentConfig.value.model);
  return {
    tokens: check.estimatedTokens,
    tokensFormatted: formatTokenCount(check.estimatedTokens),
    cost: formatCost(cost.total),
    exceeds: check.exceeds,
    chunksNeeded: check.chunksNeeded,
  };
});

const livePostCount = computed(() => {
  const topic = store.selectedTopic.value;
  if (!topic) return 0;
  if (store.activeTabDetect.value && store.activeTabUrl.value &&
      isSameTopicUrl(store.activeTabUrl.value, topic.url)) {
    return store.activeTabDetect.value.postCount;
  }
  return topic.totalPosts;
});

watch(livePostCount, (newCount) => {
  if (cachedTopic.value && newCount > 0) {
    cacheFreshness.value = evaluateFreshness(cachedTopic.value, newCount);
  }
});

function onRuntimeMessage(message: Message) {
  if (message.type === 'SCRAPE_PROGRESS' && isScraping.value) {
    const { currentPage, totalPages, postsScraped } = message.payload as PageProgress;
    loadingText.value = `Đang đọc trang ${currentPage}/${totalPages} (${postsScraped} bài)...`;
  }
}

const loadedTopicUrl = ref<string | null>(null);

async function loadTopicData() {
  const topic = store.selectedTopic.value;
  if (!topic) return;

  // === RESET all view state for new topic ===
  summary.value = '';
  error.value = '';
  loadingText.value = '';
  summarizedPostCount.value = 0;
  isScraping.value = false;
  scrapingWarnings.value = [];
  pendingPosts.value = null;
  pendingIncremental.value = false;
  cachedTopic.value = null;
  cacheFreshness.value = null;
  // === END RESET ===

  loadedTopicUrl.value = topic.url;
  cachedTopic.value = topic as CachedTopic;
  if (topic.summary) {
    summary.value = topic.summary;
    summarizedPostCount.value = topic.totalPosts;
  }
  try {
    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (fresh) {
      cachedTopic.value = fresh;
      if (fresh.summary) {
        summary.value = fresh.summary;
        summarizedPostCount.value = fresh.totalPosts;
      }
      cacheFreshness.value = evaluateFreshness(fresh, livePostCount.value);
    }
  } catch { /* cache miss is fine */ }
}

onMounted(() => {
  sendMessage<LLMConfig>('GET_SETTINGS').then((cfg) => { currentConfig.value = cfg; }).catch(() => {});
});

// With <keep-alive>: onActivated fires on initial mount AND each re-activation.
// Listener is managed here (not onMounted) to avoid duplicate registration.
onActivated(async () => {
  browser.runtime?.onMessage.addListener(onRuntimeMessage);
  const url = store.selectedTopic.value?.url;
  if (!url) return;

  // If summarization is in progress for THIS topic (the one already loaded in view),
  // preserve all view state — don't reset, just sync the URL tracker.
  // Guard: url === loadedTopicUrl ensures we only skip reset when RETURNING to the same
  // topic, not when navigating FROM another topic TO the summarizing topic.
  const isSummarizingCurrentTopic =
    store.summarizingUrl.value !== null &&
    url === loadedTopicUrl.value &&
    (store.summarizingUrl.value === url || store.summarizingUrl.value === loadedTopicUrl.value);

  if (isSummarizingCurrentTopic) {
    loadedTopicUrl.value = url;
    return;
  }

  if (url !== loadedTopicUrl.value) await loadTopicData();
});

onDeactivated(() => {
  browser.runtime?.onMessage.removeListener(onRuntimeMessage);
});

onUnmounted(() => {
  browser.runtime?.onMessage.removeListener(onRuntimeMessage);
});

function isSameTopicUrl(url1: string, url2: string): boolean {
  try {
    const normalize = (u: string) => {
      const parsed = new URL(u);
      parsed.pathname = parsed.pathname.replace(/\/page-\d+$/, '');
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    };
    return normalize(url1) === normalize(url2);
  } catch { return url1 === url2; }
}

function evaluateFreshness(cached: CachedTopic, currentPostCount: number): CacheFreshness {
  const ageMs = Date.now() - cached.cachedAt;
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;

  if (ageMs > oneWeek) return 'outdated';
  if (ageMs > oneDay || currentPostCount > cached.totalPosts) return 'stale';
  return 'fresh';
}

async function handleCancel() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await browser.tabs.sendMessage(tab.id, { type: 'CANCEL_SCRAPE' }).catch(() => {});
  }
  isScraping.value = false;
  loadingText.value = '';
}

async function handleSummarize(incremental = false) {
  if (!topicInfo.value) return;
  const topic = store.selectedTopic.value!;
  error.value = '';
  scrapingWarnings.value = [];
  if (!incremental) summary.value = '';
  pendingPosts.value = null;

  try {
    // If topic already has cached posts and this is a fresh summarize, use them directly
    if (topic.posts?.length > 0 && !incremental) {
      pendingPosts.value = [...topic.posts];
      pendingIncremental.value = false;
      return;
    }

    // Need to scrape — check if active tab matches topic URL
    const isActiveTab = store.activeTabUrl.value && isSameTopicUrl(store.activeTabUrl.value, topic.url);

    if (!isActiveTab) {
      error.value = incremental
        ? 'Hãy mở topic này trên trình duyệt để tải bài viết mới.'
        : 'Hãy mở topic này trên trình duyệt để đọc bài viết.';
      return;
    }

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Không tìm thấy tab');

    const pageCount = store.activeTabDetect.value?.pageCount ?? 1;
    let posts: ScrapedPost[];

    if (pageCount > 1) {
      isScraping.value = true;
      loadingText.value = `Đang đọc trang 1/${pageCount}...`;
      const result = await browser.tabs.sendMessage(tab.id, {
        type: 'SCRAPE_ALL_PAGES',
        payload: { totalPages: pageCount },
      }) as MultiPageResult & { error?: string };

      isScraping.value = false;
      if (result.error) throw new Error(result.error);
      if (!result.posts?.length) throw new Error('Không tìm thấy bài viết nào.');

      posts = result.posts;
      if (result.errors.length > 0) scrapingWarnings.value = result.errors;
    } else {
      loadingText.value = 'Đang đọc bài viết...';
      const scraped = await browser.tabs.sendMessage(tab.id, {
        type: 'SCRAPE_TOPIC',
      }) as { posts?: ScrapedPost[]; error?: string };

      if (scraped.error) throw new Error(scraped.error);
      if (!scraped.posts?.length) throw new Error('Không tìm thấy bài viết nào.');
      posts = scraped.posts;
    }

    loadingText.value = '';
    pendingPosts.value = posts;
    pendingIncremental.value = incremental;
  } catch (err) {
    isScraping.value = false;
    error.value = err instanceof Error ? err.message : String(err);
    loadingText.value = '';
  }
}

async function confirmSummarize() {
  const posts = pendingPosts.value;
  const incremental = pendingIncremental.value;
  const topic = store.selectedTopic.value;
  if (!posts || !topicInfo.value || !topic) return;

  pendingPosts.value = null;
  summarizedPostCount.value = posts.length;

  // Mark as summarizing
  store.setSummarizing(topic.url);

  try {
    if (incremental && cachedTopic.value?.summary) {
      loadingText.value = `Đang cập nhật tóm tắt với bài viết mới...`;
      const newPosts = posts.filter(
        (p) => p.postNumber > (cachedTopic.value?.lastPostNumber ?? 0),
      );
      if (newPosts.length === 0) {
        summary.value = cachedTopic.value.summary;
        loadingText.value = '';
        store.setSummarizing(null);
        return;
      }
      const result = await sendMessage<{ summary?: string; error?: string }>(
        'SUMMARIZE_INCREMENTAL',
        { previousSummary: cachedTopic.value.summary, newPosts },
      );
      if (result.error) throw new Error(result.error);
      summary.value = result.summary || 'Không có kết quả.';
    } else {
      loadingText.value = `Đang tóm tắt ${posts.length} bài viết...`;
      const result = await sendMessage<{ summary?: string; error?: string }>(
        'SUMMARIZE',
        posts,
      );
      if (result.error) throw new Error(result.error);
      summary.value = result.summary || 'Không có kết quả.';
    }

    // Save to cache with explicit URL
    const lastPost = posts[posts.length - 1];
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: topic.url,
      title: topicInfo.value.title,
      version: topicInfo.value.version,
      posts,
      summary: summary.value,
      lastPostNumber: lastPost?.postNumber ?? 0,
      totalPosts: posts.length,
      totalPages: topicInfo.value.pageCount,
    });

    // Update store
    store.updateSelectedTopic({ summary: summary.value, posts, totalPosts: posts.length, totalPages: topicInfo.value.pageCount });

    // Clear summarizing state
    store.setSummarizing(null);

    // Reload from background to get the authoritative stored record
    const saved = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (saved) {
      cachedTopic.value = saved;
    }
    cacheFreshness.value = 'fresh';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    store.setSummarizing(null);
  } finally {
    loadingText.value = '';
  }
}

function cancelPendingSummarize() {
  pendingPosts.value = null;
  pendingIncremental.value = false;
}

async function navigateToTopic() {
  const url = store.selectedTopic.value?.url;
  if (!url) return;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.update(tab.id, { url });
    }
  } catch {
    await browser.tabs.create({ url });
  }
}
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- No topic selected -->
    <div v-if="!topicInfo" class="text-center py-8">
      <p class="text-sm text-(--color-text-secondary)">Chưa chọn chủ đề.</p>
      <button
        class="mt-3 text-sm text-blue-600 hover:text-blue-700"
        @click="router.push('/')"
      >
        ← Quay lại danh sách
      </button>
    </div>

    <!-- Topic loaded -->
    <template v-else>
      <!-- Back button + Refresh -->
      <div class="flex items-center justify-between">
        <button
          class="text-xs text-blue-600 hover:text-blue-700"
          @click="router.push('/')"
        >
          ← Quay lại danh sách
        </button>
      </div>

      <TopicMeta :info="topicInfo" :url="store.selectedTopic.value?.url" />

      <button
        v-if="!loadingText && !summary && !pendingPosts"
        class="w-full btn btn-primary"
        @click="handleSummarize(false)"
      >
        Tóm tắt
      </button>

      <!-- Loading + Cancel -->
      <div v-if="loadingText" class="space-y-2">
        <LoadingSpinner :text="loadingText" />
        <button
          v-if="isScraping"
          class="w-full btn btn-sm btn-secondary"
          @click="handleCancel"
        >
          Huỷ
        </button>
      </div>

      <!-- Token estimation confirmation -->
      <div
        v-if="pendingPosts && tokenEstimation"
        class="alert alert-info space-y-3"
      >
        <p class="text-sm font-medium">Xác nhận trước khi gọi API</p>
        <div class="text-xs space-y-1">
          <p>Ước tính: <strong>{{ tokenEstimation.tokensFormatted }}</strong> (~{{ tokenEstimation.cost }})</p>
          <p v-if="tokenEstimation.exceeds" class="text-orange-700">
            Topic dài, sẽ tự động chia thành <strong>{{ tokenEstimation.chunksNeeded }} phần</strong> để tóm tắt.
          </p>
        </div>
        <div class="flex gap-2">
          <button
            class="flex-1 btn btn-sm btn-primary"
            @click="confirmSummarize"
          >
            Xác nhận tóm tắt
          </button>
          <button
            class="flex-1 btn btn-sm btn-secondary"
            @click="cancelPendingSummarize"
          >
            Huỷ
          </button>
        </div>
      </div>

      <!-- Error -->
      <ErrorDisplay
        v-if="error"
        :message="error"
        action="retry"
        @retry="handleSummarize(false)"
      />

      <!-- Page scraping warnings -->
      <div
        v-if="scrapingWarnings.length > 0"
        class="alert alert-warning text-xs space-y-1"
      >
        <p class="font-medium">Một số trang bị bỏ qua:</p>
        <ul class="list-disc list-inside space-y-0.5">
          <li v-for="(w, i) in scrapingWarnings" :key="i">{{ w }}</li>
        </ul>
        <button
          class="underline mt-1 opacity-80 hover:opacity-100"
          @click="scrapingWarnings = []"
        >
          Ẩn
        </button>
      </div>

      <!-- Summary result -->
      <div v-if="summary" class="space-y-3">
        <div class="flex items-center justify-between">
          <div
            v-if="summarizedPostCount > 0"
            class="flex items-center gap-1.5 text-xs text-(--color-text-secondary)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Đã tóm tắt {{ summarizedPostCount }} bài viết</span>
          </div>
          <CacheIndicator
            v-if="cacheFreshness && cachedTopic"
            :freshness="cacheFreshness"
            :cached-at="cachedTopic.cachedAt"
            :cached-posts="cachedTopic.totalPosts"
            :current-posts="livePostCount"
            @update="handleSummarize(true)"
          />
        </div>
        <div class="card p-4">
          <SummaryContent :content="summary" />
        </div>
        <button
          class="w-full btn btn-secondary"
          @click="handleSummarize(false)"
        >
          Tóm tắt lại
        </button>
      </div>
    </template>
  </div>
</template>
