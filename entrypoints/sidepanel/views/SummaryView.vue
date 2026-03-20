<script setup lang="ts">
import { ref, onMounted, onUnmounted, onActivated, onDeactivated, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage } from '@/lib/messaging';
import { willExceedContext, estimateCost, formatTokenCount, formatCost } from '@/lib/token-estimator';
import { isSameTopicUrl } from '@/lib/cache-manager';
import { detectNewsThread } from '@/lib/scrapers/news-detector';
import type { ArticleContent } from '@/lib/scrapers/article-extractor';
import type { DetectResult, ScrapedPost, CachedTopic, CacheFreshness, LLMConfig, Message, PageProgress, TopicSegment } from '@/lib/types';
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
const summarizedPostCount = computed(() => {
  if (!cachedTopic.value) return 0;
  return cachedTopic.value.summarizedPostCount ?? cachedTopic.value.totalPosts ?? 0;
});
const isScraping = ref(false);
const scrapingWarnings = ref<string[]>([]);
const scrapingInfo = ref<string[]>([]); // informational messages (not warnings)

// Token estimation state
const pendingPosts = ref<ScrapedPost[] | null>(null);
const pendingIncremental = ref(false);
const currentConfig = ref<LLMConfig | null>(null);

// Cache state
const cachedTopic = ref<CachedTopic | null>(null);
const cacheFreshness = ref<CacheFreshness | null>(null);

// Segment mode state
const segmentSize = ref(20);
const SCRAPE_CHUNK_SIZE = 10; // pages per message — keeps channel alive
const segmentSummaries = ref<TopicSegment[]>([]);
const activeSegmentIndex = ref<number | null>(null);
const currentScrapeTabId = ref<number | null>(null); // tracks which tab is currently scraping
let activeSummarizeId = 0; // incremented on each new summarize or topic load; guards stale async callbacks

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

const hasLivePostCount = computed(() =>
  !!(store.activeTabDetect.value && store.activeTabUrl.value &&
    store.selectedTopic.value &&
    isSameTopicUrl(store.activeTabUrl.value, store.selectedTopic.value.url)),
);

watch(livePostCount, (newCount) => {
  if (cachedTopic.value && hasLivePostCount.value) {
    cacheFreshness.value = evaluateFreshness(cachedTopic.value, newCount);
  }
});

const isSegmentMode = computed(() =>
  (topicInfo.value?.pageCount ?? 0) > segmentSize.value,
);

const segments = computed(() => {
  if (!isSegmentMode.value || !topicInfo.value) return [];
  const total = topicInfo.value.pageCount;
  const size = segmentSize.value;
  const segs: { start: number; end: number; label: string }[] = [];
  for (let start = 1; start <= total; start += size) {
    const end = Math.min(start + size - 1, total);
    segs.push({ start, end, label: `Trang ${start}–${end}` });
  }
  return segs;
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
  activeSummarizeId++; // invalidate any in-flight LLM callbacks
  summary.value = '';
  error.value = '';
  loadingText.value = '';
  isScraping.value = false;
  scrapingWarnings.value = [];
  scrapingInfo.value = [];
  pendingPosts.value = null;
  pendingIncremental.value = false;
  cachedTopic.value = null;
  cacheFreshness.value = null;
  segmentSummaries.value = [];
  activeSegmentIndex.value = null;
  // === END RESET ===

  loadedTopicUrl.value = topic.url;
  cachedTopic.value = topic as CachedTopic;
  if (topic.summary) {
    summary.value = topic.summary;
  }
  try {
    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (fresh) {
      cachedTopic.value = fresh;
      if (fresh.summary) {
        summary.value = fresh.summary;
      }
      if (fresh.segments) {
        segmentSummaries.value = fresh.segments;
      }
      const liveCount = (store.activeTabDetect.value && store.activeTabUrl.value &&
        isSameTopicUrl(store.activeTabUrl.value, fresh.url))
        ? store.activeTabDetect.value.postCount
        : null;
      cacheFreshness.value = evaluateFreshness(fresh, liveCount);
    }
  } catch { /* cache miss is fine */ }
}

onMounted(() => {
  sendMessage<LLMConfig>('GET_SETTINGS').then((cfg) => {
    currentConfig.value = cfg;
    if (cfg?.segmentSize) segmentSize.value = cfg.segmentSize;
  }).catch(() => {});
});

// With <keep-alive>: onActivated fires on initial mount AND each re-activation.
onActivated(async () => {
  browser.runtime?.onMessage.addListener(onRuntimeMessage);

  // Reload settings in case user changed them in SettingsView
  sendMessage<LLMConfig>('GET_SETTINGS').then((cfg) => {
    if (cfg) {
      currentConfig.value = cfg;
      if (cfg.segmentSize) segmentSize.value = cfg.segmentSize;
    }
  }).catch(() => {});

  const url = store.selectedTopic.value?.url;
  if (!url) return;

  // Check if the currently selected topic is being summarized by the LLM.
  const isSummarizingThisTopic =
    store.summarizingUrl.value !== null &&
    isSameTopicUrl(store.summarizingUrl.value, url);

  if (isSummarizingThisTopic) {
    if (!isSameTopicUrl(url, loadedTopicUrl.value ?? '')) {
      // We viewed a different topic in between — reload cached data for this topic
      // but re-apply the loading indicator since LLM is still running.
      await loadTopicData();
      loadingText.value = 'Đang tóm tắt...';
    }
    loadedTopicUrl.value = url;
    return;
  }

  if (!isSameTopicUrl(url, loadedTopicUrl.value ?? '')) await loadTopicData();
});

onDeactivated(() => {
  browser.runtime?.onMessage.removeListener(onRuntimeMessage);
});

onUnmounted(() => {
  browser.runtime?.onMessage.removeListener(onRuntimeMessage);
});

function evaluateFreshness(cached: CachedTopic, currentPostCount: number | null): CacheFreshness {
  const ageMs = Date.now() - cached.cachedAt;
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;

  if (ageMs > oneWeek) return 'outdated';
  if (ageMs > oneDay || (currentPostCount !== null && currentPostCount > cached.totalPosts)) return 'stale';
  return 'fresh';
}

async function handleCancel() {
  const tabId = currentScrapeTabId.value;
  if (tabId) {
    await browser.tabs.sendMessage(tabId, { type: 'CANCEL_SCRAPE' }).catch(() => {});
    currentScrapeTabId.value = null;
  }
  isScraping.value = false;
  loadingText.value = '';
}

/**
 * Tìm tab đang mở trên cùng domain với topicUrl.
 * Ưu tiên: (1) active tab nếu cùng domain, (2) bất kỳ tab cùng domain.
 */
async function findForumTab(topicUrl: string): Promise<number | null> {
  const domain = new URL(topicUrl).hostname;

  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id && activeTab.url) {
    try {
      if (new URL(activeTab.url).hostname === domain) return activeTab.id;
    } catch { /* invalid URL */ }
  }

  const allTabs = await browser.tabs.query({ currentWindow: true });
  for (const tab of allTabs) {
    if (tab.id && tab.url) {
      try {
        if (new URL(tab.url).hostname === domain) return tab.id;
      } catch { /* skip */ }
    }
  }
  return null;
}

/**
 * Scrape pages in small chunks (SCRAPE_CHUNK_SIZE pages per message).
 * Avoids "message channel closed" error that occurs when a single scrape
 * message takes too long (100+ pages can exceed Chrome's channel timeout).
 */
async function scrapeInChunks(
  tabId: number,
  baseUrl: string,
  startPage: number,
  endPage: number,
  delayMs: number = 2000,
): Promise<{ posts: ScrapedPost[]; errors: string[] }> {
  const allPosts: ScrapedPost[] = [];
  const allErrors: string[] = [];

  for (let chunkStart = startPage; chunkStart <= endPage; chunkStart += SCRAPE_CHUNK_SIZE) {
    if (!isScraping.value) break; // cancelled

    const chunkEnd = Math.min(chunkStart + SCRAPE_CHUNK_SIZE - 1, endPage);
    loadingText.value = `Đang đọc trang ${chunkStart}–${chunkEnd}/${endPage}...`;

    const result = await browser.tabs.sendMessage(tabId, {
      type: 'SCRAPE_PAGE_RANGE',
      payload: { startPage: chunkStart, endPage: chunkEnd, delayMs, baseUrl },
    }) as MultiPageResult & { error?: string };

    if (result.error) throw new Error(result.error);
    allPosts.push(...result.posts);
    if (result.errors?.length > 0) allErrors.push(...result.errors);
  }

  // Deduplicate + sort
  const seen = new Set<number>();
  const posts = allPosts
    .filter(p => {
      if (p.postNumber === 0) return true;
      if (seen.has(p.postNumber)) return false;
      seen.add(p.postNumber);
      return true;
    })
    .sort((a, b) => a.postNumber - b.postNumber);

  return { posts, errors: allErrors };
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

    // Need to scrape — find a tab on the same forum domain
    const tabId = await findForumTab(topic.url);
    if (!tabId) {
      error.value = 'Không tìm thấy tab nào đang mở diễn đàn này. Hãy mở ít nhất một trang của diễn đàn.';
      return;
    }

    const detectMatchesTopic = store.activeTabUrl.value
      && isSameTopicUrl(store.activeTabUrl.value, topic.url);
    const pageCount = (detectMatchesTopic ? store.activeTabDetect.value?.pageCount : null)
      ?? topic.totalPages ?? 1;
    let posts: ScrapedPost[];

    if (pageCount > 1) {
      isScraping.value = true;
      currentScrapeTabId.value = tabId;

      if (incremental && cachedTopic.value) {
        // INCREMENTAL: only scrape from last known page onward
        const cachedPages = cachedTopic.value.totalPages || 1;
        const startPage = Math.max(1, cachedPages + 1); // +1: page cachedPages already scraped
        const endPage = pageCount;

        const { posts: newPosts, errors } = await scrapeInChunks(tabId, topic.url, startPage, endPage, currentConfig.value?.scrapeDelayMs ?? 2000);
        isScraping.value = false;
        currentScrapeTabId.value = null;

        // Merge with existing cached posts, deduplicate
        const cachedPosts = cachedTopic.value.posts || [];
        const merged = [...cachedPosts, ...newPosts];
        const seen = new Set<number>();
        posts = merged.filter(p => {
          if (p.postNumber === 0) return true;
          if (seen.has(p.postNumber)) return false;
          seen.add(p.postNumber);
          return true;
        }).sort((a, b) => a.postNumber - b.postNumber);

        if (errors.length > 0) scrapingWarnings.value = errors;
      } else {
        // FULL SCRAPE via chunks
        const { posts: scraped, errors } = await scrapeInChunks(tabId, topic.url, 1, pageCount, currentConfig.value?.scrapeDelayMs ?? 2000);
        isScraping.value = false;
        currentScrapeTabId.value = null;
        if (!scraped.length) throw new Error('Không tìm thấy bài viết nào.');
        posts = scraped;
        if (errors.length > 0) scrapingWarnings.value = errors;
      }
    } else {
      loadingText.value = 'Đang đọc bài viết...';
      isScraping.value = true;
      currentScrapeTabId.value = tabId;
      const { posts: scraped, errors } = await scrapeInChunks(tabId, topic.url, 1, 1, 0);
      isScraping.value = false;
      currentScrapeTabId.value = null;
      if (!scraped.length) throw new Error('Không tìm thấy bài viết nào.');
      posts = scraped;
      if (errors.length > 0) scrapingWarnings.value = errors;
    }

    // --- NEWS DETECTION (skip if article posts already present in cache) ---
    const hasArticlePosts = posts.some(p => p.postNumber < 0);
    if (!hasArticlePosts) {
      try {
        const forumDomain = new URL(topic.url).hostname;
        const newsCheck = detectNewsThread(posts, forumDomain);

        if (newsCheck.isNews && newsCheck.articleUrls.length > 0) {
          loadingText.value = 'Phát hiện chủ đề tin tức — đang tải bài báo gốc...';

          const articlePromises = newsCheck.articleUrls.map(url =>
            sendMessage<ArticleContent | null>('SCRAPE_ARTICLE', { url }).catch(() => null),
          );
          const articles = (await Promise.all(articlePromises)).filter(Boolean) as ArticleContent[];

          if (articles.length > 0) {
            const articlePosts: ScrapedPost[] = articles.map((a, i) => ({
              author: `[BÀI BÁO GỐC — ${a.source}]`,
              content: `Tiêu đề: ${a.title}\n\nNội dung:\n${a.content}`,
              timestamp: '',
              postNumber: -(i + 1),
            }));
            posts = [...articlePosts, ...posts];
            scrapingInfo.value.push(
              `Đã tải ${articles.length} bài báo gốc: ${articles.map(a => a.source).join(', ')}`,
            );
          }
        }
      } catch { /* news detection is best-effort */ }
    }
    // --- END NEWS DETECTION ---

    loadingText.value = '';
    pendingPosts.value = posts;
    pendingIncremental.value = incremental;
  } catch (err) {
    isScraping.value = false;
    currentScrapeTabId.value = null;
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
  const thisId = ++activeSummarizeId;
  store.setSummarizing(topic.url);

  try {
    let summaryText: string;
    if (incremental && cachedTopic.value?.summary) {
      const newPosts = posts.filter(
        (p) => p.postNumber < 0 || p.postNumber > (cachedTopic.value?.lastPostNumber ?? 0),
      );
      if (newPosts.length === 0) {
        summary.value = cachedTopic.value.summary;
        loadingText.value = '';
        store.setSummarizing(null);
        return;
      }
      loadingText.value = 'Đang cập nhật tóm tắt với bài viết mới...';
      const result = await sendMessage<{ summary?: string; error?: string }>('SUMMARIZE_INCREMENTAL', {
        previousSummary: cachedTopic.value.summary,
        newPosts,
      });
      if (result.error) throw new Error(result.error);
      summaryText = result.summary ?? '';
    } else {
      loadingText.value = `Đang tóm tắt ${posts.length} bài viết...`;
      const result = await sendMessage<{ summary?: string; error?: string }>('SUMMARIZE', posts);
      if (result.error) throw new Error(result.error);
      summaryText = result.summary ?? '';
    }

    // Stale guard: user navigated to another topic while LLM was running
    if (thisId !== activeSummarizeId) {
      const lastPost = posts[posts.length - 1];
      const realPostCount = posts.filter(p => p.postNumber > 0).length;
      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topic.title,
        version: topic.version,
        posts,
        summary: summaryText,
        lastPostNumber: lastPost?.postNumber ?? 0,
        totalPosts: realPostCount,
        summarizedPostCount: realPostCount,
        totalPages: topic.totalPages,
      }).catch(() => {});
      return;
    }

    summary.value = summaryText;

    const lastPost = posts[posts.length - 1];
    const realPostCount = posts.filter(p => p.postNumber > 0).length;
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: topic.url,
      title: topic.title,
      version: topic.version,
      posts,
      summary: summaryText,
      lastPostNumber: lastPost?.postNumber ?? 0,
      totalPosts: realPostCount,
      summarizedPostCount: realPostCount,
      totalPages: topic.totalPages,
    });
    store.updateSelectedTopic({ summary: summaryText, posts, totalPosts: realPostCount, totalPages: topic.totalPages });

    const saved = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (saved) cachedTopic.value = saved;
    cacheFreshness.value = 'fresh';
  } catch (err) {
    if (thisId !== activeSummarizeId) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    store.setSummarizing(null);
    if (thisId === activeSummarizeId) loadingText.value = '';
  }
}

function cancelPendingSummarize() {
  pendingPosts.value = null;
  pendingIncremental.value = false;
}

async function handleSummarizeSegment(segmentIndex: number) {
  const seg = segments.value[segmentIndex];
  if (!seg || !topicInfo.value) return;
  const topic = store.selectedTopic.value!;

  error.value = '';
  scrapingWarnings.value = [];
  const thisId = ++activeSummarizeId;
  store.setSummarizing(topic.url);

  try {
    const tabId = await findForumTab(topic.url);
    if (!tabId) {
      error.value = 'Không tìm thấy tab nào đang mở diễn đàn này. Hãy mở ít nhất một trang của diễn đàn.';
      store.setSummarizing(null);
      return;
    }

    isScraping.value = true;
    currentScrapeTabId.value = tabId;
    loadingText.value = `Đang đọc ${seg.label}...`;

    const { posts: segPosts, errors } = await scrapeInChunks(tabId, topic.url, seg.start, seg.end, currentConfig.value?.scrapeDelayMs ?? 2000);
    isScraping.value = false;
    currentScrapeTabId.value = null;

    if (!segPosts.length) throw new Error('Không tìm thấy bài viết nào.');
    if (errors.length > 0) scrapingWarnings.value = errors;

    loadingText.value = `Đang tóm tắt ${seg.label} (${segPosts.length} bài)...`;
    const result = await sendMessage<{ summary?: string; error?: string }>('SUMMARIZE', segPosts);
    if (result.error) throw new Error(result.error);

    const newSeg: TopicSegment = {
      startPage: seg.start,
      endPage: seg.end,
      posts: segPosts,
      summary: result.summary ?? '',
      postCount: segPosts.length,
      summarizedAt: Date.now(),
    };

    const count = Math.max(segmentSummaries.value.length, segmentIndex + 1);
    const updated = Array.from({ length: count }, (_, i) => segmentSummaries.value[i] ?? null) as TopicSegment[];
    updated[segmentIndex] = newSeg;

    // Stale guard: user navigated away while LLM was running
    if (thisId !== activeSummarizeId) {
      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        totalPosts: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
        summarizedPostCount: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
        segments: updated,
      }).catch(() => {});
      return;
    }

    segmentSummaries.value = updated;
    activeSegmentIndex.value = segmentIndex;

    const segTotalPosts = updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: topic.url,
      title: topic.title,
      version: topic.version,
      totalPages: topic.totalPages,
      totalPosts: segTotalPosts,
      summarizedPostCount: segTotalPosts,
      segments: updated,
    });
    store.updateSelectedTopic({
      title: topic.title,
      version: topic.version,
      totalPages: topic.totalPages,
      segments: updated,
    } as any);
  } catch (err) {
    if (thisId !== activeSummarizeId) return;
    error.value = err instanceof Error ? err.message : String(err);
    isScraping.value = false;
    currentScrapeTabId.value = null;
  } finally {
    store.setSummarizing(null);
    if (thisId === activeSummarizeId) loadingText.value = '';
  }
}

async function generateOverallSummary() {
  const topic = store.selectedTopic.value;
  if (!topic) return;

  const completedSegments = segmentSummaries.value.filter(s => s?.summary);
  if (completedSegments.length < 2) {
    error.value = 'Cần ít nhất 2 phần đã tóm tắt để tạo tóm tắt tổng quan.';
    return;
  }

  const thisId = ++activeSummarizeId;
  store.setSummarizing(topic.url);
  loadingText.value = 'Đang tạo tóm tắt tổng quan...';

  try {
    const segmentPosts: ScrapedPost[] = completedSegments.map((seg, i) => ({
      author: `[PHẦN ${i + 1}: Trang ${seg.startPage}–${seg.endPage}]`,
      content: seg.summary,
      timestamp: '',
      postNumber: i + 1,
    }));

    const result = await sendMessage<{ summary?: string; error?: string }>('SUMMARIZE', segmentPosts);
    if (result.error) throw new Error(result.error);

    // Stale guard: user navigated away while LLM was running
    if (thisId !== activeSummarizeId) {
      const totalSummarized = segmentSummaries.value.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        summary: result.summary,
        summarizedPostCount: totalSummarized,
      }).catch(() => {});
      return;
    }

    summary.value = result.summary ?? '';
    activeSegmentIndex.value = null;

    const totalSummarized = segmentSummaries.value.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
    await sendMessage('SAVE_CACHED_TOPIC', { url: topic.url, summary: result.summary, summarizedPostCount: totalSummarized });
    store.updateSelectedTopic({ summary: result.summary });
    const saved = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (saved) cachedTopic.value = saved;
    cacheFreshness.value = 'fresh';
  } catch (err) {
    if (thisId !== activeSummarizeId) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    store.setSummarizing(null);
    if (thisId === activeSummarizeId) loadingText.value = '';
  }
}

async function handleSegmentUpdate() {
  if (!topicInfo.value || !store.selectedTopic.value) return;

  const currentSegments = segmentSummaries.value;
  const lastSeg = currentSegments[currentSegments.length - 1];
  const coveredEndPage = lastSeg?.endPage ?? 0;
  const newTotalPages = topicInfo.value.pageCount;

  if (newTotalPages <= coveredEndPage) {
    // Không có trang mới — chỉ re-generate overall
    await generateOverallSummary();
    return;
  }

  const segmentsToProcess: number[] = [];
  const newSegments = segments.value;

  for (let i = 0; i < newSegments.length; i++) {
    const seg = newSegments[i];
    const existing = currentSegments[i];
    // Segment chưa tóm tắt, hoặc segment cuối cũ bị mở rộng
    if (!existing?.summary || existing.endPage < seg.end) {
      segmentsToProcess.push(i);
    }
  }

  if (segmentsToProcess.length === 0) {
    await generateOverallSummary();
    return;
  }

  for (const idx of segmentsToProcess) {
    await handleSummarizeSegment(idx);
    if (error.value) return; // dừng nếu có lỗi
  }

  const completedCount = segmentSummaries.value.filter(s => s?.summary).length;
  if (completedCount >= 2) {
    await generateOverallSummary();
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
        @click="$router.push('/')"
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
          @click="$router.push('/')"
        >
          ← Quay lại danh sách
        </button>
      </div>

      <TopicMeta :info="topicInfo" :url="store.selectedTopic.value?.url" />

      <button
        v-if="!loadingText && !summary && !pendingPosts && !isSegmentMode"
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

      <!-- Info messages (e.g. articles loaded) -->
      <div
        v-if="scrapingInfo.length > 0"
        class="alert alert-info text-xs"
      >
        <ul class="list-disc list-inside space-y-0.5">
          <li v-for="(m, i) in scrapingInfo" :key="i">{{ m }}</li>
        </ul>
      </div>

      <!-- SEGMENT MODE: Topic > 100 pages -->
      <template v-if="isSegmentMode && !loadingText && !pendingPosts">
        <!-- Segment info banner -->
        <div class="alert alert-info text-xs">
          <p class="font-medium">Chủ đề dài ({{ topicInfo!.pageCount }} trang)</p>
          <p class="mt-0.5">Chia thành {{ segments.length }} phần, mỗi phần ~{{ segmentSize }} trang. Tóm tắt từng phần rồi tạo tổng quan.</p>
        </div>

        <!-- Segment tabs -->
        <div class="flex flex-wrap gap-1.5">
          <button
            class="px-2.5 py-1 text-xs rounded-full transition-colors"
            :class="activeSegmentIndex === null
              ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-medium'
              : 'text-(--color-text-secondary) hover:bg-(--color-bg-muted)'"
            @click="activeSegmentIndex = null"
          >
            Tổng quan
          </button>
          <button
            v-for="(seg, i) in segments"
            :key="i"
            class="px-2.5 py-1 text-xs rounded-full transition-colors flex items-center gap-1"
            :class="activeSegmentIndex === i
              ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-medium'
              : 'text-(--color-text-secondary) hover:bg-(--color-bg-muted)'"
            @click="activeSegmentIndex = i"
          >
            {{ seg.label }}
            <span
              v-if="segmentSummaries[i]?.summary"
              class="w-1.5 h-1.5 rounded-full bg-green-500"
              title="Đã tóm tắt"
            />
          </button>
        </div>

        <!-- Overall summary view -->
        <template v-if="activeSegmentIndex === null">
          <div v-if="summary" class="space-y-3">
            <div class="flex items-center justify-start gap-2">
              <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span class="text-xs text-(--color-text-secondary)">
                Tóm tắt tổng quan {{ segments.length }} phần
              </span>
            </div>
            <CacheIndicator
              v-if="cacheFreshness && cachedTopic"
              :freshness="cacheFreshness"
              :cached-at="cachedTopic.cachedAt"
              :cached-posts="cachedTopic.totalPosts"
              :current-posts="livePostCount"
              @update="handleSegmentUpdate"
            />
            <div class="card p-4">
              <SummaryContent :content="summary" />
            </div>
            <button
              class="w-full btn btn-secondary text-sm"
              :disabled="!!loadingText"
              @click="generateOverallSummary"
            >
              Tạo lại tóm tắt tổng quan
            </button>
          </div>
          <div v-else class="text-center py-4 space-y-2">
            <p class="text-xs text-(--color-text-muted)">
              Tóm tắt từng phần trước, sau đó tạo tóm tắt tổng quan.
            </p>
            <button
              v-if="segmentSummaries.filter(s => s?.summary).length >= 2"
              class="btn btn-primary"
              :disabled="!!loadingText"
              @click="generateOverallSummary"
            >
              Tạo tóm tắt tổng quan
            </button>
            <p v-else class="text-xs text-(--color-text-muted)">(Cần ít nhất 2 phần đã tóm tắt)</p>
          </div>
        </template>

        <!-- Individual segment view -->
        <template v-if="activeSegmentIndex !== null">
          <div v-if="segmentSummaries[activeSegmentIndex]?.summary" class="space-y-3">
            <div class="flex items-center justify-start gap-2">
              <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span class="text-xs text-(--color-text-secondary)">{{ segmentSummaries[activeSegmentIndex].postCount }} bài viết</span>
            </div>
            <div class="card p-4">
              <SummaryContent :content="segmentSummaries[activeSegmentIndex].summary" />
            </div>
            <button
              class="w-full btn btn-secondary text-xs"
              :disabled="!!loadingText"
              @click="handleSummarizeSegment(activeSegmentIndex)"
            >
              Tóm tắt lại phần này
            </button>
          </div>
          <div v-else class="text-center py-4">
            <button
              class="btn btn-primary"
              :disabled="!!loadingText"
              @click="handleSummarizeSegment(activeSegmentIndex)"
            >
              Tóm tắt {{ segments[activeSegmentIndex].label }}
            </button>
          </div>
        </template>
      </template>

      <!-- NORMAL MODE: Topic ≤ 100 pages -->
      <div v-if="!isSegmentMode && summary" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-y-1.5 gap-x-3">
          <div
            v-if="summarizedPostCount > 0"
            class="flex items-center justify-start gap-2"
          >
            <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span class="text-xs text-(--color-text-secondary)">Đã tóm tắt {{ summarizedPostCount }} bài viết</span>
          </div>
        </div>
        <CacheIndicator
          v-if="cacheFreshness && cachedTopic"
          :freshness="cacheFreshness"
          :cached-at="cachedTopic.cachedAt"
          :cached-posts="cachedTopic.totalPosts"
          :current-posts="livePostCount"
          @update="handleSummarize(true)"
        />
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
