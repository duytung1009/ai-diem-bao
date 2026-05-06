import { ref, computed, watch, DeepReadonly } from 'vue';
import { sendMessage } from '@/lib/messaging';
import { parseSummaryJSON } from '@/lib/llm/summarizer';
import { isSameTopicUrl } from '@/lib/cache-manager';
import { detectNewsThread } from '@/lib/scrapers/news-detector';
import type { ArticleContent } from '@/lib/scrapers/article-extractor';
import type { DetectResult, ScrapedPost, CachedTopic, CacheFreshness, LLMConfig, XenForoVersion, TopicSegment, SummaryJSON, CustomPrompts, ThreadAnalysisJSON } from '@/lib/types';
import { scrapePageRange } from '@/lib/scrapers/page-loader';
import { estimateTokens, calculateSegmentBudget, willExceedContext, getThinkingOverhead } from '@/lib/token-estimator';
import { SUMMARY_PROMPT } from '@/lib/prompts';
import { estimateSummarizeSegmentCalls } from '@/lib/llm/cost-estimator';
import { LLM_WARN_THRESHOLD_CALLS, RESPONSE_BUFFER_TOKENS } from '@/lib/constants';
import { useTopicStore } from './useTopicStore';
import { useLLM } from './useLLM';

export function useSummarize(store: ReturnType<typeof useTopicStore>) {
  const { summarize, summarizeSegmentsTask, threadAnalysisTask, cancelTask } = useLLM();

  // --- State ---
  const summary = ref('');
  const summaryJson = ref<SummaryJSON | null>(null);
  const threadAnalysis = ref<ThreadAnalysisJSON | null>(null);
  const isAnalyzing = ref(false);
  const error = ref('');
  const scrapeProgress = ref<{ currentPage: number; totalPages: number; postsScraped: number } | null>(null);
  const simpleLoadingText = ref('');
  const llmTaskId = ref<string | null>(null);
  const isScraping = ref(false);
  const scrapingWarnings = ref<string[]>([]);
  const scrapingInfo = ref<string[]>([]);
  const currentConfig = ref<LLMConfig | null>(null);
  const cachedTopic = ref<CachedTopic | null>(null);
  const cacheFreshness = ref<CacheFreshness | null>(null);
  const segmentSize = ref(20);
  const segmentSummaries = ref<TopicSegment[]>([]);
  const activeSegmentIndex = ref<number | null>(null);
  const loadedTopicUrl = ref<string | null>(null);
  const dynamicSegmentBoundaries = ref<{ start: number; end: number; label: string }[]>([]);

  // Non-reactive
  let scrapeAbortCtrl: AbortController | null = null;
  let activeSummarizeId = 0;
  let activeAnalyzeId = 0;

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

  const isSegmentMode = computed(() => Boolean(topicInfo.value));

  const segments = computed(() => {
    if (!isSegmentMode.value || !topicInfo.value) return [];

    // Dynamic mode: use computed boundaries if available (populated during auto-summarize or loaded from cache)
    if (currentConfig.value?.dynamicSegments && dynamicSegmentBoundaries.value.length > 0) {
      return dynamicSegmentBoundaries.value;
    }

    // Fallback: fixed page count (original logic)
    const total = topicInfo.value.pageCount;
    const size = segmentSize.value;
    const segs: { start: number; end: number; label: string }[] = [];
    for (let start = 1; start <= total; start += size) {
      const end = Math.min(start + size - 1, total);
      segs.push({ start, end, label: `${start}–${end}` });
    }
    return segs;
  });

  const summarizedCount = computed(() =>
    segmentSummaries.value.filter(s => s?.summary).length,
  );

  const progressPercent = computed(() =>
    segments.value.length > 0
      ? Math.round((summarizedCount.value / segments.value.length) * 100)
      : 0,
  );

  const nextPendingSegmentIndex = computed((): number | null => {
    const idx = segmentSummaries.value.findIndex(
      (s, i) => i < segments.value.length && s?.posts?.length && !s?.summary,
    );
    return idx >= 0 ? idx : null;
  });

  const isNewsTopic = computed(() => cachedTopic.value?.topicType === 'news');

  // --- Watch ---
  watch(livePostCount, (newCount) => {
    if (cachedTopic.value && hasLivePostCount.value) {
      cacheFreshness.value = evaluateFreshness(cachedTopic.value, newCount);
    }
  });

  // --- Helpers ---
  function countRealPosts(posts: ScrapedPost[]): number {
    return posts.filter(p => p.postNumber >= 0).length;
  }

  // Auto-detect news type by fetching page 1 silently (fire-and-forget).
  // Only persists to cache if the topic already has a summary (i.e. has been summarized before).
  async function detectAndCacheTopicType(topic: DeepReadonly<CachedTopic>): Promise<void> {
    try {
      const { posts } = await scrapePageRange(topic.version, topic.url, 1, 1);
      if (!posts.length) return;
      const forumDomain = new URL(topic.url).hostname;
      const { isNews } = detectNewsThread(posts, forumDomain);
      const topicType: 'news' | 'discussion' = isNews ? 'news' : 'discussion';
      // Guard: topic must still be the one we detected for
      if (!cachedTopic.value?.url || !isSameTopicUrl(cachedTopic.value.url, topic.url) || cachedTopic.value.topicType) return;
      // Update in-memory so badge shows immediately, sync store so App.vue TopicMeta reacts
      cachedTopic.value = { ...cachedTopic.value, topicType };
      store.updateSelectedTopic({ topicType });
      // Only persist if the topic has already been summarized
      if (topic.summary) {
        await sendMessage('SAVE_CACHED_TOPIC', { ...topic, topicType }).catch(() => {});
      }
    } catch { /* silent — detection is best-effort */ }
  }

  async function saveTopic(topic: DeepReadonly<CachedTopic>, fields: Omit<Partial<CachedTopic>, 'segments'> & { segments?: (TopicSegment | null)[] }): Promise<void> {
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
    const totalRef = cached.forumPostCount ?? cached.totalPosts;
    if (ageMs > oneDay || (currentPostCount !== null && currentPostCount > totalRef)) return 'stale';
    return 'fresh';
  }

  async function loadTopicData() {
    const topic = store.selectedTopic.value;
    if (!topic) return;

    activeSummarizeId++;
    summary.value = '';
    summaryJson.value = null;
    threadAnalysis.value = null;
    isAnalyzing.value = false;
    error.value = '';
    scrapeProgress.value = null;
    simpleLoadingText.value = '';
    llmTaskId.value = null;
    isScraping.value = false;
    scrapingWarnings.value = [];
    scrapingInfo.value = [];
    cachedTopic.value = null;
    cacheFreshness.value = null;
    segmentSummaries.value = [];
    activeSegmentIndex.value = null;
    dynamicSegmentBoundaries.value = [];

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
        if (fresh.threadAnalysis) {
          threadAnalysis.value = fresh.threadAnalysis;
        }
        if (fresh.segments) {
          segmentSummaries.value = fresh.segments.map(seg => {
            if (seg && seg.summary && !seg.summaryJson) {
              const parsedJson = parseSummaryJSON(seg.summary);
              if (parsedJson) return { ...seg, summaryJson: parsedJson };
            }
            return seg;
          });
          // Restore dynamic boundaries from cached segments so segments computed works correctly
          dynamicSegmentBoundaries.value = fresh.segments.map(seg => ({
            start: seg.startPage,
            end: seg.endPage,
            label: `${seg.startPage}–${seg.endPage}`,
          }));
        }
        // Backward compat: legacy normal-mode topic has summary but no segments
        if (fresh.summary && (!fresh.segments || fresh.segments.length === 0)) {
          segmentSummaries.value = [{
            startPage: 1,
            endPage: fresh.totalPages ?? 1,
            posts: fresh.posts ?? [],
            summary: fresh.summary,
            summaryJson: fresh.summaryJson ?? undefined,
            postCount: fresh.summarizedPostCount ?? 0,
            summarizedAt: fresh.cachedAt ?? Date.now(),
          }];
        }
        const liveCount = (store.activeTabDetect.value && store.activeTabUrl.value &&
          isSameTopicUrl(store.activeTabUrl.value, fresh.url))
          ? store.activeTabDetect.value.postCount
          : null;
        cacheFreshness.value = evaluateFreshness(fresh, liveCount);

        // Auto-detect news type if not yet cached
        if (!fresh.topicType && fresh.version && fresh.version !== 'unknown') {
          detectAndCacheTopicType(fresh);
        }
      } else {
        // No cache hit: detect from store topic if version is known
        const storeTopic = store.selectedTopic.value;
        if (storeTopic && storeTopic.version && storeTopic.version !== 'unknown') {
          detectAndCacheTopicType(storeTopic);
        }
      }
    } catch { /* cache miss is fine */ }
  }

  async function handleCancel() {
    activeSummarizeId++; // Invalidate any running flow (single segment or auto-summarize)
    scrapeAbortCtrl?.abort();
    if (llmTaskId.value) cancelTask(llmTaskId.value);
    isScraping.value = false;
    scrapeProgress.value = null;
    simpleLoadingText.value = '';
    llmTaskId.value = null;
    store.setSummarizing(null);
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

  function handleRetry() {
    if (activeSegmentIndex.value !== null) {
      handleSummarizeSegment(activeSegmentIndex.value);
    } else {
      handleSummarizeSegment(0);
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
    scrapingInfo.value = [];
    const thisId = ++activeSummarizeId;
    store.setSummarizing(topic.url);

    try {
      const existing = segmentSummaries.value[segmentIndex];
      let segPosts: ScrapedPost[];
      if (existing?.posts?.length) {
        segPosts = existing.posts;
      } else {
        isScraping.value = true;
        // Let scrapeProgress's default message drive the display during scrape.
        const { posts: scraped, errors } = await scrapeRange(topic.url, seg.start, seg.end, currentConfig.value?.scrapeDelayMs ?? 2000);
        isScraping.value = false;
        scrapeProgress.value = null;
        segPosts = scraped;
        if (!segPosts.length) throw new Error('Không tìm thấy bài viết nào.');
        if (errors.length > 0) scrapingWarnings.value = errors;
      }

      // News enrichment: only for segment 0 (first post may be news OP)
      if (segmentIndex === 0) {
        segPosts = await enrichWithNewsArticles(
          segPosts,
          topic.url,
          (msg) => { simpleLoadingText.value = msg; },
          (msg) => { scrapingInfo.value = [...scrapingInfo.value, msg]; },
        );
      }
      const isNewsThread = segPosts.some(p => p.postNumber < 0);
      if (isNewsThread && cachedTopic.value) {
        cachedTopic.value = { ...cachedTopic.value, topicType: 'news' };
        store.updateSelectedTopic({ topicType: 'news' });
      }

      // Feature 16: Save segment posts early before LLM
      const tempUpdated = makeDenseBase(segmentIndex);
      tempUpdated[segmentIndex] = {
        startPage: seg.start,
        endPage: seg.end,
        posts: segPosts,
        summary: segmentSummaries.value[segmentIndex]?.summary ?? '',
        postCount: countRealPosts(segPosts),
        summarizedAt: segmentSummaries.value[segmentIndex]?.summarizedAt ?? 0,
      };
      await saveTopic(topic, { segments: tempUpdated, ...(isNewsThread ? { topicType: 'news' } : {}) });
      segmentSummaries.value = tempUpdated as TopicSegment[];

      // Phase A3 (F26): informational cost hint for large segments (non-blocking)
      const model = currentConfig.value?.model ?? 'gpt-4o-mini';
      const thinkingOverhead = getThinkingOverhead(model, currentConfig.value?.thinkingEnabled, currentConfig.value?.thinkingBudget);
      const { chunksNeeded } = willExceedContext(
        segPosts,
        model,
        estimateTokens(SUMMARY_PROMPT),
        2000,
        currentConfig.value?.contextWindow,
        thinkingOverhead,
      );
      if (estimateSummarizeSegmentCalls(chunksNeeded) >= LLM_WARN_THRESHOLD_CALLS) {
        simpleLoadingText.value = `Segment lớn — sẽ dùng ~${estimateSummarizeSegmentCalls(chunksNeeded)} API calls...`;
      }

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
        postCount: countRealPosts(segPosts),
        summarizedAt: Date.now(),
      };

      const updated = makeDenseBase(segmentIndex);
      updated[segmentIndex] = newSeg;
      const updatedDense = updated as TopicSegment[];

      // Stale guard
      if (thisId !== activeSummarizeId) {
        await saveTopic(topic, {
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

      // Single-segment: promote summary to top-level so TopicHubView shows "Đã tóm tắt"
      if (segments.value.length === 1) {
        summary.value = newSeg.summary;
        summaryJson.value = newSeg.summaryJson ?? null;
        activeSegmentIndex.value = null;
        await sendMessage('SAVE_CACHED_TOPIC', {
          url: topic.url,
          title: topic.title,
          version: topic.version,
          totalPages: topic.totalPages,
          summary: newSeg.summary,
          summaryJson: newSeg.summaryJson ?? undefined,
          summarizedPostCount: segTotalPosts,
        });
        store.updateSelectedTopic({ summary: newSeg.summary });
        const saved = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
        if (saved) cachedTopic.value = saved;
        cacheFreshness.value = 'fresh';
      }
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
    if (completedSegments.length === 0) return;

    // Single segment: copy trực tiếp, không gọi LLM
    if (completedSegments.length === 1) {
      const seg = completedSegments[0];
      summary.value = seg.summary;
      summaryJson.value = seg.summaryJson ?? null;
      activeSegmentIndex.value = null;
      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        summary: seg.summary,
        summaryJson: seg.summaryJson ?? undefined,
        summarizedPostCount: seg.postCount,
      });
      store.updateSelectedTopic({ summary: seg.summary });
      const saved = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
      if (saved) cachedTopic.value = saved;
      cacheFreshness.value = 'fresh';
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
        await saveTopic(topic, {
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
        // Also clear scrapeProgress/isScraping in case we were called from
        // handleAutoSummarizeAll, where autoSummarizeDynamic keeps scrapeProgress
        // set across phases. handleAutoSummarizeAll's own finally can't clear it
        // because generateOverallSummary bumps activeSummarizeId (stale guard).
        isScraping.value = false;
        scrapeProgress.value = null;
      }
    }
  }

  async function handleSegmentUpdate() {
    if (!topicInfo.value || !store.selectedTopic.value) return;

    const isDynamic = currentConfig.value?.dynamicSegments ?? true;
    const currentSegments = segmentSummaries.value;
    const lastSummarizedSeg = currentSegments.filter(s => s?.summary).slice(-1)[0];
    const coveredEndPage = lastSummarizedSeg?.endPage ?? 0;
    const newTotalPages = topicInfo.value.pageCount;

    if (newTotalPages <= coveredEndPage) {
      await generateOverallSummary();
      return;
    }

    if (isDynamic && dynamicSegmentBoundaries.value.length > 0) {
      // Dynamic mode: scrape new pages and append to last segment (or create new) via resume
      const topic = store.selectedTopic.value;
      error.value = '';
      scrapingWarnings.value = [];
      scrapingInfo.value = [];
      const thisId = ++activeSummarizeId;
      store.setSummarizing(topic.url);
      try {
        const budget = await computeDynamicBudget();
        const resume = computeResumeState();
        if (resume && resume.fromPage <= newTotalPages) {
          await autoSummarizeDynamic(topic.url, newTotalPages, budget, thisId, resume);
        }
        if (thisId === activeSummarizeId && !error.value) {
          const completed = segmentSummaries.value.filter(s => s?.summary).length;
          if (completed >= 1) {
            simpleLoadingText.value = 'Đang tạo tóm tắt tổng quan...';
            await generateOverallSummary();
          }
        }
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
          isScraping.value = false;
          scrapeProgress.value = null;
        }
      }
      return;
    }

    // Fixed mode: original logic
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
    if (completedCount >= 1) {
      await generateOverallSummary();
    }
  }

  /**
   * Summarize a single segment's posts and persist to cache.
   * Used internally by autoSummarizeDynamic.
   * Updates dynamicSegmentBoundaries reactively as segments are created.
   */
  async function summarizeAndSaveSegment(
    segmentIndex: number,
    startPage: number,
    endPage: number,
    posts: ScrapedPost[],
    incomplete: boolean,
    thisId: number,
  ): Promise<void> {
    if (thisId !== activeSummarizeId) return;
    const topic = store.selectedTopic.value!;
    const labelStr = `${startPage}–${endPage}`;

    simpleLoadingText.value = `Đang tóm tắt phần ${segmentIndex + 1} (trang ${labelStr})...`;

    // Update dynamic boundaries for this segment reactively
    const boundaries = [...dynamicSegmentBoundaries.value];
    while (boundaries.length <= segmentIndex) boundaries.push({ start: 0, end: 0, label: '' });
    boundaries[segmentIndex] = { start: startPage, end: endPage, label: labelStr };
    dynamicSegmentBoundaries.value = boundaries;

    // Save posts early before LLM call
    const tempBase = makeDenseBase(segmentIndex);
    tempBase[segmentIndex] = {
      startPage,
      endPage,
      posts,
      summary: segmentSummaries.value[segmentIndex]?.summary ?? '',
      postCount: countRealPosts(posts),
      summarizedAt: segmentSummaries.value[segmentIndex]?.summarizedAt ?? 0,
    };
    await saveTopic(topic, { segments: tempBase });
    segmentSummaries.value = tempBase as TopicSegment[];

    const segTask = summarize(posts);
    llmTaskId.value = segTask.taskId;
    const segResult = await segTask.result;
    llmTaskId.value = null;

    const segSummaryText = (segResult.data as { summary: string }).summary;
    const segSummaryJson = parseSummaryJSON(segSummaryText);

    const newSeg: TopicSegment = {
      startPage,
      endPage,
      posts,
      summary: segSummaryText,
      summaryJson: segSummaryJson ?? undefined,
      postCount: countRealPosts(posts),
      summarizedAt: Date.now(),
      complete: !incomplete,
    };

    const updated = makeDenseBase(segmentIndex);
    updated[segmentIndex] = newSeg;

    const segTotalPosts = updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
    const forumCount = store.activeTabDetect.value?.postCount;

    if (thisId !== activeSummarizeId) {
      // Stale: still save but don't update UI
      await saveTopic(topic, {
        forumPostCount: forumCount,
        totalPosts: Math.max(topic.totalPosts, segTotalPosts),
        summarizedPostCount: segTotalPosts,
        segments: updated,
      }).catch(() => {});
      return;
    }

    segmentSummaries.value = updated as TopicSegment[];
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: topic.url,
      title: topic.title,
      version: topic.version,
      totalPages: topic.totalPages,
      forumPostCount: forumCount,
      totalPosts: Math.max(topic.totalPosts, segTotalPosts),
      summarizedPostCount: segTotalPosts,
      segments: updated,
    });
    store.updateSelectedTopic({ segments: updated } as Partial<CachedTopic>);
    activeSegmentIndex.value = segmentIndex;

    simpleLoadingText.value = '';
  }

  // --- Dynamic segment helpers ---

  /** Resume state for continuing a partial dynamic auto-summarize run. */
  interface DynamicResumeState {
    fromPage: number;         // first page to scrape
    segmentIndex: number;     // index of the segment being built
    pendingPosts: ScrapedPost[];
    pendingTokens: number;
    pendingStartPage: number; // page where the pending segment starts
  }

  /** Fetch budget based on actual system prompt (custom or default). */
  async function computeDynamicBudget(): Promise<number> {
    const model = currentConfig.value?.model ?? 'gpt-4o-mini';
    const contextWindowOverride = currentConfig.value?.contextWindow;
    const maxTokens = currentConfig.value?.maxTokens ?? 0;
    const responseBuffer = Math.max(RESPONSE_BUFFER_TOKENS, maxTokens);
    const thinkingOverhead = getThinkingOverhead(model, currentConfig.value?.thinkingEnabled, currentConfig.value?.thinkingBudget);
    const customPromptsData = await sendMessage<CustomPrompts>('GET_CUSTOM_PROMPTS').catch(() => null);
    const systemPromptText = customPromptsData?.summary || SUMMARY_PROMPT;
    return calculateSegmentBudget(model, estimateTokens(systemPromptText), responseBuffer, contextWindowOverride, thinkingOverhead);
  }

  /**
   * Compute resume state from currently loaded segmentSummaries.
   * Returns null if no segments are summarized yet (fresh run needed).
   */
  function computeResumeState(): DynamicResumeState | null {
    const completed = segmentSummaries.value.filter(s => s?.summary);
    if (completed.length === 0) return null;

    const lastSeg = completed[completed.length - 1];
    const lastSegIdx = segmentSummaries.value.lastIndexOf(lastSeg);

    const pendingPosts = [...lastSeg.posts];
    const pendingTokens = pendingPosts.reduce(
      (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
      0,
    );

    // mergeBase: always start from last segment's state so new pages can be merged
    const mergeBase = {
      fromPage: lastSeg.endPage + 1,
      segmentIndex: lastSegIdx,
      pendingPosts,
      pendingTokens,
      pendingStartPage: lastSeg.startPage,
    };

    if (lastSeg.complete !== false) {
      // Segment was marked complete — check if it still has headroom for merging.
      // If usage is high (>70%), start a fresh segment to avoid constant re-summarization.
      const model = currentConfig.value?.model ?? 'gpt-4o-mini';
      const budget = calculateSegmentBudget(
        model, estimateTokens(SUMMARY_PROMPT), RESPONSE_BUFFER_TOKENS,
        currentConfig.value?.contextWindow,
      );
      const usagePct = budget > 0 ? pendingTokens / budget : 0;
      if (usagePct > 0.7) {
        return {
          fromPage: lastSeg.endPage + 1,
          segmentIndex: lastSegIdx + 1,
          pendingPosts: [],
          pendingTokens: 0,
          pendingStartPage: lastSeg.endPage + 1,
        };
      }
      // Headroom available — merge into existing segment
    }
    return mergeBase;
  }

  /**
   * Scrape topic page by page, split into segments when token budget is exceeded,
   * and summarize each segment immediately.
   * Decision: scrape 1 page at a time for accurate per-post token boundary detection.
   * Total time is identical to batching since per-page delay dominates.
   * Optional `resume` allows continuing a previous partial run without re-scraping.
   */
  async function autoSummarizeDynamic(
    topicUrl: string,
    totalPages: number,
    budgetTokens: number,
    thisId: number,
    resume?: DynamicResumeState,
  ): Promise<void> {
    let segmentIndex = resume?.segmentIndex ?? 0;
    let pendingPosts: ScrapedPost[] = resume?.pendingPosts ? [...resume.pendingPosts] : [];
    let pendingTokens = resume?.pendingTokens ?? 0;
    let pendingStartPage = resume?.pendingStartPage ?? 1;
    const startPage = resume?.fromPage ?? 1;

    const version = topicInfo.value?.version;
    if (!version || version === 'unknown') {
      throw new Error('Không xác định được phiên bản diễn đàn.');
    }

    // Overall-progress accumulator: count posts from completed segments + pending.
    // This drives a single topic-wide scrapeProgress that stays set across both
    // scrape and LLM phases, so the progress bar reflects page/totalPages of the
    // whole task (not each 1-page scrape) and ETA covers remaining topic scrape time.
    let totalPostsScraped = pendingPosts.length;
    for (let i = 0; i < segmentIndex; i++) {
      const seg = segmentSummaries.value[i];
      if (seg?.posts) totalPostsScraped += seg.posts.length;
    }

    const delayMs = currentConfig.value?.scrapeDelayMs ?? 2000;

    for (let page = startPage; page <= totalPages; page++) {
      if (thisId !== activeSummarizeId) return;

      isScraping.value = true;
      // Overall topic progress — scrapeProgress stays set across both scrape
      // and LLM phases so the bar + ETA reflect the whole run.
      scrapeProgress.value = {
        currentPage: page,
        totalPages,
        postsScraped: totalPostsScraped,
      };

      // Call scrapePageRange directly: going through scrapeRange() would install
      // a per-range progress callback that clobbers our overall scrapeProgress
      // with a meaningless 1/1 = 100% each iteration.
      scrapeAbortCtrl = new AbortController();
      const signal = scrapeAbortCtrl.signal;
      let pagePosts: ScrapedPost[];
      let pageErrors: string[];
      try {
        const result = await scrapePageRange(
          version as XenForoVersion,
          topicUrl,
          page,
          page,
          undefined,
          signal,
          delayMs,
        );
        if (signal.aborted) throw new DOMException('Scraping cancelled', 'AbortError');
        pagePosts = result.posts;
        pageErrors = result.errors;
      } finally {
        scrapeAbortCtrl = null;
      }
      isScraping.value = false;

      if (pageErrors.length) scrapingWarnings.value.push(...pageErrors);
      if (thisId !== activeSummarizeId) return;

      // News enrichment for page 1 only
      let enrichedPosts = pagePosts;
      if (page === 1) {
        enrichedPosts = await enrichWithNewsArticles(
          pagePosts, topicUrl,
          msg => { simpleLoadingText.value = msg; },
          msg => { scrapingInfo.value = [...scrapingInfo.value, msg]; },
        );
        if (enrichedPosts.some(p => p.postNumber < 0) && cachedTopic.value) {
          cachedTopic.value = { ...cachedTopic.value, topicType: 'news' };
          store.updateSelectedTopic({ topicType: 'news' });
        }
        simpleLoadingText.value = '';
      }

      totalPostsScraped += enrichedPosts.length;
      scrapeProgress.value = {
        currentPage: page,
        totalPages,
        postsScraped: totalPostsScraped,
      };

      const pageTokens = enrichedPosts.reduce(
        (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
        0,
      );

      // If adding this page would overflow the budget → finalize current segment.
      // Keep scrapeProgress set during summarize so the overall bar keeps ticking;
      // summarizeAndSaveSegment will set simpleLoadingText which takes precedence
      // over the scrape default message in ProgressIndicator.
      if (pendingTokens + pageTokens > budgetTokens && pendingPosts.length > 0) {
        await summarizeAndSaveSegment(segmentIndex, pendingStartPage, page - 1, pendingPosts, false, thisId);
        if (error.value || thisId !== activeSummarizeId) return;

        segmentIndex++;
        pendingPosts = [];
        pendingTokens = 0;
        pendingStartPage = page;
      }

      pendingPosts.push(...enrichedPosts);
      pendingTokens += pageTokens;
    }

    // Summarize remaining posts (last segment — all pages covered, always complete)
    if (pendingPosts.length > 0 && thisId === activeSummarizeId) {
      await summarizeAndSaveSegment(segmentIndex, pendingStartPage, totalPages, pendingPosts, false, thisId);
    }
  }

  /**
   * "Tóm tắt toàn bộ" — scrape + summarize all segments sequentially then generate overall summary.
   * In dynamic mode: scrapes page by page, splits on token budget, summarizes each chunk.
   * In fixed mode: summarizes all existing fixed segments sequentially.
   */
   async function handleAutoSummarizeAll(forceRegenerate: boolean = false) {
     const topic = store.selectedTopic.value;
     if (!topic || !topicInfo.value) return;
 
     const totalPages = topicInfo.value.pageCount;
     const isDynamic = currentConfig.value?.dynamicSegments ?? true;
 
     error.value = '';
     scrapingWarnings.value = [];
     scrapingInfo.value = [];
     const thisId = ++activeSummarizeId;
     store.setSummarizing(topic.url);
 
     try {
       if (isDynamic) {
         const budget = await computeDynamicBudget();
 
         if (forceRegenerate) {
           // Force regenerate: clear all existing state, start fresh
           dynamicSegmentBoundaries.value = [];
           segmentSummaries.value = [];
           await autoSummarizeDynamic(topic.url, totalPages, budget, thisId);
         } else {
           // Resume from partial results if any, otherwise start fresh
           const resume = computeResumeState();
           if (!resume) {
             dynamicSegmentBoundaries.value = [];
             segmentSummaries.value = [];
           }
           if (!resume || resume.fromPage <= totalPages) {
             await autoSummarizeDynamic(topic.url, totalPages, budget, thisId, resume ?? undefined);
           }
         }
       } else {
         // Fixed mode: summarize all segments sequentially
         if (forceRegenerate) {
           segmentSummaries.value = [];
         }
         for (let i = 0; i < segments.value.length; i++) {
           if (thisId !== activeSummarizeId) return;
           await handleSummarizeSegment(i);
           if (error.value) return;
         }
       }
 
       // Generate overall summary
       if (thisId === activeSummarizeId && !error.value) {
         const completed = segmentSummaries.value.filter(s => s?.summary).length;
         if (completed >= 1) {
           simpleLoadingText.value = 'Đang tạo tóm tắt tổng quan...';
           await generateOverallSummary();
         }
       }
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
         isScraping.value = false;
         scrapeProgress.value = null;
       }
     }
   }

  async function handleGenerateAnalysis(): Promise<void> {
    const topic = store.selectedTopic.value;
    if (!topic || !summaryJson.value || isAnalyzing.value) return;

    const thisAnalyzeId = ++activeAnalyzeId;
    isAnalyzing.value = true;
    error.value = '';

    try {
      const task = threadAnalysisTask(summaryJson.value, {
        title: topic.title,
        totalPages: topic.totalPages,
        totalPosts: topic.totalPosts,
      });
      llmTaskId.value = task.taskId;
      const taskResult = await task.result;
      llmTaskId.value = null;

      // Stale guard: topic changed while analyzing
      if (thisAnalyzeId !== activeAnalyzeId) return;

      const analysis = (taskResult.data as { analysis: unknown }).analysis;
      threadAnalysis.value = analysis as typeof threadAnalysis.value;

      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        threadAnalysis: analysis,
      }).catch(() => {});
    } catch (err) {
      if (thisAnalyzeId !== activeAnalyzeId) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (thisAnalyzeId === activeAnalyzeId) {
        isAnalyzing.value = false;
        llmTaskId.value = null;
      }
    }
  }

  return {
    // refs
    summary,
    summaryJson,
    threadAnalysis,
    isAnalyzing,
    error,
    scrapeProgress,
    simpleLoadingText,
    llmTaskId,
    isScraping,
    scrapingWarnings,
    scrapingInfo,
    currentConfig,
    cachedTopic,
    cacheFreshness,
    segmentSize,
    segmentSummaries,
    activeSegmentIndex,
    loadedTopicUrl,
    dynamicSegmentBoundaries,
    // computed
    topicInfo,
    isProcessing,
    summarizedPostCount,
    livePostCount,
    hasLivePostCount,
    isSegmentMode,
    segments,
    summarizedCount,
    progressPercent,
    nextPendingSegmentIndex,
    isNewsTopic,
    // functions
    loadTopicData,
    evaluateFreshness,
    handleCancel,
    handleRetry,
    handleSummarizeSegment,
    generateOverallSummary,
    handleSegmentUpdate,
    handleAutoSummarizeAll,
    handleGenerateAnalysis,
  };
}
