<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { sendMessage } from '@/lib/messaging';
import type { DetectResult, ScrapedPost, CachedTopic, CacheFreshness } from '@/lib/types';
import type { MultiPageResult } from '@/lib/scrapers/page-loader';
import TopicMeta from '../components/TopicMeta.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import SummaryContent from '../components/SummaryContent.vue';
import CacheIndicator from '../components/CacheIndicator.vue';

const topicInfo = ref<DetectResult | null>(null);
const summary = ref('');
const error = ref('');
const loadingText = ref('');
const isDetecting = ref(true);
const summarizedPostCount = ref(0);

// Cache state
const cachedTopic = ref<CachedTopic | null>(null);
const cacheFreshness = ref<CacheFreshness | null>(null);

let currentTabId: number | undefined;

function onTabActivated(activeInfo: { tabId: number }) {
  if (activeInfo.tabId === currentTabId) return;
  currentTabId = activeInfo.tabId;
  resetState();
  detectTopic();
}

function resetState() {
  summary.value = '';
  summarizedPostCount.value = 0;
  cachedTopic.value = null;
  cacheFreshness.value = null;
  error.value = '';
}

onMounted(async () => {
  browser.tabs.onActivated.addListener(onTabActivated);
  await detectTopic();
});

onUnmounted(() => {
  browser.tabs.onActivated.removeListener(onTabActivated);
});

async function detectTopic() {
  isDetecting.value = true;
  error.value = '';
  topicInfo.value = null;

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      error.value = 'Không tìm thấy tab đang mở.';
      return;
    }
    currentTabId = tab.id;
    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'DETECT_XF',
    }) as DetectResult | undefined;

    if (!result || result.version === 'unknown') {
      error.value = 'Trang này không phải forum XenForo.';
      return;
    }
    topicInfo.value = result;

    // Check cache
    await checkCache();
  } catch (e) {
    console.error('Error detecting topic:', e);
    error.value = 'Không thể kết nối với trang. Hãy thử tải lại trang.';
  } finally {
    isDetecting.value = false;
  }
}

async function checkCache() {
  if (!topicInfo.value) return;
  try {
    const cached = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC');
    if (cached?.summary) {
      cachedTopic.value = cached;
      summary.value = cached.summary;
      summarizedPostCount.value = cached.totalPosts;
      cacheFreshness.value = evaluateFreshness(cached, topicInfo.value.postCount);
    }
  } catch {
    // No cache available, that's fine
  }
}

function evaluateFreshness(cached: CachedTopic, currentPostCount: number): CacheFreshness {
  const ageMs = Date.now() - cached.cachedAt;
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;

  if (ageMs > oneWeek) return 'outdated';
  if (ageMs > oneDay || currentPostCount > cached.totalPosts) return 'stale';
  return 'fresh';
}

async function handleSummarize(incremental = false) {
  if (!topicInfo.value) return;
  error.value = '';
  if (!incremental) summary.value = '';

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Không tìm thấy tab');

    let posts: ScrapedPost[];

    if (topicInfo.value.pageCount > 1) {
      // Multi-page scraping
      loadingText.value = `Đang đọc ${topicInfo.value.pageCount} trang...`;
      const result = await browser.tabs.sendMessage(tab.id, {
        type: 'SCRAPE_ALL_PAGES',
        payload: { totalPages: topicInfo.value.pageCount },
      }) as MultiPageResult & { error?: string };

      if (result.error) throw new Error(result.error);
      if (!result.posts?.length) throw new Error('Không tìm thấy bài viết nào.');

      posts = result.posts;
      if (result.errors.length > 0) {
        console.warn('Page scraping warnings:', result.errors);
      }
    } else {
      // Single page scraping
      loadingText.value = 'Đang đọc bài viết...';
      const scraped = await browser.tabs.sendMessage(tab.id, {
        type: 'SCRAPE_TOPIC',
      }) as { posts?: ScrapedPost[]; error?: string };

      if (scraped.error) throw new Error(scraped.error);
      if (!scraped.posts?.length) throw new Error('Không tìm thấy bài viết nào.');
      posts = scraped.posts;
    }

    summarizedPostCount.value = posts.length;

    // Summarize
    if (incremental && cachedTopic.value?.summary) {
      loadingText.value = `Đang cập nhật tóm tắt với bài viết mới...`;
      const newPosts = posts.filter(
        (p) => p.postNumber > (cachedTopic.value?.lastPostNumber ?? 0),
      );
      if (newPosts.length === 0) {
        summary.value = cachedTopic.value.summary;
        loadingText.value = '';
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

    // Save to cache
    const lastPost = posts[posts.length - 1];
    await sendMessage('SAVE_CACHED_TOPIC', {
      title: topicInfo.value.title,
      posts,
      summary: summary.value,
      lastPostNumber: lastPost?.postNumber ?? 0,
      totalPosts: posts.length,
    } satisfies Partial<CachedTopic>);
    cachedTopic.value = null;
    cacheFreshness.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingText.value = '';
  }
}
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- Detecting -->
    <LoadingSpinner v-if="isDetecting" text="Đang kiểm tra trang..." />

    <!-- Not XenForo -->
    <div v-else-if="error && !topicInfo" class="text-center py-8">
      <p class="text-sm text-gray-500">{{ error }}</p>
      <button
        class="mt-3 text-sm text-blue-600 hover:text-blue-700"
        @click="detectTopic"
      >
        Thử lại
      </button>
    </div>

    <!-- Topic detected -->
    <template v-else-if="topicInfo">
      <TopicMeta :info="topicInfo" />

      <!-- Summarize button -->
      <button
        v-if="!loadingText && !summary"
        class="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        @click="handleSummarize(false)"
      >
        Tóm tắt
      </button>

      <!-- Loading -->
      <LoadingSpinner v-if="loadingText" :text="loadingText" />

      <!-- Error -->
      <div
        v-if="error"
        class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700"
      >
        {{ error }}
        <button
          class="block mt-2 text-red-600 hover:text-red-700 font-medium"
          @click="handleSummarize(false)"
        >
          Thử lại
        </button>
      </div>

      <!-- Summary result -->
      <div v-if="summary" class="space-y-3">
        <div class="flex items-center justify-between">
          <div
            v-if="summarizedPostCount > 0"
            class="flex items-center gap-1.5 text-xs text-gray-500"
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
            :current-posts="topicInfo?.postCount ?? 0"
            @update="handleSummarize(true)"
          />
        </div>
        <div class="bg-white rounded-lg border border-gray-200 p-4">
          <SummaryContent :content="summary" />
        </div>
        <button
          class="w-full py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          @click="handleSummarize(false)"
        >
          Tóm tắt lại
        </button>
      </div>
    </template>
  </div>
</template>
