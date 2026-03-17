<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { sendMessage } from '@/lib/messaging';
import { willExceedContext, estimateCost, formatTokenCount, formatCost } from '@/lib/token-estimator';
import type { DetectResult, ScrapedPost, CachedTopic, CacheFreshness, LLMConfig, Message, PageProgress } from '@/lib/types';
import type { MultiPageResult } from '@/lib/scrapers/page-loader';
import TopicMeta from '../components/TopicMeta.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import SummaryContent from '../components/SummaryContent.vue';
import CacheIndicator from '../components/CacheIndicator.vue';
import ExportButton from '../components/ExportButton.vue';
import ErrorDisplay from '../components/ErrorDisplay.vue';

const topicInfo = ref<DetectResult | null>(null);
const summary = ref('');
const error = ref('');
const loadingText = ref('');
const isDetecting = ref(true);
const summarizedPostCount = ref(0);
const isScraping = ref(false);
const scrapingWarnings = ref<string[]>([]);

// Token estimation state (Phase 3)
const pendingPosts = ref<ScrapedPost[] | null>(null);
const pendingIncremental = ref(false);
const currentConfig = ref<LLMConfig | null>(null);

// Cache state
const cachedTopic = ref<CachedTopic | null>(null);
const cacheFreshness = ref<CacheFreshness | null>(null);

let currentTabId: number | undefined;

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

function onRuntimeMessage(message: Message) {
  if (message.type === 'SCRAPE_PROGRESS') {
    const { currentPage, totalPages, postsScraped } = message.payload as PageProgress;
    loadingText.value = `Đang đọc trang ${currentPage}/${totalPages} (${postsScraped} bài)...`;
  }
}

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
  scrapingWarnings.value = [];
  pendingPosts.value = null;
}

onMounted(async () => {
  browser.tabs.onActivated.addListener(onTabActivated);
  browser.runtime.onMessage.addListener(onRuntimeMessage);
  // Load config for token estimation
  sendMessage<LLMConfig>('GET_SETTINGS').then((cfg) => { currentConfig.value = cfg; }).catch(() => {});
  await detectTopic();
});

onUnmounted(() => {
  browser.tabs.onActivated.removeListener(onTabActivated);
  browser.runtime.onMessage.removeListener(onRuntimeMessage); // Fix 1
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

// Fix 2: cancel multi-page scraping
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
  error.value = '';
  scrapingWarnings.value = [];
  if (!incremental) summary.value = '';
  pendingPosts.value = null;

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Không tìm thấy tab');

    let posts: ScrapedPost[];

    if (topicInfo.value.pageCount > 1) {
      isScraping.value = true;
      loadingText.value = `Đang đọc trang 1/${topicInfo.value.pageCount}...`;
      const result = await browser.tabs.sendMessage(tab.id, {
        type: 'SCRAPE_ALL_PAGES',
        payload: { totalPages: topicInfo.value.pageCount },
      }) as MultiPageResult & { error?: string };

      isScraping.value = false;
      if (result.error) throw new Error(result.error);
      if (!result.posts?.length) throw new Error('Không tìm thấy bài viết nào.');

      posts = result.posts;

      if (result.errors.length > 0) {
        scrapingWarnings.value = result.errors;
      }
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
    // Phase 3: show token estimation, wait for confirm
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
  if (!posts || !topicInfo.value) return;

  pendingPosts.value = null;
  summarizedPostCount.value = posts.length;

  try {
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
      version: topicInfo.value.version,
      posts,
      summary: summary.value,
      lastPostNumber: lastPost?.postNumber ?? 0,
      totalPosts: posts.length,
    } satisfies Partial<CachedTopic>);

    // Reload from background to get the authoritative stored record
    const saved = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC');
    if (saved) {
      cachedTopic.value = saved;
    }
    cacheFreshness.value = 'fresh';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingText.value = '';
  }
}

function cancelPendingSummarize() {
  pendingPosts.value = null;
  pendingIncremental.value = false;
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
        v-if="!loadingText && !summary && !pendingPosts"
        class="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        @click="handleSummarize(false)"
      >
        Tóm tắt
      </button>

      <!-- Loading + Cancel -->
      <div v-if="loadingText" class="space-y-2">
        <LoadingSpinner :text="loadingText" />
        <!-- Fix 2: Cancel button for multi-page -->
        <button
          v-if="isScraping"
          class="w-full py-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          @click="handleCancel"
        >
          Huỷ
        </button>
      </div>

      <!-- Phase 3: Token estimation confirmation -->
      <div
        v-if="pendingPosts && tokenEstimation"
        class="border border-blue-200 bg-blue-50 rounded-lg p-3 space-y-3"
      >
        <p class="text-sm font-medium text-blue-900">Xác nhận trước khi gọi API</p>
        <div class="text-xs text-blue-800 space-y-1">
          <p>Ước tính: <strong>{{ tokenEstimation.tokensFormatted }}</strong> (~{{ tokenEstimation.cost }})</p>
          <p v-if="tokenEstimation.exceeds" class="text-orange-700">
            Topic dài, sẽ tự động chia thành <strong>{{ tokenEstimation.chunksNeeded }} phần</strong> để tóm tắt.
          </p>
        </div>
        <div class="flex gap-2">
          <button
            class="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
            @click="confirmSummarize"
          >
            Xác nhận tóm tắt
          </button>
          <button
            class="flex-1 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs hover:bg-gray-50 transition-colors"
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

      <!-- Fix 3: Page scraping warnings -->
      <div
        v-if="scrapingWarnings.length > 0"
        class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800 space-y-1"
      >
        <p class="font-medium">Một số trang bị bỏ qua:</p>
        <ul class="list-disc list-inside space-y-0.5">
          <li v-for="(w, i) in scrapingWarnings" :key="i">{{ w }}</li>
        </ul>
        <button
          class="text-yellow-700 underline mt-1"
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
            class="flex items-center gap-1.5 text-xs text-gray-500"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Đã tóm tắt {{ summarizedPostCount }} bài viết</span>
          </div>
          <!-- Fix 6: CacheIndicator now persists after summarize with 'fresh' state -->
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
        <div class="flex gap-2">
          <button
            class="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            @click="handleSummarize(false)"
          >
            Tóm tắt lại
          </button>
          <ExportButton v-if="cachedTopic" :topic="cachedTopic" />
        </div>
      </div>
    </template>
  </div>
</template>
