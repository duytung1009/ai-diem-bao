import { ref, computed, watch, DeepReadonly } from 'vue';
import { sendMessage } from '@/lib/messaging';
import { parseSummaryJSON } from '@/lib/llm/summarizer';
import { isSameTopicUrl } from '@/lib/cache-manager';
import { detectNewsThread } from '@/lib/scrapers/news-detector';
import type { DetectResult, ScrapedPost, CachedTopic, CacheFreshness, LLMConfig, XenForoVersion, TopicSegment, SummaryJSON, CustomPrompts, ThreadAnalysisJSON } from '@/lib/types';

import { scrapePageRange, PermissionRequiredError } from '@/lib/scrapers/page-loader';
import { estimateTokens, willExceedContext, getThinkingOverhead } from '@/lib/token-estimator';
import { SUMMARY_PROMPT } from '@/lib/prompts';
import { computeSegmentBudget, computeResumeState as computeResumeStateFromModule, isCompletedSegment, planDynamicSegments } from '@/lib/segment-planner';
import type { DynamicResumeState } from '@/lib/segment-planner';
import { createRunGuard } from '@/lib/run-guard';
import { makeDenseSegments, buildSegmentSavePayload } from '@/lib/segment-persistence';
import { estimateSummarizeSegmentCalls } from '@/lib/llm/cost-estimator';
import { LLM_WARN_THRESHOLD_CALLS } from '@/lib/constants';
import { useTopicStore } from './useTopicStore';
import { useLLM } from './useLLM';
import { useTopicScraper } from './useTopicScraper';
import { usePipeline } from './usePipeline';
import { hasOriginPermission, requestOriginPermission } from '@/lib/permissions';

/** Deduplicate by postNumber and sort ascending. Local copy avoids import from mocked page-loader. */
function deduplicatePosts(posts: ScrapedPost[]): ScrapedPost[] {
  const seen = new Set<number>();
  const unique = posts.filter(p => {
    if (p.postNumber === 0) return true;
    if (seen.has(p.postNumber)) return false;
    seen.add(p.postNumber);
    return true;
  });
  return unique.sort((a, b) => a.postNumber - b.postNumber);
}

export function useSummarize(store: ReturnType<typeof useTopicStore>) {
  const { summarize, summarizeSegmentsTask, threadAnalysisTask, cancelTask, getTaskState, checkLLMConfigured } = useLLM();
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
  // Index of the segment currently being summarized (drives the per-row spinner).
  const runningSegmentIndex = ref<number | null>(null);
  // Per-segment summarize errors (in-memory only — not persisted to cache).
  const segmentErrors = ref<Record<number, string>>({});
  const loadedTopicUrl = ref<string | null>(null);
  const dynamicSegmentBoundaries = ref<{ start: number; end: number; label: string }[]>([]);
  const pendingPermissionOrigin = ref('');

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

  watch(isProcessing, (val) => {
    store.setCurrentOperation('summarize', val);
  });

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

    // Always prefer persisted boundaries from cache/import.
    // This prevents UI progress mismatches when the current settings differ from
    // the settings used when the topic was originally segmented.
    if (dynamicSegmentBoundaries.value.length > 0) {
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
    segmentSummaries.value.filter(isCompletedSegment).length,
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

  const hasPartialScrape = computed(() => {
    const topic = cachedTopic.value;
    if (!topic || topic.summary) return false;
    const lastPage = topic.lastScrapedPage;
    const hasPosts = (topic.posts?.length ?? 0) > 0;
    const hasSegments = (topic.segments?.length ?? 0) > 0;
    return hasPosts && !hasSegments && !!lastPage && lastPage > 0;
  });

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
    const topicUrl = cachedTopic.value?.url;
    const activeTabMatches = topicUrl && store.activeTabUrl.value &&
      isSameTopicUrl(store.activeTabUrl.value, topicUrl);
    const detect = activeTabMatches ? (store.activeTabDetect.value?.postCount ?? 0) : 0;
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
    runningSegmentIndex.value = null;
    segmentErrors.value = {};
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
          lastScrapedPage: fresh.lastScrapedPage,
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
          dynamicSegmentBoundaries.value = [{
            start: 1,
            end: fresh.totalPages ?? 1,
            label: `1–${fresh.totalPages ?? 1}`,
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
    const idx = runningSegmentIndex.value ?? nextPendingSegmentIndex.value ?? 0;
    handleSummarizeSegment(idx);
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
        isSingleSegment: false,
      });
      await saveTopic(topic, stalePayload).catch(() => { });
      return;
    }

    const updatedDense = updated as TopicSegment[];
    segmentSummaries.value = updatedDense;

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
      ...(currentConfig.value ? { llmConfig: { provider: currentConfig.value.provider, model: currentConfig.value.model } } : {}),
    } as Partial<CachedTopic>);

    if (isSingleSegment) {
      summary.value = newSeg.summary;
      summaryJson.value = newSeg.summaryJson ?? null;
      cacheFreshness.value = 'fresh';
      pl.markDone('overall');
    }
  }

  // --- Primitive: merge N segment summaries into 1 overall ---
  async function reduceOverall(thisId: number): Promise<void> {
    const topic = store.selectedTopic.value;
    if (!topic) return;

    const completedSegments = segmentSummaries.value.filter(isCompletedSegment);
    if (completedSegments.length === 0) return;

    // Single segment: copy trực tiếp, không gọi LLM
    if (completedSegments.length === 1) {
      const seg = completedSegments[0];
      summary.value = seg.summary;
      summaryJson.value = seg.summaryJson ?? null;
      store.updateSelectedTopic({
        summary: seg.summary,
        summaryJson: seg.summaryJson ?? undefined,
        summarizedPostCount: seg.postCount,
        ...(currentConfig.value ? { llmConfig: { provider: currentConfig.value.provider, model: currentConfig.value.model } } : {}),
      });
      cacheFreshness.value = 'fresh';
      pl.markDone('overall');
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
        const totalSummarized = segmentSummaries.value.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
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

      const totalSummarized = segmentSummaries.value.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
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
      store.updateSelectedTopic({ summary: overallSummaryText, summarizedPostCount: totalSummarized, segments: segmentSummaries.value, ...(currentConfig.value ? { llmConfig: { provider: currentConfig.value.provider, model: currentConfig.value.model } } : {}) });
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

  /**
   * Summarize a single fixed-mode segment (scrape → LLM → save).
   *
   * When called standalone (per-row "Tóm tắt"/"Thử lại"), it owns its own stale
   * guard + `store.setSummarizing` lifecycle and surfaces failures via global
   * `error.value`. When called from a batch loop (`batch.token` provided), it
   * reuses the caller's guard token (so the caller's loop isn't invalidated by a
   * nested `summarizeGuard.begin()`), leaves the `setSummarizing` lifecycle to the
   * caller, and on failure flags only `segmentErrors[segmentIndex]` + the pipeline
   * step — without setting global `error.value` — so the batch keeps going.
   */
  async function handleSummarizeSegment(segmentIndex: number, batch?: { token: number }) {
    const seg = segments.value[segmentIndex];
    if (!seg || !topicInfo.value) return;
    const topic = store.selectedTopic.value!;

    const configCheck = await checkLLMConfigured();
    if (!configCheck.ok) { error.value = configCheck.error!; return; }

    error.value = '';
    // Clear any prior error for this segment (e.g. user pressed "Thử lại").
    if (segmentErrors.value[segmentIndex] !== undefined) {
      const { [segmentIndex]: _cleared, ...rest } = segmentErrors.value;
      segmentErrors.value = rest;
    }
    scraper.scrapingWarnings.value = [];
    scraper.scrapingInfo.value = [];
    // Reset pipeline if it's from a previous complete run (all steps resolved).
    // Otherwise the "Tóm tắt lại" button reuses stale "done" states.
    // Skip in batch mode: the caller built the multi-segment pipeline once and
    // resetting it mid-loop would wipe earlier segments' progress.
    if (!batch && pl.pipeline.value && pl.pipeline.value.steps.every(s => s.status !== 'running')) {
      pl.pipeline.value = null;
    }
    // Build pipeline if not already set by parent (e.g. handleAutoSummarizeAll or handleSegmentUpdate loops)
    if (!pl.pipeline.value) {
        pl.buildSummarizePipeline(segments.value.map(s => ({ start: s.start, end: s.end })));
    }
    // Mark only this segment's scrape step as running
    const scrapeStepId = segments.value.length <= 1 ? 'scrape' : `scrape_${segmentIndex}`;
    pl.pipeline.value?.steps.forEach(s => {
      if (s.id === scrapeStepId) pl.markRunning(s.id);
    });
    // Set ETA for scrape step: pages × delay
    const segPages = seg.end - seg.start + 1;
    if (segPages > 0 && pl.pipeline.value) {
      const step = pl.pipeline.value.steps.find(s => s.id === scrapeStepId);
      if (step) step.etaMs = segPages * (currentConfig.value?.scrapeDelayMs ?? 2000);
    }
    const thisId = batch ? batch.token : summarizeGuard.begin();
    if (!batch) store.setSummarizing(topic.url);
    runningSegmentIndex.value = segmentIndex;

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
      await saveTopic(topic, { 
        segments: tempUpdated, 
        totalPosts: tempUpdated?.reduce((s, seg) => s + (seg?.postCount ?? 0), 0) ?? topic.totalPosts,
        ...(isNewsThread ? { topicType: 'news' } : {}),
      });
      segmentSummaries.value = tempUpdated as TopicSegment[];

      // Phase A3 (F26): informational cost hint for large segments (non-blocking)
      const model = currentConfig.value?.model;
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
      const message = err instanceof Error ? err.message : String(err);
      // Mark this segment as failed so the grid shows an error status + "Thử lại".
      segmentErrors.value = { ...segmentErrors.value, [segmentIndex]: message };
      if (batch) {
        // Batch: flag the in-progress step and keep going — no global error banner.
        const running = pl.pipeline.value?.steps.find(s => s.status === 'running');
        if (running) pl.markError(running.id, message);
      } else {
        error.value = message;
      }
    } finally {
      if (!batch) store.setSummarizing(null);
      if (!summarizeGuard.isStale(thisId)) {
        runningSegmentIndex.value = null;
        simpleLoadingText.value = '';
        llmTaskId.value = null;
      }
    }
  }

  async function generateOverallSummary(guardToken?: number) {
    const topic = store.selectedTopic.value;
    if (!topic) return;

    const completedSegments = segmentSummaries.value.filter(isCompletedSegment);
    if (completedSegments.length === 0) return;

    const configCheck = await checkLLMConfigured();
    if (!configCheck.ok) { error.value = configCheck.error!; return; }

    pl.markRunning('overall');

    const thisId = guardToken ?? summarizeGuard.begin();
    await reduceOverall(thisId);
  }

  // --- Segment integrity check ---

  function logSegmentIntegrity(scrapeSource: 'fresh' | 'incremental', allScrapedPosts: ScrapedPost[], forumPostCount: number, totalPages: number): void {
    const segs = segmentSummaries.value;
    const segPostCountSum = segs.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
    const uniquePostNums = new Set<number>();
    let totalSegPosts = 0;
    const pageDistribution: Record<number, number> = {};
    const perSeg: { idx: number; pages: string; postCount: number; actualPosts: number }[] = [];
    const coveredPages = new Set<number>();

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const count = seg?.postCount ?? 0;
      perSeg.push({ idx: i, pages: seg ? `${seg.startPage}-${seg.endPage}` : 'null', postCount: count, actualPosts: seg?.posts?.length ?? 0 });
      if (seg?.posts) {
        totalSegPosts += seg.posts.length;
        for (const p of seg.posts) {
          uniquePostNums.add(p.postNumber);
          const pg = p.page ?? 1;
          pageDistribution[pg] = (pageDistribution[pg] || 0) + 1;
        }
      }
      if (seg) {
        for (let p = seg.startPage; p <= seg.endPage; p++) coveredPages.add(p);
      }
    }

    // Detect page coverage gaps
    const missingPages: number[] = [];
    for (let p = 1; p <= totalPages; p++) {
      if (!coveredPages.has(p)) missingPages.push(p);
    }

    console.log(`[runSummarizeJob] ${scrapeSource} — segment integrity:`, {
      segPostCountSum,
      uniquePostNumsAcrossSegs: uniquePostNums.size,
      totalSegPosts,
      allScrapedTotal: allScrapedPosts.length,
      forumPostCount,
      totalPages,
      coveredPages: coveredPages.size,
      missingPages: missingPages.length > 0 ? missingPages : 'none',
      segments: perSeg,
      pageDistribution: Object.entries(pageDistribution).map(([k, v]) => `p${k}=${v}`).join(', '),
    });

    if (segPostCountSum !== uniquePostNums.size) {
      console.warn(`[runSummarizeJob] ${scrapeSource} — POST COUNT MISMATCH (seg postCounts vs unique posts):`, {
        segPostCountSum,
        uniquePostsInSegs: uniquePostNums.size,
        diff: uniquePostNums.size - segPostCountSum,
      });
    }

    if (forumPostCount > 0 && segPostCountSum !== forumPostCount) {
      console.warn(`[runSummarizeJob] ${scrapeSource} — FORUM COUNT MISMATCH: segments have ${segPostCountSum} posts but forum reports ${forumPostCount} (diff: ${forumPostCount - segPostCountSum})`);
    }

    if (missingPages.length > 0) {
      console.warn(`[runSummarizeJob] ${scrapeSource} — PAGE GAP: ${missingPages.length} pages not covered by any segment:`, {
        missingPages,
        totalPages,
        segments: perSeg,
      });
    }

    if (allScrapedPosts.length > 0) {
      const allUniquePostNums = new Set<number>();
      for (const p of allScrapedPosts) allUniquePostNums.add(p.postNumber);

      const missingFromSegs = new Set<number>();
      for (const pn of allUniquePostNums) {
        if (!uniquePostNums.has(pn)) missingFromSegs.add(pn);
      }

      if (missingFromSegs.size > 0) {
        console.warn(`[runSummarizeJob] ${scrapeSource} — MISSING POSTS: ${missingFromSegs.size} unique posts in scraped data not found in any segment:`, {
          missingSample: [...missingFromSegs].slice(0, 20),
          allScrapedUnique: allUniquePostNums.size,
          uniqueInSegs: uniquePostNums.size,
        });
      }

      const extraInSegs = new Set<number>();
      for (const pn of uniquePostNums) {
        if (!allUniquePostNums.has(pn)) extraInSegs.add(pn);
      }
      if (extraInSegs.size > 0 && scrapeSource === 'fresh') {
        console.warn(`[runSummarizeJob] ${scrapeSource} — EXTRA POSTS: ${extraInSegs.size} posts in segments not in scraped data:`, {
          extraSample: [...extraInSegs].slice(0, 10),
        });
      }
    }
  }

  // --- Driver helpers ---

  type ResumeMode = { mode: 'fresh' } | { mode: 'resume'; resume: DynamicResumeState } | { mode: 'skip' };

  /** Decide the next action based on current segment state and live forum data. */
  function computeResumeMode(): ResumeMode {
    const currentSegments = segmentSummaries.value;
    const completed = currentSegments.filter(isCompletedSegment);

    // Check for scrape-phase partial progress (scraped but not yet summarized)
    const lastPage = cachedTopic.value?.lastScrapedPage;
    const cachedPosts = cachedTopic.value?.posts;
    if (completed.length === 0 && lastPage && lastPage > 0 && cachedPosts && cachedPosts.length > 0) {
      // We have cached posts from a previous scrape run that was interrupted
      return {
        mode: 'resume',
        resume: {
          fromPage: lastPage + 1,
          segmentIndex: 0,
          pendingPosts: [...cachedPosts],
          pendingTokens: 0,
          pendingStartPage: 1,
        },
      };
    }

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
          runningSegmentIndex.value = i;
          // Pass the batch guard token so a per-segment failure is flagged in
          // segmentErrors (not a global abort) and the loop continues to the next.
          await handleSummarizeSegment(i, { token: thisId });
        }
        if (!summarizeGuard.isStale(thisId)) {
          const completed = segmentSummaries.value.filter(isCompletedSegment).length;
          if (completed >= 1) {
            simpleLoadingText.value = 'Đang tạo tóm tắt tổng quan...';
            await generateOverallSummary(thisId);
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

    // Dynamic mode — 2-phase flow: scrape all → plan → rebuild timeline → summarize
    error.value = '';
    scraper.scrapingWarnings.value = [];
    scraper.scrapingInfo.value = [];

    const thisId = summarizeGuard.begin();
    store.setSummarizing(topic.url);

    try {
      const budget = await computeDynamicBudget();
      const resumeMode = forceRegenerate ? { mode: 'fresh' as const } : computeResumeMode();

      console.log('[runSummarizeJob] Resume mode:', {
        mode: resumeMode.mode,
        segmentSummariesCount: segmentSummaries.value.length,
        dynamicBoundariesCount: dynamicSegmentBoundaries.value.length,
        completedSegments: segmentSummaries.value.filter(isCompletedSegment).length,
        ...(resumeMode.mode === 'resume' ? {
          fromPage: resumeMode.resume.fromPage,
          segmentIndex: resumeMode.resume.segmentIndex,
          pendingPosts: resumeMode.resume.pendingPosts.length,
        } : {}),
      });

      if (resumeMode.mode === 'skip') {
        await generateOverallSummary();
        return;
      }

      if (resumeMode.mode === 'fresh') {
        dynamicSegmentBoundaries.value = [];
        segmentSummaries.value = [];
      }

      const isResume = resumeMode.mode === 'resume';
      const existingCompletedSegments = isResume
        ? segmentSummaries.value.filter(isCompletedSegment)
        : [];

      // Phase 1: Build initial timeline — scrape + plan steps visible immediately
      pl.buildDynamicScrapePipeline(totalPages);
      pl.markFirstRunning();

      // Phase 2: Scrape pages
      const resumeStartPage = isResume ? resumeMode.resume.fromPage : 1;
      const startPage = resumeStartPage > totalPages ? 1 : resumeStartPage;
      // Set ETA for scrape step: pages × delay
      {
        const scrapePages = totalPages - startPage + 1;
        const delay = currentConfig.value?.scrapeDelayMs ?? 2000;
        if (pl.pipeline.value && scrapePages > 0) {
          const step = pl.pipeline.value.steps.find(s => s.id === 'scrape');
          if (step) step.etaMs = scrapePages * delay;
        }
      }

      // When resume fromPage exceeds totalPages (all pages already covered),
      // we're re-scraping from page 1 — old segments are stale and
      // pendingPosts would duplicate with newly scraped posts.
      if (isResume && resumeStartPage > totalPages) {
        dynamicSegmentBoundaries.value = [];
        segmentSummaries.value = [];
      }

      const newPosts = await scrapeAllPages(topic.url, totalPages, startPage, thisId);
      if (!newPosts || summarizeGuard.isStale(thisId) || error.value) return;

      pl.markDone('scrape');

      if (isResume && resumeStartPage <= totalPages) {
        // ── Incremental update path ──
        // Always merge into last segment: combine pendingPosts with newly scraped posts,
        // then let planDynamicSegments decide boundaries. Resume-optimization (skip
        // segments with matching boundaries + existing summary) avoids unnecessary LLM calls.

        // Deduplicate by postNumber: pendingPosts (old) + newPosts may overlap on re-scraped page
        const seenPostNums = new Set<number>();
        const postsToPlan: ScrapedPost[] = [];
        for (const p of [...resumeMode.resume.pendingPosts, ...newPosts]) {
          if (!seenPostNums.has(p.postNumber)) {
            seenPostNums.add(p.postNumber);
            postsToPlan.push(p);
          }
        }

        console.log('[runSummarizeJob] Incremental update:', {
          existingSegments: existingCompletedSegments.length,
          startPage,
          totalPages,
          newPostsCount: newPosts.length,
          pendingPostsCount: resumeMode.resume.pendingPosts.length,
          postsToPlanCount: postsToPlan.length,
          pageDistribution: Object.entries(postsToPlan.reduce((acc, p) => { const pg = p.page ?? 1; acc[pg] = (acc[pg] || 0) + 1; return acc; }, {} as Record<number, number>)).map(([k, v]) => `p${k}=${v}`).join(', '),
        });

        pl.markRunning('plan');
        const rawNewBoundaries = planDynamicSegments(postsToPlan, budget);
        console.log('[runSummarizeJob] Incremental planned segments:', {
          budget,
          boundaryCount: rawNewBoundaries.length,
          boundaries: rawNewBoundaries.map(b => ({ start: b.start, end: b.end })),
        });

        const existingBoundaries = dynamicSegmentBoundaries.value.length > 0
          ? dynamicSegmentBoundaries.value.map(b => ({ start: b.start, end: b.end }))
          : existingCompletedSegments.map(s => ({ start: s.startPage, end: s.endPage }));

        console.log('[runSummarizeJob] Existing boundaries:', {
          fromDynamicBoundaries: dynamicSegmentBoundaries.value.length,
          fromCompletedSegments: existingCompletedSegments.length,
          existingBoundaryCount: existingBoundaries.length,
          existingBoundaries: existingBoundaries.map(b => `${b.start}-${b.end}`),
        });

        // Keep all completed segments; only the last one is dropped for re-planning
        const kept = existingBoundaries.slice(0, -1);
        const maxKeptEnd = kept.length > 0 ? Math.max(...kept.map(b => b.end)) : 0;

        // Adjust new boundaries to prevent overlap with kept segments.
        // Without this, new boundary [1-18] + kept [1-12] would produce
        // overlapping page ranges where segment post sets diverge,
        // causing summarizedPostCount to diverge from forumPostCount.
        const newBoundaries = rawNewBoundaries
          .map(b => ({
            start: Math.max(b.start, maxKeptEnd + 1),
            end: b.end,
          }))
          .filter(b => b.start <= b.end);

        const allBoundaries: { start: number; end: number }[] = [
          ...kept,
          ...newBoundaries,
        ];
        const firstNewSegIdx = kept.length;

        console.log('[runSummarizeJob] Merged boundaries:', {
          allBoundaries: allBoundaries.map(b => `${b.start}-${b.end}`),
          firstNewSegIdx,
          totalSegments: allBoundaries.length,
        });

        dynamicSegmentBoundaries.value = allBoundaries.map(b => ({ start: b.start, end: b.end, label: `${b.start}–${b.end}` }));
        pl.rebuildWithSegments(allBoundaries, firstNewSegIdx);
        pl.markDone('plan');

        // Summarize new/changed segments; skip if boundary matches existing completed segment
        for (let j = 0; j < newBoundaries.length; j++) {
          if (summarizeGuard.isStale(thisId)) return;

          const segIdx = firstNewSegIdx + j;
          const segId = allBoundaries.length <= 1 ? 'summarize' : `summarize_${segIdx}`;
          const boundary = newBoundaries[j];

          const rawPosts = postsToPlan.filter(p => {
            const pg = p.page ?? 1;
            return pg >= boundary.start && pg <= boundary.end;
          });

          // Merge existing segment posts to prevent data loss across incremental runs.
          // Without this, each run rewrites segment.posts with only postsToPlan (which
          // may be incomplete if the prior run's stored posts were already truncated),
          // progressively losing more posts with each update cycle.
          const existingSeg = segmentSummaries.value[segIdx];
          const segPosts = [...rawPosts];
          if (existingSeg?.posts?.length) {
            const seenNums = new Set(segPosts.map(p => p.postNumber));
            for (const p of existingSeg.posts) {
              const pg = p.page ?? 1;
              if (pg >= boundary.start && pg <= boundary.end && !seenNums.has(p.postNumber)) {
                segPosts.push(p);
                seenNums.add(p.postNumber);
              }
            }
          }

          // Resume optimization: skip LLM call if matching segment already summarized
          // and post count hasn't changed (no new posts in this boundary)
          const isAlreadyDone = existingSeg?.summary
            && existingSeg.startPage === boundary.start
            && existingSeg.endPage === boundary.end
            && existingSeg.postCount === segPosts.length;

          if (isAlreadyDone) {
            pl.markDone(segId);
            console.log(`[runSummarizeJob] Skipped segment ${segIdx}: boundary=${boundary.start}-${boundary.end} (already done)`);
            continue;
          }

          pl.markRunning(segId);
          runningSegmentIndex.value = segIdx;

          console.log(`[runSummarizeJob] Incremental segment ${segIdx}: boundary=${boundary.start}-${boundary.end}, segPosts=${segPosts.length}`);

          try {
            await summarizeAndSaveSegment(segIdx, boundary.start, boundary.end, segPosts, false, thisId);
            if (summarizeGuard.isStale(thisId)) return;
            pl.markDone(segId);
          } catch (err) {
            if (summarizeGuard.isStale(thisId)) return;
            if (err instanceof DOMException && err.name === 'AbortError') return;
            // Per-segment failure: flag this segment and keep going (mirror KnowledgeView extract-all).
            const msg = err instanceof Error ? err.message : String(err);
            segmentErrors.value = { ...segmentErrors.value, [segIdx]: msg };
            pl.markError(segId, msg);
          }
        }

        // Phase 6: Overall summary (incremental)
        if (!summarizeGuard.isStale(thisId) && !error.value) {
          logSegmentIntegrity('incremental', postsToPlan, getLiveForumPostCount(), totalPages);
          const completed = segmentSummaries.value.filter(isCompletedSegment).length;
          console.log('[runSummarizeJob] Incremental — before generateOverallSummary:', {
            completedSegments: completed,
            totalSegments: segmentSummaries.value.length,
            segmentSummaries: segmentSummaries.value.map((s, i) => ({ i, pages: s ? `${s.startPage}-${s.endPage}` : 'null', hasSummary: !!s?.summary })),
          });
          if (completed >= 1) {
            pl.markRunning('overall');
            simpleLoadingText.value = 'Đang tạo tóm tắt tổng quan...';
            await generateOverallSummary(thisId);
            pl.markDone('overall');
          }
        }
      } else {
        // ── Fresh path ──
        const allPosts = newPosts;

        console.log('[runSummarizeJob] Fresh scrape complete:', {
          newPostsCount: newPosts.length,
          allPostsCount: allPosts.length,
          totalPages,
          startPage,
          pageDistribution: Object.entries(allPosts.reduce((acc, p) => { const pg = p.page ?? 1; acc[pg] = (acc[pg] || 0) + 1; return acc; }, {} as Record<number, number>)).map(([k, v]) => `p${k}=${v}`).join(', '),
        });

        pl.markRunning('plan');

        // Phase 3: Plan deterministic segments
        const boundaries = planDynamicSegments(allPosts, budget);
        console.log('[runSummarizeJob] Planned segments:', {
          budget,
          boundaryCount: boundaries.length,
          boundaries: boundaries.map(b => ({ start: b.start, end: b.end })),
          postsPerSegment: boundaries.map(b => ({
            label: `${b.start}-${b.end}`,
            count: allPosts.filter(p => { const pg = p.page ?? 1; return pg >= b.start && pg <= b.end; }).length,
          })),
        });
        dynamicSegmentBoundaries.value = boundaries.map(b => ({ start: b.start, end: b.end, label: `${b.start}–${b.end}` }));

        // Phase 4: Rebuild timeline with all summarize steps
        pl.rebuildWithSegments(boundaries);
        pl.markDone('plan');

        // Phase 5: Summarize each segment (skip if boundary unchanged and already summarized)
        for (let i = 0; i < boundaries.length; i++) {
          if (summarizeGuard.isStale(thisId)) return;

          const segId = boundaries.length <= 1 ? 'summarize' : `summarize_${i}`;
          pl.markRunning(segId);

          const boundary = boundaries[i];
          const segPosts = allPosts.filter(p => {
            const pg = p.page ?? 1;
            return pg >= boundary.start && pg <= boundary.end;
          });

          console.log(`[runSummarizeJob] Segment ${i}: boundary=${boundary.start}-${boundary.end}, segPosts=${segPosts.length}`);

          // Resume optimization: skip LLM call if matching segment already summarized
          const existingSeg = segmentSummaries.value[i];
          const isAlreadyDone = existingSeg?.summary
            && existingSeg.startPage === boundary.start
            && existingSeg.endPage === boundary.end
            && existingSeg.postCount === segPosts.length;

          if (isAlreadyDone) {
            pl.markDone(segId);
            continue;
          }

          runningSegmentIndex.value = i;
          try {
            await summarizeAndSaveSegment(i, boundary.start, boundary.end, segPosts, false, thisId);
            if (summarizeGuard.isStale(thisId)) return;
            pl.markDone(segId);
          } catch (err) {
            if (summarizeGuard.isStale(thisId)) return;
            if (err instanceof DOMException && err.name === 'AbortError') return;
            // Per-segment failure: flag this segment and keep going (mirror KnowledgeView extract-all).
            const msg = err instanceof Error ? err.message : String(err);
            segmentErrors.value = { ...segmentErrors.value, [i]: msg };
            pl.markError(segId, msg);
          }
        }

        // Phase 6: Overall summary (fresh)
        if (!summarizeGuard.isStale(thisId) && !error.value) {
          logSegmentIntegrity('fresh', allPosts, getLiveForumPostCount(), totalPages);
          const completed = segmentSummaries.value.filter(isCompletedSegment).length;
          console.log('[runSummarizeJob] Fresh — before generateOverallSummary:', {
            completedSegments: completed,
            totalSegments: segmentSummaries.value.length,
          });
          if (completed >= 1) {
            pl.markRunning('overall');
            simpleLoadingText.value = 'Đang tạo tóm tắt tổng quan...';
            await generateOverallSummary(thisId);
            pl.markDone('overall');
          }
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
        runningSegmentIndex.value = null;
        simpleLoadingText.value = '';
        llmTaskId.value = null;
        scraper.isScraping.value = false;
        scraper.scrapeProgress.value = null;
      }
    }
  }

  async function handleSegmentUpdate() {
    if (!topicInfo.value || !store.selectedTopic.value) return;

    const configCheck = await checkLLMConfigured();
    if (!configCheck.ok) { error.value = configCheck.error!; return; }

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

    // Fixed mode: build pipeline once, then summarize pending segments.
    // Own a single batch guard so per-segment failures flag segmentErrors and the
    // loop continues (mirror dynamic mode) instead of bailing after one segment.
    pl.buildSummarizePipeline(segments.value.map(s => ({ start: s.start, end: s.end })));
    pl.markFirstRunning();
    const thisId = summarizeGuard.begin();
    const topicUrl = store.selectedTopic.value?.url;
    if (topicUrl) store.setSummarizing(topicUrl);
    try {
      for (const idx of segmentsToProcess) {
        if (summarizeGuard.isStale(thisId)) return;
        runningSegmentIndex.value = idx;
        await handleSummarizeSegment(idx, { token: thisId });
      }

      if (!summarizeGuard.isStale(thisId)) {
        const completedCount = segmentSummaries.value.filter(isCompletedSegment).length;
        if (completedCount >= 1) {
          await generateOverallSummary(thisId);
        }
      }
    } finally {
      store.setSummarizing(null);
      if (!summarizeGuard.isStale(thisId)) {
        runningSegmentIndex.value = null;
        simpleLoadingText.value = '';
        llmTaskId.value = null;
      }
    }
  }

  /**
   * Summarize a single segment's posts and persist to cache.
   * Used internally by runSummarizeJob's dynamic-mode segment loops.
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

    // Pipeline step management (markRunning/markDone) is handled by the caller (runSummarizeJob)
    console.log(`[summarizeAndSaveSegment] seg=${segmentIndex}, pages=${startPage}-${endPage}, posts=${posts.length}, postPages={${[...new Set(posts.map(p => p.page ?? 1))].sort((a,b) => a-b).join(',')}}`);
    const segTask = summarize(posts);
    llmTaskId.value = segTask.taskId;
    const st3 = getTaskState(segTask.taskId);
    if (st3 && pl.pipeline.value) {
      const snapshot = JSON.parse(JSON.stringify(pl.pipeline.value));
      if (st3.estimatedTotalMs > 0) {
        for (let i = 0; i < snapshot.steps.length; i++) {
          if (snapshot.steps[i].status === 'running') {
            snapshot.steps[i].etaMs = st3.estimatedTotalMs;
            break;
          }
        }
      }
      st3.pipeline = snapshot;
    }
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
        isSingleSegment: false,
        useMaxTotal: true,
      });
      await saveTopic(topic, stalePayload).catch(() => { });
      return;
    }

    segmentSummaries.value = updated as TopicSegment[];

    const isSingleSeg = dynamicSegmentBoundaries.value.length <= 1
      && updated.filter(isCompletedSegment).length <= 1;

    const savePayload = buildSegmentSavePayload({
      topic: { url: topic.url, title: topic.title, version: topic.version, totalPages: topic.totalPages, totalPosts: topic.totalPosts },
      updatedSegments: updated,
      newSeg,
      forumPostCount: forumCount,
      isSingleSegment: isSingleSeg,
      useMaxTotal: true,
    });

    await sendMessage('SAVE_CACHED_TOPIC', savePayload);
    const storeUpdate: Partial<CachedTopic> = {
      totalPosts: savePayload.totalPosts,
      forumPostCount: savePayload.forumPostCount,
      summarizedPostCount: savePayload.summarizedPostCount,
      segments: savePayload.segments as TopicSegment[],
      ...(currentConfig.value ? { llmConfig: { provider: currentConfig.value.provider, model: currentConfig.value.model } } : {}),
    };
    if (isSingleSeg) {
      storeUpdate.summary = savePayload.summary;
      storeUpdate.summaryJson = savePayload.summaryJson;
    }
    store.updateSelectedTopic(storeUpdate);

    simpleLoadingText.value = '';
  }

  // --- Dynamic segment helpers ---

  /** Fetch budget based on actual system prompt (custom or default), then delegate to segment-planner. */
  async function computeDynamicBudget(): Promise<number> {
    const model = currentConfig.value?.model;
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
    });
  }

  /**
   * Scrape all pages from `fromPage` to `totalPages` for a dynamic job.
   * Returns the combined posts, or null if aborted / thread deleted / stale.
   *
   * Own responsibilities:
   * - News enrichment (page 1 only)
   * - scrapeProgress overall tracking (preserves fix C1)
   * - Abort linking (child AbortController linked to scraper abort)
   * - Thread deleted / locked detection
   * - Delay + jitter between pages
   * - Page errors pushed to scrapingWarnings
   */
  async function scrapeAllPages(
    topicUrl: string,
    totalPages: number,
    fromPage: number,
    thisId: number,
  ): Promise<ScrapedPost[] | null> {
    const version = topicInfo.value?.version;
    if (!version || version === 'unknown') {
      throw new Error('Không xác định được phiên bản diễn đàn.');
    }

    const delayMs = currentConfig.value?.scrapeDelayMs ?? 2000;
    const allPosts: ScrapedPost[] = [];
    let totalPostsScraped = 0;
    const MAX_RETRIES = 3;

    for (let page = fromPage; page <= totalPages; page++) {
      if (summarizeGuard.isStale(thisId)) return null;

      scraper.isScraping.value = true;
      scraper.scrapeProgress.value = {
        currentPage: page,
        totalPages,
        postsScraped: totalPostsScraped,
      };

      let pagePosts: ScrapedPost[] = [];
      let pageErrors: string[] = [];
      let pageThreadDeleted = false;
      let pageThreadLocked = false;
      let pageSucceeded = false;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (summarizeGuard.isStale(thisId)) return null;
        if (attempt > 0) {
          const retryDelay = delayMs * Math.pow(2, attempt - 1);
          simpleLoadingText.value = `Đang thử lại trang ${page} (lần ${attempt + 1}/${MAX_RETRIES})...`;
          await new Promise((r) => setTimeout(r, retryDelay));
        }

        try {
          const pageAbortCtrl = new AbortController();
          scraper.getAbortSignal()?.addEventListener('abort', () => pageAbortCtrl.abort(), { once: true });

          const result = await scrapePageRange(
            version as XenForoVersion,
            topicUrl,
            page,
            page,
            (_current, _total, postsScraped) => {
              scraper.scrapeProgress.value = {
                currentPage: page,
                totalPages,
                postsScraped: totalPostsScraped + postsScraped,
              };
            },
            pageAbortCtrl.signal,
            delayMs,
          );
          pagePosts = result.posts;
          pageErrors = result.errors;
          pageThreadDeleted = result.threadDeleted ?? false;
          pageThreadLocked = result.threadLocked ?? false;

          if (pagePosts.length > 0 || pageErrors.length === 0) {
            pageSucceeded = true;
            break;
          }

          console.warn(`[scrapeAllPages] Page ${page} attempt ${attempt + 1}: 0 posts scraped, ${pageErrors.length} errors — ${pageErrors.join('; ')}`);
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') throw err;
          if (err instanceof PermissionRequiredError) {
            pendingPermissionOrigin.value = err.origin;
            return null;
          }
          console.warn(`[scrapeAllPages] Page ${page} attempt ${attempt + 1}: exception — ${String(err)}`);
        }
      }

      if (!pageSucceeded) {
        scraper.scrapingWarnings.value.push(`Trang ${page}: Thất bại sau ${MAX_RETRIES} lần thử — mất ${pagePosts.length} bài`);
      }
      scraper.isScraping.value = false;

      if (pageThreadDeleted) {
        if (cachedTopic.value) {
          await saveTopic(cachedTopic.value, { threadDeleted: true });
        }
        error.value = 'Thread đã bị xóa.';
        scraper.scrapeProgress.value = null;
        return null;
      }

      if (pageThreadLocked) {
        if (cachedTopic.value) {
          await saveTopic(cachedTopic.value, { threadLocked: true });
        }
      }

      if (pageErrors.length) scraper.scrapingWarnings.value.push(...pageErrors);
      if (summarizeGuard.isStale(thisId)) return null;

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

      console.log(`[scrapeAllPages] page=${page}/${totalPages}: rawPosts=${pagePosts.length}, enrichedPosts=${enrichedPosts.length}, cumulative=${allPosts.length + enrichedPosts.length}, errors=${pageErrors.length}`);
      allPosts.push(...enrichedPosts);

      // Persist accumulated posts + lastScrapedPage every 5 pages during scrape phase.
      // Also always save on the last page to preserve full scrape state before summarization.
      // Merge with existing posts from store to prevent data loss on resume
      // (otherwise only allPosts = new posts would overwrite old scraped posts in IDB).
      if (cachedTopic.value && (page % 5 === 0 || page === totalPages)) {
        const existingPosts = cachedTopic.value.posts ?? [];
        const mergedPosts = deduplicatePosts([...existingPosts, ...allPosts]);
        await saveTopic(cachedTopic.value, {
          posts: mergedPosts,
          lastScrapedPage: page,
        }).catch(() => { });
      }

      if (page < totalPages && !summarizeGuard.isStale(thisId)) {
        const jitter = Math.random() * Math.min(delayMs * 0.3, 500);
        await new Promise((r) => setTimeout(r, delayMs + jitter));
      }
    }

    return allPosts;
  }

  /**
   * "Tóm tắt toàn bộ" — scrape + summarize all segments sequentially then generate overall summary.
   * In dynamic mode: scrapes page by page, splits on token budget, summarizes each chunk.
   * In fixed mode: summarizes all existing fixed segments sequentially.
   */
  async function handleAutoSummarizeAll(forceRegenerate: boolean = false) {
    const topic = store.selectedTopic.value;
    if (!topic || !topicInfo.value) return;

    const configCheck = await checkLLMConfigured();
    if (!configCheck.ok) { error.value = configCheck.error!; return; }

    const origin = new URL(topic.url).origin + '/*';
    const hasPerm = await hasOriginPermission(origin);
    if (!hasPerm) {
      pendingPermissionOrigin.value = new URL(topic.url).origin;
      return;
    }

    const totalPages = Math.max(
      topicInfo.value.pageCount,
      store.activeTabDetect.value?.pageCount ?? 0,
    );

    await runSummarizeJob(totalPages, forceRegenerate);
  }

  async function handleGrantPermission() {
    const origin = pendingPermissionOrigin.value;
    if (!origin) return;
    const granted = await requestOriginPermission(origin + '/*');
    pendingPermissionOrigin.value = '';
    if (granted) {
      await handleAutoSummarizeAll();
    } else {
      error.value = 'Chưa cấp quyền truy cập forum.';
    }
  }

  async function handleGenerateAnalysis(): Promise<void> {
    const topic = store.selectedTopic.value;
    if (!topic || !summaryJson.value || isAnalyzing.value) return;

    const configCheck = await checkLLMConfigured();
    if (!configCheck.ok) { error.value = configCheck.error!; return; }

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
    runningSegmentIndex,
    segmentErrors,
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
    hasPartialScrape,
    pendingPermissionOrigin,
    // functions
    loadTopicData,
    handleGrantPermission,
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
