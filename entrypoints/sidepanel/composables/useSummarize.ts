import { ref, computed, watch, DeepReadonly } from 'vue';
import { sendMessage } from '@/lib/messaging';
import { parseSummaryJSON } from '@/lib/llm/summarizer';
import { isSameTopicUrl } from '@/lib/cache-manager';
import { detectNewsThread } from '@/lib/scrapers/news-detector';
import type { ArticleContent } from '@/lib/scrapers/article-extractor';
import type { DetectResult, ScrapedPost, CachedTopic, CacheFreshness, LLMConfig, XenForoVersion, TopicSegment, SummaryJSON, CustomPrompts, ThreadAnalysisJSON, PipelineDefinition, PipelineStep } from '@/lib/types';

import { scrapePageRange } from '@/lib/scrapers/page-loader';
import { estimateTokens, willExceedContext, getThinkingOverhead } from '@/lib/token-estimator';
import { SUMMARY_PROMPT } from '@/lib/prompts';
import { computeSegmentBudget, computeResumeState as computeResumeStateFromModule } from '@/lib/segment-planner';
import type { DynamicResumeState } from '@/lib/segment-planner';
import { createRunGuard } from '@/lib/run-guard';
import { makeDenseSegments, buildSegmentSavePayload } from '@/lib/segment-persistence';
import { estimateSummarizeSegmentCalls } from '@/lib/llm/cost-estimator';
import { LLM_WARN_THRESHOLD_CALLS } from '@/lib/constants';
import { useTopicStore } from './useTopicStore';
import { useLLM } from './useLLM';
import { useTopicScraper } from './useTopicScraper';
import { usePipeline } from './usePipeline';

export function useSummarize(store: ReturnType<typeof useTopicStore>) {
  const { summarize, summarizeSegmentsTask, threadAnalysisTask, cancelTask, getTaskState } = useLLM();
  const scraper = useTopicScraper();
  const pl = usePipeline();

  // --- State ---
  const summary = ref('');
  const summaryJson = ref<SummaryJSON | null>(null);
  const threadAnalysis = ref<ThreadAnalysisJSON | null>(null);
  const isAnalyzing = ref(false);
  const error = ref('');
  const simpleLoadingText = ref('');
  const llmTaskId = ref<string | null>(null);
  const currentConfig = ref<LLMConfig | null>(null);
  const cachedTopic = computed(() => store.selectedTopic.value);
  const cacheFreshness = ref<CacheFreshness | null>(null);
  const segmentSize = ref(20);
  const segmentSummaries = ref<TopicSegment[]>([]);
  const activeSegmentIndex = ref<number | null>(null);
  const loadedTopicUrl = ref<string | null>(null);
  const dynamicSegmentBoundaries = ref<{ start: number; end: number; label: string }[]>([]);

  // Non-reactive
  const summarizeGuard = createRunGuard();
  const analyzeGuard = createRunGuard();

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

  const isProcessing = computed(() => !!llmTaskId.value || !!scraper.scrapeProgress.value || !!simpleLoadingText.value);

  const summarizedPostCount = computed(() => {
    if (!cachedTopic.value) return 0;
    return cachedTopic.value.summarizedPostCount ?? cachedTopic.value.totalPosts ?? 0;
  });

  const activeTabPostCount = computed(() =>
    (store.activeTabDetect.value && store.activeTabUrl.value &&
      store.selectedTopic.value &&
      isSameTopicUrl(store.activeTabUrl.value, store.selectedTopic.value.url))
      ? store.activeTabDetect.value.postCount
      : 0,
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
  watch(activeTabPostCount, (newCount) => {
    if (cachedTopic.value && newCount > 0) {
      cacheFreshness.value = evaluateFreshness(cachedTopic.value as unknown as CachedTopic, newCount);
    }
  });

  // --- Helpers ---

  /** Get best available forum post count, avoiding stale activeTabDetect data
   *  when the user is not on the forum tab. */
  function getLiveForumPostCount(): number {
    const detect = store.activeTabDetect.value?.postCount ?? 0;
    const cached = cachedTopic.value?.forumPostCount ?? 0;
    return Math.max(detect, cached);
  }

  // Auto-detect news type by fetching page 1 silently (fire-and-forget).
  // Only persists to cache if the topic already has a summary (i.e. has been summarized before).
  async function detectAndCacheTopicType(topic: DeepReadonly<CachedTopic>): Promise<void> {
    try {
      const { posts, threadDeleted, threadLocked } = await scrapePageRange(topic.version, topic.url, 1, 1);
      if (threadDeleted) {
        await saveTopic(topic, { threadDeleted: true });
        return;
      }
      if (threadLocked) {
        await saveTopic(topic, { threadLocked: true });
        return;
      }
      if (!posts.length) return;
      const forumDomain = new URL(topic.url).hostname;
      const { isNews } = detectNewsThread(posts, forumDomain);
      const topicType: 'news' | 'discussion' = isNews ? 'news' : 'discussion';
      // Guard: topic must still be the one we detected for
      const currentUrl = store.selectedTopic.value?.url;
      if (!currentUrl || !isSameTopicUrl(currentUrl, topic.url) || store.selectedTopic.value?.topicType) return;
      // Update in-memory so badge shows immediately, sync store so App.vue TopicMeta reacts
      store.updateSelectedTopic({ topicType });
      // Only persist if the topic has already been summarized
      if (topic.summary) {
        await sendMessage('SAVE_CACHED_TOPIC', { ...topic, topicType }).catch(() => { });
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
    }).catch(() => { });
  }

  async function enrichWithNewsArticles(
    posts: ScrapedPost[],
    topicUrl: string,
    onStatus: (msg: string) => void,
    onInfo: (msg: string) => void,
  ): Promise<ScrapedPost[]> {
    return scraper.enrichWithNewsArticles(posts, topicUrl, { onStatus, onInfo });
  }

  // --- Functions ---
  function evaluateFreshness(cached: CachedTopic, currentPostCount: number | null): CacheFreshness {
    const ageMs = Date.now() - cached.cachedAt;
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;
    if (ageMs > oneWeek) return 'outdated';
    const totalRef = cached.forumPostCount ?? cached.totalPosts;
    if (ageMs > oneDay || (currentPostCount !== null && currentPostCount > totalRef)
      || (cached.summarizedPostCount ?? cached.totalPosts ?? 0) < totalRef) return 'stale';
    return 'fresh';
  }

  async function loadTopicData() {
    const topic = store.selectedTopic.value;
    if (!topic) return;

    summarizeGuard.begin();
    summary.value = '';
    summaryJson.value = null;
    threadAnalysis.value = null;
    isAnalyzing.value = false;
    error.value = '';
    scraper.scrapeProgress.value = null;
    simpleLoadingText.value = '';
    pl.pipeline.value = null;
    llmTaskId.value = null;
    scraper.isScraping.value = false;
    scraper.scrapingWarnings.value = [];
    scraper.scrapingInfo.value = [];
    cacheFreshness.value = null;
    segmentSummaries.value = [];
    activeSegmentIndex.value = null;
    dynamicSegmentBoundaries.value = [];

    loadedTopicUrl.value = topic.url;
    if (topic.summary) {
      summary.value = topic.summary;
    }
    try {
      const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);

      // Always update forumPostCount from live tab if active tab matches topic
      const liveCount = (store.activeTabDetect.value && store.activeTabUrl.value &&
        isSameTopicUrl(store.activeTabUrl.value, topic.url))
        ? store.activeTabDetect.value.postCount
        : null;
      const effectiveForumPostCount = liveCount ?? fresh?.forumPostCount;

      if (!!fresh?.summary && liveCount != null && liveCount > 0 && liveCount !== fresh.forumPostCount) {
        sendMessage('SAVE_CACHED_TOPIC', { url: topic.url, forumPostCount: liveCount }).catch(() => { });
      }

      // Update threadLocked/threadDeleted immediately from live detect (before any scraping)
      const liveDetect = store.activeTabDetect.value;
      const liveDetectMatches = liveDetect && store.activeTabUrl.value &&
        isSameTopicUrl(store.activeTabUrl.value, topic.url);
      const threadStatusUpdates: Partial<CachedTopic> = {};
      if (liveDetectMatches) {
        if (liveDetect.threadDeleted) threadStatusUpdates.threadDeleted = true;
        if (liveDetect.threadLocked) threadStatusUpdates.threadLocked = true;
      }

      // Persist thread status to cache immediately (only if already cached)
      if (!!fresh?.summary && Object.keys(threadStatusUpdates).length > 0) {
        sendMessage('SAVE_CACHED_TOPIC', { url: topic.url, ...threadStatusUpdates }).catch(() => { });
      }

      if (fresh) {
        store.updateSelectedTopic({
          totalPages: fresh.totalPages,
          totalPosts: fresh.totalPosts,
          forumPostCount: effectiveForumPostCount,
          summarizedPostCount: fresh.summarizedPostCount,
          version: fresh.version,
          title: fresh.title,
          posts: fresh.posts,
          ...threadStatusUpdates,
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
        cacheFreshness.value = evaluateFreshness(fresh, liveCount);

        // Auto-detect news type if not yet cached
        if (!fresh.topicType && fresh.version && fresh.version !== 'unknown') {
          detectAndCacheTopicType(fresh);
        }
      } else {
        // No cache hit: update forumPostCount from live tab
        if (liveCount != null && liveCount > 0) {
          store.updateSelectedTopic({ forumPostCount: liveCount });
        }
        // detect from store topic if version is known
        const storeTopic = store.selectedTopic.value;
        if (storeTopic && storeTopic.version && storeTopic.version !== 'unknown') {
          detectAndCacheTopicType(storeTopic);
        }
      }
    } catch { /* cache miss is fine */ }
  }

  async function handleCancel() {
    summarizeGuard.begin(); // Invalidate any running flow (single segment or auto-summarize)
    scraper.abortScrape();
    if (llmTaskId.value) cancelTask(llmTaskId.value);
    scraper.isScraping.value = false;
    scraper.scrapeProgress.value = null;
    simpleLoadingText.value = '';
    pl.pipeline.value = null;
    llmTaskId.value = null;
    store.setSummarizing(null);
  }

  async function scrapeRange(
    baseUrl: string,
    startPage: number,
    endPage: number,
    delayMs: number = 2000,
  ): Promise<{ posts: ScrapedPost[]; errors: string[]; threadDeleted?: boolean; threadLocked?: boolean }> {
    const version = topicInfo.value?.version;
    if (!version || version === 'unknown') {
      throw new Error('Không xác định được phiên bản diễn đàn.');
    }
    return scraper.scrapeRange(version as XenForoVersion, baseUrl, startPage, endPage, delayMs);
  }

  function handleRetry() {
    if (activeSegmentIndex.value !== null) {
      handleSummarizeSegment(activeSegmentIndex.value);
    } else {
      handleSummarizeSegment(0);
    }
  }

  // --- Primitive: LLM call + persist for one segment ---
  async function summarizeOneSegment(
    segmentIndex: number,
    segPosts: ScrapedPost[],
    seg: { start: number; end: number },
    thisId: number,
  ): Promise<void> {
    const topic = store.selectedTopic.value!;
    const scrapeStepId = segments.value.length <= 1 ? 'scrape' : `scrape_${segmentIndex}`;

    // Mark scrape done → summarize running
    if (pl.pipeline.value) {
      pl.pipeline.value = pl.markNextRunning(scrapeStepId);
    }

    const segTask = summarize(segPosts);
    llmTaskId.value = segTask.taskId;
    const st = getTaskState(segTask.taskId);
    if (st && pl.pipeline.value) st.pipeline = JSON.parse(JSON.stringify(pl.pipeline.value));
    const segResult = await segTask.result;

    if (pl.pipeline.value) {
      const finalTask = getTaskState(segTask.taskId);
      if (finalTask?.pipeline) pl.pipeline.value = JSON.parse(JSON.stringify(finalTask.pipeline));
    }

    const segSummaryText = (segResult.data as { summary: string }).summary;
    const segSummaryJson = parseSummaryJSON(segSummaryText);

    const newSeg: TopicSegment = {
      startPage: seg.start,
      endPage: seg.end,
      posts: segPosts,
      summary: segSummaryText,
      summaryJson: segSummaryJson ?? undefined,
      postCount: scraper.countRealPosts(segPosts),
      summarizedAt: Date.now(),
    };

    const updated = makeDenseSegments({ existing: segmentSummaries.value, segIdx: segmentIndex, totalSegments: segments.value.length });
    updated[segmentIndex] = newSeg;

    // Stale guard
    if (summarizeGuard.isStale(thisId)) {
      const stalePayload = buildSegmentSavePayload({
        topic: { url: topic.url, title: topic.title, version: topic.version, totalPages: topic.totalPages, totalPosts: topic.totalPosts },
        updatedSegments: updated,
        newSeg,
        forumPostCount: getLiveForumPostCount(),
        isSingleSegment: segments.value.length === 1,
      });
      await saveTopic(topic, stalePayload).catch(() => { });
      return;
    }

    const updatedDense = updated as TopicSegment[];
    segmentSummaries.value = updatedDense;
    activeSegmentIndex.value = segmentIndex;

    const isSingleSegment = segments.value.length === 1;
    const savePayload = buildSegmentSavePayload({
      topic: { url: topic.url, title: topic.title, version: topic.version, totalPages: topic.totalPages, totalPosts: topic.totalPosts },
      updatedSegments: updatedDense,
      newSeg,
      forumPostCount: getLiveForumPostCount(),
      isSingleSegment,
    });

    await sendMessage('SAVE_CACHED_TOPIC', savePayload);
    store.updateSelectedTopic({
      title: topic.title,
      version: topic.version,
      totalPages: topic.totalPages,
      totalPosts: savePayload.totalPosts,
      forumPostCount: savePayload.forumPostCount,
      summarizedPostCount: savePayload.summarizedPostCount,
      segments: savePayload.segments,
      ...(savePayload.summary ? { summary: savePayload.summary } : {}),
      ...(savePayload.summaryJson ? { summaryJson: savePayload.summaryJson } : {}),
    } as Partial<CachedTopic>);

    if (isSingleSegment) {
      summary.value = newSeg.summary;
      summaryJson.value = newSeg.summaryJson ?? null;
      activeSegmentIndex.value = null;
      cacheFreshness.value = 'fresh';
    }
  }

  // --- Primitive: merge N segment summaries into 1 overall ---
  async function reduceOverall(thisId: number): Promise<void> {
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
      store.updateSelectedTopic({
        summary: seg.summary,
        summaryJson: seg.summaryJson ?? undefined,
        summarizedPostCount: seg.postCount,
      });
      cacheFreshness.value = 'fresh';
      return;
    }

    store.setSummarizing(topic.url);
    simpleLoadingText.value = '';

    try {
      const summaryStrings = completedSegments.map(seg => seg.summary);
      const overallTask = summarizeSegmentsTask(summaryStrings);
      llmTaskId.value = overallTask.taskId;
      const st2 = getTaskState(overallTask.taskId);
      if (st2 && pl.pipeline.value) st2.pipeline = pl.pipeline.value;
      const overallResult = await overallTask.result;

      if (pl.pipeline.value) {
        const ft = getTaskState(overallTask.taskId);
        if (ft?.pipeline) pl.pipeline.value = JSON.parse(JSON.stringify(ft.pipeline));
      }

      const overallSummaryText = (overallResult.data as { summary: string }).summary;
      const overallSummaryJson = parseSummaryJSON(overallSummaryText);

      if (summarizeGuard.isStale(thisId)) {
        const totalSummarized = store.selectedTopic.value?.summarizedPostCount ??
          segmentSummaries.value.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
        await saveTopic(topic, {
          forumPostCount: getLiveForumPostCount(),
          summary: overallSummaryText,
          summaryJson: overallSummaryJson ?? undefined,
          summarizedPostCount: totalSummarized,
          segments: segmentSummaries.value,
        }).catch(() => { });
        return;
      }

      summary.value = overallSummaryText;
      summaryJson.value = overallSummaryJson;
      activeSegmentIndex.value = null;

      const totalSummarized = store.selectedTopic.value?.summarizedPostCount ??
        segmentSummaries.value.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        forumPostCount: getLiveForumPostCount(),
        summary: overallSummaryText,
        summaryJson: overallSummaryJson ?? undefined,
        summarizedPostCount: totalSummarized,
        segments: segmentSummaries.value,
      });
      store.updateSelectedTopic({ summary: overallSummaryText, summarizedPostCount: totalSummarized, segments: segmentSummaries.value });
      cacheFreshness.value = 'fresh';
    } catch (err) {
      if (summarizeGuard.isStale(thisId)) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      store.setSummarizing(null);
      if (!summarizeGuard.isStale(thisId)) {
        simpleLoadingText.value = '';
        llmTaskId.value = null;
        scraper.isScraping.value = false;
        scraper.scrapeProgress.value = null;
      }
    }
  }

  async function handleSummarizeSegment(segmentIndex: number) {
    const seg = segments.value[segmentIndex];
    if (!seg || !topicInfo.value) return;
    const topic = store.selectedTopic.value!;

    error.value = '';
    scraper.scrapingWarnings.value = [];
    scraper.scrapingInfo.value = [];
    // Build pipeline if not already set by parent (e.g. handleAutoSummarizeAll or handleSegmentUpdate loops)
    if (!pl.pipeline.value) {
        pl.buildSummarizePipeline(segments.value.map(s => ({ start: s.start, end: s.end })));
    }
    // Mark only this segment's scrape step as running
    const scrapeStepId = segments.value.length <= 1 ? 'scrape' : `scrape_${segmentIndex}`;
    pl.pipeline.value?.steps.forEach(s => {
      if (s.id === scrapeStepId) pl.markRunning(s.id);
    });
    const thisId = summarizeGuard.begin();
    store.setSummarizing(topic.url);

    try {
      const existing = segmentSummaries.value[segmentIndex];
      let segPosts: ScrapedPost[];
      if (existing?.posts?.length) {
        segPosts = existing.posts;
      } else {
        scraper.isScraping.value = true;
        // Let scrapeProgress's default message drive the display during scrape.
        const { posts: scraped, errors, threadDeleted, threadLocked } = await scrapeRange(topic.url, seg.start, seg.end, currentConfig.value?.scrapeDelayMs ?? 2000);
        scraper.isScraping.value = false;
        scraper.scrapeProgress.value = null;
        if (threadDeleted) {
          await saveTopic(topic, { threadDeleted: true });
          throw new Error('Thread đã bị xóa.');
        }
        if (threadLocked) {
          await saveTopic(topic, { threadLocked: true });
        }
        segPosts = scraped;
        if (!segPosts.length) throw new Error('Không tìm thấy bài viết nào.');
        if (errors.length > 0) scraper.scrapingWarnings.value = errors;
      }

      // News enrichment: only for segment 0 (first post may be news OP)
      const forumDomain = new URL(topic.url).hostname;
      const newsDetection = detectNewsThread(segPosts, forumDomain);
      const isNewsThread = newsDetection.isNews && newsDetection.articleUrls.length > 0;
      if (segmentIndex === 0) {
        segPosts = await enrichWithNewsArticles(
          segPosts,
          topic.url,
          (msg) => { simpleLoadingText.value = msg; },
          (msg) => { scraper.scrapingInfo.value = [...scraper.scrapingInfo.value, msg]; },
        );
      }
      if (isNewsThread && cachedTopic.value) {
        store.updateSelectedTopic({ topicType: 'news' });
      }

      // Feature 16: Save segment posts early before LLM
      const tempUpdated = makeDenseSegments({ existing: segmentSummaries.value, segIdx: segmentIndex, totalSegments: segments.value.length });
      tempUpdated[segmentIndex] = {
        startPage: seg.start,
        endPage: seg.end,
        posts: segPosts,
        summary: segmentSummaries.value[segmentIndex]?.summary ?? '',
        postCount: scraper.countRealPosts(segPosts),
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

      // LLM + persist (delegates to summarizeOneSegment primitive)
      await summarizeOneSegment(segmentIndex, segPosts, seg, thisId);
    } catch (err) {
      scraper.isScraping.value = false;
      scraper.scrapeProgress.value = null;
      if (summarizeGuard.isStale(thisId)) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      store.setSummarizing(null);
      if (!summarizeGuard.isStale(thisId)) {
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

    // Mark scrape step as done, set overall step to running
    if (pl.pipeline.value) {
      const scrapeStep = pl.pipeline.value.steps.find(s => s.status === 'running' && s.id.startsWith('scrape'));
      if (scrapeStep) pl.pipeline.value = pl.markNextRunning(scrapeStep.id);
    }

    const thisId = summarizeGuard.begin();
    await reduceOverall(thisId);
  }

  // --- Driver helpers ---

  type ResumeMode = { mode: 'fresh' } | { mode: 'resume'; resume: DynamicResumeState } | { mode: 'skip' };

  /** Decide the next action based on current segment state and live forum data. */
  function computeResumeMode(): ResumeMode {
    const currentSegments = segmentSummaries.value;
    const completed = currentSegments.filter(s => s?.summary);
    if (completed.length === 0) return { mode: 'fresh' };

    const lastSeg = completed[completed.length - 1];
    const coveredEndPage = lastSeg?.endPage ?? 0;
    const currentSummarizedPosts = currentSegments.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
    const livePostCount = getLiveForumPostCount();
    const hasNewPosts = livePostCount > currentSummarizedPosts;

    const newTotalPages = Math.max(
      store.activeTabDetect.value?.pageCount ?? 0,
      topicInfo.value?.pageCount ?? 0,
    );

    if (newTotalPages <= coveredEndPage && !hasNewPosts) {
      return { mode: 'skip' }; // nothing new → just reduce overall
    }

    const resume = computeResumeState();
    if (!resume) {
      // Fresh run needed — existing segments are invalid/missing
      return { mode: 'fresh' };
    }

    return { mode: 'resume', resume };
  }

  // --- Unified driver ---

  /**
   * Run the full summarize job: pipeline → scrape → summarize → reduce.
   * Handles both fresh runs and incremental updates via computeResumeMode.
   */
  async function runSummarizeJob(totalPages: number, forceRegenerate: boolean = false): Promise<void> {
    const topic = store.selectedTopic.value!;
    const isDynamic = currentConfig.value?.dynamicSegments ?? true;

    if (!isDynamic) {
      // Fixed mode: summarize pending segments sequentially, then reduce
      pl.buildSummarizePipeline(segments.value.map(s => ({ start: s.start, end: s.end })));
      pl.markFirstRunning();
      if (forceRegenerate) segmentSummaries.value = [];
      const thisId = summarizeGuard.begin();
      store.setSummarizing(topic.url);
      try {
        for (let i = 0; i < segments.value.length; i++) {
          if (summarizeGuard.isStale(thisId)) return;
          await handleSummarizeSegment(i);
          if (error.value) return;
        }
        if (!summarizeGuard.isStale(thisId) && !error.value) {
          const completed = segmentSummaries.value.filter(s => s?.summary).length;
          if (completed >= 1) {
            simpleLoadingText.value = 'Đang tạo tóm tắt tổng quan...';
            await generateOverallSummary();
          }
        }
      } catch (err) {
        scraper.isScraping.value = false;
        scraper.scrapeProgress.value = null;
        if (summarizeGuard.isStale(thisId)) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        error.value = err instanceof Error ? err.message : String(err);
      } finally {
        store.setSummarizing(null);
        if (!summarizeGuard.isStale(thisId)) {
          simpleLoadingText.value = '';
          llmTaskId.value = null;
          scraper.isScraping.value = false;
          scraper.scrapeProgress.value = null;
        }
      }
      return;
    }

    // Dynamic mode
    error.value = '';
    scraper.scrapingWarnings.value = [];
    scraper.scrapingInfo.value = [];

    const thisId = summarizeGuard.begin();
    store.setSummarizing(topic.url);

    try {
      const budget = await computeDynamicBudget();
      const resumeMode = forceRegenerate ? { mode: 'fresh' as const } : computeResumeMode();

      if (resumeMode.mode === 'skip') {
        await generateOverallSummary();
        return;
      }

      if (resumeMode.mode === 'fresh') {
        dynamicSegmentBoundaries.value = [];
        segmentSummaries.value = [];
      }

      pl.buildSummarizePipeline([{ start: 1, end: totalPages }]);
      pl.markFirstRunning();

      if (resumeMode.mode === 'resume' && resumeMode.resume.fromPage <= totalPages) {
        await autoSummarizeDynamic(topic.url, totalPages, budget, thisId, resumeMode.resume);
      } else {
        await autoSummarizeDynamic(topic.url, totalPages, budget, thisId);
      }

      if (!summarizeGuard.isStale(thisId) && !error.value) {
        const completed = segmentSummaries.value.filter(s => s?.summary).length;
        if (completed >= 1) {
          simpleLoadingText.value = 'Đang tạo tóm tắt tổng quan...';
          await generateOverallSummary();
        }
      }
    } catch (err) {
      scraper.isScraping.value = false;
      scraper.scrapeProgress.value = null;
      if (summarizeGuard.isStale(thisId)) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      store.setSummarizing(null);
      if (!summarizeGuard.isStale(thisId)) {
        simpleLoadingText.value = '';
        llmTaskId.value = null;
        scraper.isScraping.value = false;
        scraper.scrapeProgress.value = null;
      }
    }
  }

  async function handleSegmentUpdate() {
    if (!topicInfo.value || !store.selectedTopic.value) return;

    const isDynamic = currentConfig.value?.dynamicSegments ?? true;
    const currentSegments = segmentSummaries.value;

    if (isDynamic && dynamicSegmentBoundaries.value.length > 0) {
      // Dynamic mode: delegate to unified driver
      const newTotalPages = Math.max(
        store.activeTabDetect.value?.pageCount ?? 0,
        topicInfo.value.pageCount,
      );
      const totalPages = topicInfo.value ? Math.max(newTotalPages, topicInfo.value.pageCount) : newTotalPages;
      await runSummarizeJob(totalPages);
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

    // Fixed mode: build pipeline once, then summarize pending segments
    pl.buildSummarizePipeline(segments.value.map(s => ({ start: s.start, end: s.end })));
    pl.markFirstRunning();
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
    if (summarizeGuard.isStale(thisId)) return;
    const topic = store.selectedTopic.value!;
    const labelStr = `${startPage}–${endPage}`;

    simpleLoadingText.value = `Đang tóm tắt phần ${segmentIndex + 1} (trang ${labelStr})...`;

    // Update dynamic boundaries for this segment reactively
    const boundaries = [...dynamicSegmentBoundaries.value];
    while (boundaries.length <= segmentIndex) boundaries.push({ start: 0, end: 0, label: '' });
    boundaries[segmentIndex] = { start: startPage, end: endPage, label: labelStr };
    dynamicSegmentBoundaries.value = boundaries;

    // Save posts early before LLM call
    const tempBase = makeDenseSegments({ existing: segmentSummaries.value, segIdx: segmentIndex, totalSegments: segments.value.length });
    tempBase[segmentIndex] = {
      startPage,
      endPage,
      posts,
      summary: segmentSummaries.value[segmentIndex]?.summary ?? '',
      postCount: scraper.countRealPosts(posts),
      summarizedAt: segmentSummaries.value[segmentIndex]?.summarizedAt ?? 0,
    };
    await saveTopic(topic, { segments: tempBase });
    segmentSummaries.value = tempBase as TopicSegment[];

    // Mark scrape as done
    if (pl.pipeline.value) {
      const scrapeStep = pl.pipeline.value.steps.find(s => s.status === 'running' && s.id.startsWith('scrape'));
      if (scrapeStep) pl.pipeline.value = pl.markNextRunning(scrapeStep.id);
    }
    const segTask = summarize(posts);
    llmTaskId.value = segTask.taskId;
    const st3 = getTaskState(segTask.taskId);
    if (st3 && pl.pipeline.value) st3.pipeline = JSON.parse(JSON.stringify(pl.pipeline.value));
    const segResult = await segTask.result;
    // Sync pipeline with final task state
    if (pl.pipeline.value) {
      const ft = getTaskState(segTask.taskId);
      if (ft?.pipeline) pl.pipeline.value = JSON.parse(JSON.stringify(ft.pipeline));
    }
    llmTaskId.value = null;

    const segSummaryText = (segResult.data as { summary: string }).summary;
    const segSummaryJson = parseSummaryJSON(segSummaryText);

    const newSeg: TopicSegment = {
      startPage,
      endPage,
      posts,
      summary: segSummaryText,
      summaryJson: segSummaryJson ?? undefined,
      postCount: scraper.countRealPosts(posts),
      summarizedAt: Date.now(),
      complete: !incomplete,
    };

    const updated = makeDenseSegments({ existing: segmentSummaries.value, segIdx: segmentIndex, totalSegments: segments.value.length });
    updated[segmentIndex] = newSeg;

    const forumCount = getLiveForumPostCount();

    if (summarizeGuard.isStale(thisId)) {
      // Stale: still save but don't update UI
      const stalePayload = buildSegmentSavePayload({
        topic: { url: topic.url, title: topic.title, version: topic.version, totalPages: topic.totalPages, totalPosts: topic.totalPosts },
        updatedSegments: updated,
        newSeg,
        forumPostCount: forumCount,
        isSingleSegment: true, // dynamic mode always promotes
        useMaxTotal: true,
      });
      await saveTopic(topic, stalePayload).catch(() => { });
      return;
    }

    segmentSummaries.value = updated as TopicSegment[];

    const savePayload = buildSegmentSavePayload({
      topic: { url: topic.url, title: topic.title, version: topic.version, totalPages: topic.totalPages, totalPosts: topic.totalPosts },
      updatedSegments: updated,
      newSeg,
      forumPostCount: forumCount,
      isSingleSegment: true, // dynamic mode always promotes
      useMaxTotal: true,
    });

    await sendMessage('SAVE_CACHED_TOPIC', savePayload);
    store.updateSelectedTopic({
      totalPosts: savePayload.totalPosts,
      forumPostCount: savePayload.forumPostCount,
      summarizedPostCount: savePayload.summarizedPostCount,
      segments: savePayload.segments,
      summary: savePayload.summary,
      summaryJson: savePayload.summaryJson,
    } as Partial<CachedTopic>);
    activeSegmentIndex.value = segmentIndex;

    // Reconcile pipeline with actual segment count
    if (pl.pipeline.value) {
      pl.reconcile(segmentIndex + 1);
    }

    simpleLoadingText.value = '';
  }

  // --- Dynamic segment helpers ---

  /** Fetch budget based on actual system prompt (custom or default), then delegate to segment-planner. */
  async function computeDynamicBudget(): Promise<number> {
    const model = currentConfig.value?.model ?? 'gpt-4o-mini';
    const contextWindowOverride = currentConfig.value?.contextWindow;
    const maxTokens = currentConfig.value?.maxTokens;
    const thinkingOverhead = getThinkingOverhead(model, currentConfig.value?.thinkingEnabled, currentConfig.value?.thinkingBudget);
    const customPromptsData = await sendMessage<CustomPrompts>('GET_CUSTOM_PROMPTS').catch(() => null);
    const summaryPrompt = typeof customPromptsData?.summary === 'string' ? customPromptsData.summary : SUMMARY_PROMPT;
    return computeSegmentBudget({
      model,
      systemPromptTokens: estimateTokens(summaryPrompt),
      maxTokens,
      contextWindowOverride,
      thinkingOverhead,
    });
  }

  /**
   * Compute resume state from currently loaded segmentSummaries.
   * Returns null if no segments are summarized yet (fresh run needed).
   */
  function computeResumeState(): DynamicResumeState | null {
    return computeResumeStateFromModule({
      segments: segmentSummaries.value,
      model: currentConfig.value?.model ?? 'gpt-4o-mini',
      summaryPromptTokens: estimateTokens(SUMMARY_PROMPT),
      maxTokens: currentConfig.value?.maxTokens,
      contextWindow: currentConfig.value?.contextWindow,
      thinkingEnabled: currentConfig.value?.thinkingEnabled,
      thinkingBudget: currentConfig.value?.thinkingBudget,
    });
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
      if (summarizeGuard.isStale(thisId)) return;

      scraper.isScraping.value = true;
      // Overall topic progress — scrapeProgress stays set across both scrape
      // and LLM phases so the bar + ETA reflect the whole run.
      scraper.scrapeProgress.value = {
        currentPage: page,
        totalPages,
        postsScraped: totalPostsScraped,
      };

      let pagePosts: ScrapedPost[];
      let pageErrors: string[];
      let pageThreadDeleted = false;
      let pageThreadLocked = false;
      try {
        const result = await scraper.scrapeRange(version as XenForoVersion, topicUrl, page, page, delayMs);
        pagePosts = result.posts;
        pageErrors = result.errors;
        pageThreadDeleted = result.threadDeleted ?? false;
        pageThreadLocked = result.threadLocked ?? false;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        // scrapeRange handles all abort internally, but re-throw for the outer try/catch
        throw err;
      }
      scraper.isScraping.value = false;

      if (pageThreadDeleted) {
        if (cachedTopic.value) {
          await saveTopic(cachedTopic.value, { threadDeleted: true });
        }
        error.value = 'Thread đã bị xóa.';
        scraper.scrapeProgress.value = null;
        return;
      }

      if (pageThreadLocked) {
        if (cachedTopic.value) {
          await saveTopic(cachedTopic.value, { threadLocked: true });
        }
      }

      if (pageErrors.length) scraper.scrapingWarnings.value.push(...pageErrors);
      if (summarizeGuard.isStale(thisId)) return;

      // News enrichment for page 1 only
      let enrichedPosts = pagePosts;
      if (page === 1) {
        const forumDomain = new URL(topicUrl).hostname;
        const newsDetection = detectNewsThread(pagePosts, forumDomain);
        const isNewsThread = newsDetection.isNews && newsDetection.articleUrls.length > 0;
        enrichedPosts = await enrichWithNewsArticles(
          pagePosts, topicUrl,
          msg => { simpleLoadingText.value = msg; },
          msg => { scraper.scrapingInfo.value = [...scraper.scrapingInfo.value, msg]; },
        );
        if (isNewsThread && cachedTopic.value) {
          store.updateSelectedTopic({ topicType: 'news' });
        }
        simpleLoadingText.value = '';
      }

      totalPostsScraped += enrichedPosts.length;
      scraper.scrapeProgress.value = {
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
        if (error.value || summarizeGuard.isStale(thisId)) return;

        segmentIndex++;
        pendingPosts = [];
        pendingTokens = 0;
        pendingStartPage = page;
      }

      pendingPosts.push(...enrichedPosts);
      pendingTokens += pageTokens;

      if (page < totalPages && !summarizeGuard.isStale(thisId)) {
        const jitter = Math.random() * Math.min(delayMs * 0.3, 500);
        await new Promise((r) => setTimeout(r, delayMs + jitter));
      }
    }

    // Summarize remaining posts (last segment — all pages covered, always complete)
    if (pendingPosts.length > 0 && !summarizeGuard.isStale(thisId)) {
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

    const totalPages = Math.max(
      topicInfo.value.pageCount,
      store.activeTabDetect.value?.pageCount ?? 0,
    );

    await runSummarizeJob(totalPages, forceRegenerate);
  }

  async function handleGenerateAnalysis(): Promise<void> {
    const topic = store.selectedTopic.value;
    if (!topic || !summaryJson.value || isAnalyzing.value) return;

    const thisAnalyzeId = analyzeGuard.begin();
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
      if (analyzeGuard.isStale(thisAnalyzeId)) return;

      const analysis = (taskResult.data as { analysis: unknown }).analysis;
      threadAnalysis.value = analysis as typeof threadAnalysis.value;

      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        threadAnalysis: analysis,
      }).catch(() => { });
    } catch (err) {
      if (analyzeGuard.isStale(thisAnalyzeId)) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (!analyzeGuard.isStale(thisAnalyzeId)) {
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
    scrapeProgress: scraper.scrapeProgress,
    simpleLoadingText,
    llmTaskId,
    isScraping: scraper.isScraping,
    scrapingWarnings: scraper.scrapingWarnings,
    scrapingInfo: scraper.scrapingInfo,
    currentConfig,
    cachedTopic,
    cacheFreshness,
    pipeline: pl.pipeline,
    segmentSize,
    segmentSummaries,
    activeSegmentIndex,
    loadedTopicUrl,
    dynamicSegmentBoundaries,
    // computed
    topicInfo,
    isProcessing,
    summarizedPostCount,
    livePostCount: activeTabPostCount,
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
