import { ref, computed, watch } from 'vue';
import { sendMessage } from '@/lib/messaging';
import { willExceedContext, estimateCost, formatTokenCount, formatCost } from '@/lib/token-estimator';
import { parseSummaryJSON } from '@/lib/llm/summarizer';
import { isSameTopicUrl } from '@/lib/cache-manager';
import { detectNewsThread } from '@/lib/scrapers/news-detector';
import type { ArticleContent } from '@/lib/scrapers/article-extractor';
import type { DetectResult, ScrapedPost, CachedTopic, CacheFreshness, LLMConfig, XenForoVersion, TopicSegment, SummaryJSON } from '@/lib/types';
import { scrapePageRange } from '@/lib/scrapers/page-loader';
import { useTopicStore } from './useTopicStore';
import { useLLM } from './useLLM';

export function useSummarize(store: ReturnType<typeof useTopicStore>) {
  const { summarize, summarizeIncremental, summarizeSegmentsTask } = useLLM();

  // --- State ---
  const summary = ref('');
  const summaryJson = ref<SummaryJSON | null>(null);
  const error = ref('');
  const scrapeProgress = ref<{ currentPage: number; totalPages: number; postsScraped: number } | null>(null);
  const simpleLoadingText = ref('');
  const llmTaskId = ref<string | null>(null);
  const isScraping = ref(false);
  const scrapingWarnings = ref<string[]>([]);
  const scrapingInfo = ref<string[]>([]);
  const pendingPosts = ref<ScrapedPost[] | null>(null);
  const pendingIncremental = ref(false);
  const currentConfig = ref<LLMConfig | null>(null);
  const cachedTopic = ref<CachedTopic | null>(null);
  const cacheFreshness = ref<CacheFreshness | null>(null);
  const segmentSize = ref(20);
  const segmentSummaries = ref<TopicSegment[]>([]);
  const activeSegmentIndex = ref<number | null>(null);
  const loadedTopicUrl = ref<string | null>(null);

  // Non-reactive
  let scrapeAbortCtrl: AbortController | null = null;
  let activeSummarizeId = 0;

  // --- Computed ---
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

  const isProcessing = computed(() => !!llmTaskId.value || !!scrapeProgress.value || !!simpleLoadingText.value);

  const summarizedPostCount = computed(() => {
    if (!cachedTopic.value) return 0;
    return cachedTopic.value.summarizedPostCount ?? cachedTopic.value.totalPosts ?? 0;
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

  // --- Watch ---
  watch(livePostCount, (newCount) => {
    if (cachedTopic.value && hasLivePostCount.value) {
      cacheFreshness.value = evaluateFreshness(cachedTopic.value, newCount);
    }
  });

  // --- Helpers ---
  function countRealPosts(posts: ScrapedPost[]): number {
    return posts.filter(p => p.postNumber > 0).length;
  }

  async function saveTopic(topic: CachedTopic, fields: Omit<Partial<CachedTopic>, 'segments'> & { segments?: (TopicSegment | null)[] }): Promise<void> {
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: topic.url,
      title: topic.title,
      version: topic.version,
      totalPages: topic.totalPages,
      ...fields,
    }).catch(() => {});
  }

  async function enrichWithNewsArticles(
    posts: ScrapedPost[],
    topicUrl: string,
    onStatus: (msg: string) => void,
    onInfo: (msg: string) => void,
  ): Promise<ScrapedPost[]> {
    if (posts.some(p => p.postNumber < 0)) return posts; // already has article posts
    try {
      const forumDomain = new URL(topicUrl).hostname;
      const newsCheck = detectNewsThread(posts, forumDomain);
      if (!newsCheck.isNews || !newsCheck.articleUrls.length) return posts;

      onStatus('Phát hiện chủ đề tin tức — đang tải bài báo gốc...');
      const articles = (await Promise.all(
        newsCheck.articleUrls.map(url =>
          sendMessage<ArticleContent | null>('SCRAPE_ARTICLE', { url }).catch(() => null),
        ),
      )).filter(Boolean) as ArticleContent[];

      if (!articles.length) return posts;
      const articlePosts: ScrapedPost[] = articles.map((a, i) => ({
        author: `[BÀI BÁO GỐC — ${a.source}]`,
        content: `Tiêu đề: ${a.title}\n\nNội dung:\n${a.content}`,
        timestamp: '',
        postNumber: -(i + 1),
      }));
      onInfo(`Đã tải ${articles.length} bài báo gốc: ${articles.map(a => a.source).join(', ')}`);
      return [...articlePosts, ...posts];
    } catch { return posts; }
  }

  // --- Functions ---
  function evaluateFreshness(cached: CachedTopic, currentPostCount: number | null): CacheFreshness {
    const ageMs = Date.now() - cached.cachedAt;
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;
    if (ageMs > oneWeek) return 'outdated';
    if (ageMs > oneDay || (currentPostCount !== null && currentPostCount > cached.totalPosts)) return 'stale';
    return 'fresh';
  }

  async function loadTopicData() {
    const topic = store.selectedTopic.value;
    if (!topic) return;

    activeSummarizeId++;
    summary.value = '';
    summaryJson.value = null;
    error.value = '';
    scrapeProgress.value = null;
    simpleLoadingText.value = '';
    llmTaskId.value = null;
    isScraping.value = false;
    scrapingWarnings.value = [];
    scrapingInfo.value = [];
    pendingPosts.value = null;
    pendingIncremental.value = false;
    cachedTopic.value = null;
    cacheFreshness.value = null;
    segmentSummaries.value = [];
    activeSegmentIndex.value = null;

    loadedTopicUrl.value = topic.url;
    cachedTopic.value = topic as CachedTopic;
    if (topic.summary) {
      summary.value = topic.summary;
    }
    try {
      const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
      if (fresh) {
        cachedTopic.value = fresh;
        store.updateSelectedTopic({
          totalPages: fresh.totalPages,
          totalPosts: fresh.totalPosts,
          summarizedPostCount: fresh.summarizedPostCount,
          version: fresh.version,
          title: fresh.title,
          posts: fresh.posts,
        });
        if (fresh.summary) {
          summary.value = fresh.summary;
        }
        if (fresh.summaryJson) {
          summaryJson.value = fresh.summaryJson;
        }
        if (fresh.segments) {
          segmentSummaries.value = fresh.segments.map(seg => {
            if (seg && seg.summary && !seg.summaryJson) {
              const parsedJson = parseSummaryJSON(seg.summary);
              if (parsedJson) return { ...seg, summaryJson: parsedJson };
            }
            return seg;
          });
        }
        const liveCount = (store.activeTabDetect.value && store.activeTabUrl.value &&
          isSameTopicUrl(store.activeTabUrl.value, fresh.url))
          ? store.activeTabDetect.value.postCount
          : null;
        cacheFreshness.value = evaluateFreshness(fresh, liveCount);
      }
    } catch { /* cache miss is fine */ }
  }

  async function handleCancel() {
    scrapeAbortCtrl?.abort();
    isScraping.value = false;
    scrapeProgress.value = null;
    simpleLoadingText.value = '';
  }

  async function scrapeRange(
    baseUrl: string,
    startPage: number,
    endPage: number,
    delayMs: number = 2000,
  ): Promise<{ posts: ScrapedPost[]; errors: string[] }> {
    const version = topicInfo.value?.version;
    if (!version || version === 'unknown') {
      throw new Error('Không xác định được phiên bản diễn đàn.');
    }
    scrapeAbortCtrl = new AbortController();
    const signal = scrapeAbortCtrl.signal;
    try {
      const result = await scrapePageRange(
        version as XenForoVersion,
        baseUrl,
        startPage,
        endPage,
        (current, _total, postsScraped) => {
          scrapeProgress.value = {
            currentPage: startPage + current - 1,
            totalPages: endPage,
            postsScraped,
          };
        },
        signal,
        delayMs,
      );
      if (signal.aborted) throw new DOMException('Scraping cancelled', 'AbortError');
      return { posts: result.posts, errors: result.errors };
    } finally {
      scrapeAbortCtrl = null;
    }
  }

  async function handleSummarize(incremental = false) {
    if (!topicInfo.value) return;
    const topic = store.selectedTopic.value!;
    error.value = '';
    scrapingWarnings.value = [];
    if (!incremental) {
      summary.value = '';
      summaryJson.value = null;
    }
    pendingPosts.value = null;

    try {
      const cachedPosts = cachedTopic.value?.posts?.length
        ? cachedTopic.value.posts
        : topic.posts ?? [];
      if (cachedPosts.length > 0 && !incremental) {
        pendingPosts.value = [...cachedPosts];
        pendingIncremental.value = false;
        return;
      }

      const detectMatchesTopic = store.activeTabUrl.value
        && isSameTopicUrl(store.activeTabUrl.value, topic.url);
      const detectedPageCount = detectMatchesTopic ? (store.activeTabDetect.value?.pageCount ?? 1) : 1;
      const cachedPageCount = topic.totalPages ?? 1;
      const pageCount = Math.max(detectedPageCount, cachedPageCount);
      let posts: ScrapedPost[];

      if (pageCount > 1) {
        isScraping.value = true;

        if (incremental && cachedTopic.value) {
          const existingCachedPages = cachedTopic.value.totalPages || 1;
          const startPage = Math.max(1, existingCachedPages + 1);
          const endPage = pageCount;

          const { posts: newPosts, errors } = await scrapeRange(topic.url, startPage, endPage, currentConfig.value?.scrapeDelayMs ?? 2000);
          isScraping.value = false;
          scrapeProgress.value = null;

          const existingPosts = cachedTopic.value.posts || [];
          const merged = [...existingPosts, ...newPosts];
          const seen = new Set<number>();
          posts = merged.filter(p => {
            if (p.postNumber === 0) return true;
            if (seen.has(p.postNumber)) return false;
            seen.add(p.postNumber);
            return true;
          }).sort((a, b) => a.postNumber - b.postNumber);

          if (errors.length > 0) scrapingWarnings.value = errors;
        } else {
          const { posts: scraped, errors } = await scrapeRange(topic.url, 1, pageCount, currentConfig.value?.scrapeDelayMs ?? 2000);
          isScraping.value = false;
          scrapeProgress.value = null;
          if (!scraped.length) throw new Error('Không tìm thấy bài viết nào.');
          posts = scraped;
          if (errors.length > 0) scrapingWarnings.value = errors;
        }
      } else {
        scrapeProgress.value = { currentPage: 1, totalPages: 1, postsScraped: 0 };
        isScraping.value = true;
        const { posts: scraped, errors } = await scrapeRange(topic.url, 1, 1, 0);
        isScraping.value = false;
        scrapeProgress.value = null;
        if (!scraped.length) throw new Error('Không tìm thấy bài viết nào.');
        posts = scraped;
        if (errors.length > 0) scrapingWarnings.value = errors;
      }

      // News detection
      posts = await enrichWithNewsArticles(
        posts,
        topic.url,
        (msg) => { simpleLoadingText.value = msg; },
        (msg) => { scrapingInfo.value.push(msg); },
      );

      // Feature 16: Save posts early to avoid re-scraping on LLM fail/cancel
      if (posts.length > 0) {
        await saveTopic(topic as CachedTopic, {
          posts,
          totalPages: pageCount,
          totalPosts: countRealPosts(posts),
        });
        const refreshed = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url).catch(() => null);
        if (refreshed) cachedTopic.value = refreshed;
      }

      simpleLoadingText.value = '';
      pendingPosts.value = posts;
      pendingIncremental.value = incremental;
    } catch (err) {
      isScraping.value = false;
      scrapeProgress.value = null;
      simpleLoadingText.value = '';
      if (err instanceof DOMException && err.name === 'AbortError') return;
      error.value = err instanceof Error ? err.message : String(err);
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
          simpleLoadingText.value = '';
          store.setSummarizing(null);
          return;
        }
        simpleLoadingText.value = '';
        const incr = summarizeIncremental(cachedTopic.value.summary, newPosts);
        llmTaskId.value = incr.taskId;
        const llmResult = await incr.result;
        summaryText = (llmResult.data as { summary: string }).summary;
      } else {
        simpleLoadingText.value = '';
        const sum = summarize(posts);
        llmTaskId.value = sum.taskId;
        const llmResult = await sum.result;
        summaryText = (llmResult.data as { summary: string }).summary;
      }

      const parsedJson = parseSummaryJSON(summaryText);

      // Stale guard: user navigated away while LLM was running
      if (thisId !== activeSummarizeId) {
        const lastPost = posts[posts.length - 1];
        const realPostCount = countRealPosts(posts);
        await saveTopic(topic as CachedTopic, {
          posts,
          summary: summaryText,
          summaryJson: parsedJson ?? undefined,
          lastPostNumber: lastPost?.postNumber ?? 0,
          totalPosts: realPostCount,
          summarizedPostCount: realPostCount,
        }).catch(() => {});
        return;
      }

      const lastPost = posts[posts.length - 1];
      const realPostCount = countRealPosts(posts);

      store.updateSelectedTopic({ summary: summaryText, posts, totalPosts: realPostCount, totalPages: topic.totalPages });
      if (cachedTopic.value) {
        cachedTopic.value = { ...cachedTopic.value, totalPosts: realPostCount, summarizedPostCount: realPostCount };
      }

      summary.value = summaryText;
      summaryJson.value = parsedJson;

      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        posts,
        summary: summaryText,
        summaryJson: parsedJson ?? undefined,
        lastPostNumber: lastPost?.postNumber ?? 0,
        totalPosts: realPostCount,
        summarizedPostCount: realPostCount,
      });

      const saved = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
      if (saved) cachedTopic.value = saved;
      cacheFreshness.value = 'fresh';
    } catch (err) {
      if (thisId !== activeSummarizeId) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      store.setSummarizing(null);
      if (thisId === activeSummarizeId) {
        simpleLoadingText.value = '';
        llmTaskId.value = null;
      }
    }
  }

  function cancelPendingSummarize() {
    pendingPosts.value = null;
    pendingIncremental.value = false;
  }

  function handleRetry() {
    if (isSegmentMode.value && activeSegmentIndex.value !== null) {
      handleSummarizeSegment(activeSegmentIndex.value);
    } else {
      handleSummarize(false);
    }
  }

  const makeDenseBase = (segIdx: number): (TopicSegment | null)[] =>
    Array.from(
      { length: Math.max(segmentSummaries.value.length, segIdx + 1, segments.value.length) },
      (_, i) => segmentSummaries.value[i] ?? null,
    );

  async function handleSummarizeSegment(segmentIndex: number) {
    const seg = segments.value[segmentIndex];
    if (!seg || !topicInfo.value) return;
    const topic = store.selectedTopic.value!;

    error.value = '';
    scrapingWarnings.value = [];
    const thisId = ++activeSummarizeId;
    store.setSummarizing(topic.url);

    try {
      const existing = segmentSummaries.value[segmentIndex];
      let segPosts: ScrapedPost[];
      if (existing?.posts?.length) {
        segPosts = existing.posts;
      } else {
        isScraping.value = true;
        simpleLoadingText.value = `Đang đọc ${seg.label}...`;
        const { posts: scraped, errors } = await scrapeRange(topic.url, seg.start, seg.end, currentConfig.value?.scrapeDelayMs ?? 2000);
        isScraping.value = false;
        scrapeProgress.value = null;
        simpleLoadingText.value = '';
        segPosts = scraped;
        if (!segPosts.length) throw new Error('Không tìm thấy bài viết nào.');
        if (errors.length > 0) scrapingWarnings.value = errors;
      }

      // Feature 16: Save segment posts early before LLM
      const tempUpdated = makeDenseBase(segmentIndex);
      tempUpdated[segmentIndex] = {
        startPage: seg.start,
        endPage: seg.end,
        posts: segPosts,
        summary: segmentSummaries.value[segmentIndex]?.summary ?? '',
        postCount: segPosts.length,
        summarizedAt: segmentSummaries.value[segmentIndex]?.summarizedAt ?? 0,
      };
      await saveTopic(topic as CachedTopic, { segments: tempUpdated });
      segmentSummaries.value = tempUpdated as TopicSegment[];

      const segTask = summarize(segPosts);
      llmTaskId.value = segTask.taskId;
      const segResult = await segTask.result;
      const segSummaryText = (segResult.data as { summary: string }).summary;
      const segSummaryJson = parseSummaryJSON(segSummaryText);

      const newSeg: TopicSegment = {
        startPage: seg.start,
        endPage: seg.end,
        posts: segPosts,
        summary: segSummaryText,
        summaryJson: segSummaryJson ?? undefined,
        postCount: segPosts.length,
        summarizedAt: Date.now(),
      };

      const updated = makeDenseBase(segmentIndex);
      updated[segmentIndex] = newSeg;
      const updatedDense = updated as TopicSegment[];

      // Stale guard
      if (thisId !== activeSummarizeId) {
        await saveTopic(topic as CachedTopic, {
          totalPosts: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
          summarizedPostCount: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
          segments: updated,
        }).catch(() => {});
        return;
      }

      segmentSummaries.value = updatedDense;
      activeSegmentIndex.value = segmentIndex;

      const segTotalPosts = updatedDense.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        totalPosts: segTotalPosts,
        summarizedPostCount: segTotalPosts,
        segments: updatedDense,
      });
      store.updateSelectedTopic({
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        segments: updatedDense,
      } as Partial<CachedTopic>);
    } catch (err) {
      isScraping.value = false;
      scrapeProgress.value = null;
      if (thisId !== activeSummarizeId) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      store.setSummarizing(null);
      if (thisId === activeSummarizeId) {
        simpleLoadingText.value = '';
        llmTaskId.value = null;
      }
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
    simpleLoadingText.value = '';

    try {
      const summaryStrings = completedSegments.map(seg => seg.summary);
      const overallTask = summarizeSegmentsTask(summaryStrings);
      llmTaskId.value = overallTask.taskId;
      const overallResult = await overallTask.result;
      const overallSummaryText = (overallResult.data as { summary: string }).summary;
      const overallSummaryJson = parseSummaryJSON(overallSummaryText);

      // Stale guard
      if (thisId !== activeSummarizeId) {
        const totalSummarized = segmentSummaries.value.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
        await saveTopic(topic as CachedTopic, {
          summary: overallSummaryText,
          summaryJson: overallSummaryJson ?? undefined,
          summarizedPostCount: totalSummarized,
        }).catch(() => {});
        return;
      }

      summary.value = overallSummaryText;
      summaryJson.value = overallSummaryJson;
      activeSegmentIndex.value = null;

      const totalSummarized = segmentSummaries.value.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        summary: overallSummaryText,
        summaryJson: overallSummaryJson ?? undefined,
        summarizedPostCount: totalSummarized,
      });
      store.updateSelectedTopic({ summary: overallSummaryText });
      const saved = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
      if (saved) cachedTopic.value = saved;
      cacheFreshness.value = 'fresh';
    } catch (err) {
      if (thisId !== activeSummarizeId) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      store.setSummarizing(null);
      if (thisId === activeSummarizeId) {
        simpleLoadingText.value = '';
        llmTaskId.value = null;
      }
    }
  }

  async function handleSegmentUpdate() {
    if (!topicInfo.value || !store.selectedTopic.value) return;

    const currentSegments = segmentSummaries.value;
    const lastSeg = currentSegments[currentSegments.length - 1];
    const coveredEndPage = lastSeg?.endPage ?? 0;
    const newTotalPages = topicInfo.value.pageCount;

    if (newTotalPages <= coveredEndPage) {
      await generateOverallSummary();
      return;
    }

    const segmentsToProcess: number[] = [];
    const newSegments = segments.value;

    for (let i = 0; i < newSegments.length; i++) {
      const seg = newSegments[i];
      const existing = currentSegments[i];
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
      if (error.value) return;
    }

    const completedCount = segmentSummaries.value.filter(s => s?.summary).length;
    if (completedCount >= 2) {
      await generateOverallSummary();
    }
  }

  return {
    // refs
    summary,
    summaryJson,
    error,
    scrapeProgress,
    simpleLoadingText,
    llmTaskId,
    isScraping,
    scrapingWarnings,
    scrapingInfo,
    pendingPosts,
    pendingIncremental,
    currentConfig,
    cachedTopic,
    cacheFreshness,
    segmentSize,
    segmentSummaries,
    activeSegmentIndex,
    loadedTopicUrl,
    // computed
    topicInfo,
    isProcessing,
    summarizedPostCount,
    livePostCount,
    hasLivePostCount,
    tokenEstimation,
    isSegmentMode,
    segments,
    // functions
    loadTopicData,
    evaluateFreshness,
    handleCancel,
    handleSummarize,
    confirmSummarize,
    cancelPendingSummarize,
    handleRetry,
    handleSummarizeSegment,
    generateOverallSummary,
    handleSegmentUpdate,
  };
}
