import { ref, computed, watch, DeepReadonly } from 'vue';
import { sendMessage } from '@/lib/messaging';
import { parseSummaryJSON } from '@/lib/llm/summarizer';
import { isSameTopicUrl } from '@/lib/cache-manager';
import { detectNewsThread } from '@/lib/scrapers/news-detector';
import type { ArticleContent } from '@/lib/scrapers/article-extractor';
import type { DetectResult, ScrapedPost, CachedTopic, CacheFreshness, LLMConfig, XenForoVersion, TopicSegment, SummaryJSON, CustomPrompts, ThreadAnalysisJSON, PipelineDefinition, PipelineStep } from '@/lib/types';
import { buildSummarizePipeline, markStepRunning, markFirstStepRunning, markNextStepRunning } from '@/lib/pipeline-builder';
import { scrapePageRange } from '@/lib/scrapers/page-loader';
import { estimateTokens, willExceedContext, getThinkingOverhead } from '@/lib/token-estimator';
import { SUMMARY_PROMPT } from '@/lib/prompts';
import { computeSegmentBudget, computeResumeState as computeResumeStateFromModule } from '@/lib/segment-planner';
import type { DynamicResumeState } from '@/lib/segment-planner';
import { estimateSummarizeSegmentCalls } from '@/lib/llm/cost-estimator';
import { LLM_WARN_THRESHOLD_CALLS } from '@/lib/constants';
import { useTopicStore } from './useTopicStore';
import { useLLM } from './useLLM';

export function useSummarize(store: ReturnType<typeof useTopicStore>) {
  const { summarize, summarizeSegmentsTask, threadAnalysisTask, cancelTask, getTaskState } = useLLM();

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
  const cachedTopic = computed(() => store.selectedTopic.value);
  const cacheFreshness = ref<CacheFreshness | null>(null);
  const segmentSize = ref(20);
  const segmentSummaries = ref<TopicSegment[]>([]);
  const activeSegmentIndex = ref<number | null>(null);
  const loadedTopicUrl = ref<string | null>(null);
  const dynamicSegmentBoundaries = ref<{ start: number; end: number; label: string }[]>([]);
  const pipeline = ref<PipelineDefinition | null>(null);

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
  function countRealPosts(posts: ScrapedPost[]): number {
    return posts.filter(p => p.postNumber >= 0).length;
  }

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

      const firstPostIndex = posts.findIndex(p => p.postNumber > 0);
      if (firstPostIndex === -1) return posts;

      const articleText = articles.map(a =>
        `[BÀI BÁO GỐC — ${a.source}]\nTiêu đề: ${a.title}\n\nNội dung:\n${a.content}`,
      ).join('\n\n---\n\n');

      const updatedPosts = [...posts];
      updatedPosts[firstPostIndex] = {
        ...updatedPosts[firstPostIndex],
        content: `${articleText}\n\n---\n\n${updatedPosts[firstPostIndex].content}`,
      };

      onInfo(`Đã tải ${articles.length} bài báo gốc: ${articles.map(a => a.source).join(', ')}`);
      return updatedPosts;
    } catch { return posts; }
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

    activeSummarizeId++;
    summary.value = '';
    summaryJson.value = null;
    threadAnalysis.value = null;
    isAnalyzing.value = false;
    error.value = '';
    scrapeProgress.value = null;
    simpleLoadingText.value = '';
    pipeline.value = null;
    llmTaskId.value = null;
    isScraping.value = false;
    scrapingWarnings.value = [];
    scrapingInfo.value = [];
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
    activeSummarizeId++; // Invalidate any running flow (single segment or auto-summarize)
    scrapeAbortCtrl?.abort();
    if (llmTaskId.value) cancelTask(llmTaskId.value);
    isScraping.value = false;
    scrapeProgress.value = null;
    simpleLoadingText.value = '';
    pipeline.value = null;
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
      return { posts: result.posts, errors: result.errors, threadDeleted: result.threadDeleted, threadLocked: result.threadLocked };
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
    // Build pipeline if not already set by parent (e.g. handleAutoSummarizeAll or handleSegmentUpdate loops)
    if (!pipeline.value) {
      pipeline.value = buildSummarizePipeline(segments.value.map(s => ({ start: s.start, end: s.end })));
    }
    // Mark only this segment's scrape step as running
    const scrapeStepId = segments.value.length <= 1 ? 'scrape' : `scrape_${segmentIndex}`;
    pipeline.value.steps.forEach(s => {
      if (s.id === scrapeStepId) markStepRunning(pipeline.value!, s.id);
    });
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
        const { posts: scraped, errors, threadDeleted, threadLocked } = await scrapeRange(topic.url, seg.start, seg.end, currentConfig.value?.scrapeDelayMs ?? 2000);
        isScraping.value = false;
        scrapeProgress.value = null;
        if (threadDeleted) {
          await saveTopic(topic, { threadDeleted: true });
          throw new Error('Thread đã bị xóa.');
        }
        if (threadLocked) {
          await saveTopic(topic, { threadLocked: true });
        }
        segPosts = scraped;
        if (!segPosts.length) throw new Error('Không tìm thấy bài viết nào.');
        if (errors.length > 0) scrapingWarnings.value = errors;
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
          (msg) => { scrapingInfo.value = [...scrapingInfo.value, msg]; },
        );
      }
      if (isNewsThread && cachedTopic.value) {
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

      // Mark this segment's scrape as done, summarize as running
      if (pipeline.value) {
        pipeline.value = markNextStepRunning(pipeline.value, scrapeStepId);
      }
      const segTask = summarize(segPosts);
      llmTaskId.value = segTask.taskId;
      // Propagate latest pipeline statuses to task state for auto-updates via handleProgress
      const st = getTaskState(segTask.taskId);
      if (st && pipeline.value) st.pipeline = JSON.parse(JSON.stringify(pipeline.value));
      const segResult = await segTask.result;
      // Sync summarizePipeline with final task state for display after cleanup
      if (pipeline.value) {
        const finalTask = getTaskState(segTask.taskId);
        if (finalTask?.pipeline) pipeline.value = JSON.parse(JSON.stringify(finalTask.pipeline));
      }
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
          forumPostCount: getLiveForumPostCount(),
          totalPosts: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
          summarizedPostCount: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
          segments: updated,
        }).catch(() => { });
        return;
      }

      segmentSummaries.value = updatedDense;
      activeSegmentIndex.value = segmentIndex;

      const segTotalPosts = updatedDense.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
      const isSingleSegment = segments.value.length === 1;

      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        forumPostCount: getLiveForumPostCount(),
        totalPosts: segTotalPosts,
        summarizedPostCount: segTotalPosts,
        segments: updatedDense,
        ...(isSingleSegment ? {
          summary: newSeg.summary,
          summaryJson: newSeg.summaryJson ?? undefined,
        } : {}),
      });
      store.updateSelectedTopic({
        title: topic.title,
        version: topic.version,
        totalPages: topic.totalPages,
        totalPosts: segTotalPosts,
        forumPostCount: getLiveForumPostCount(),
        summarizedPostCount: segTotalPosts,
        segments: updatedDense,
        ...(isSingleSegment ? {
          summary: newSeg.summary,
          summaryJson: newSeg.summaryJson ?? undefined,
        } : {}),
      } as Partial<CachedTopic>);

      if (isSingleSegment) {
        summary.value = newSeg.summary;
        summaryJson.value = newSeg.summaryJson ?? null;
        activeSegmentIndex.value = null;
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

    // Mark scrape step as done, set overall step to running
    if (pipeline.value) {
      const scrapeStep = pipeline.value.steps.find(s => s.status === 'running' && s.id.startsWith('scrape'));
      if (scrapeStep) pipeline.value = markNextStepRunning(pipeline.value, scrapeStep.id);
    }

    // Single segment: copy trực tiếp, không gọi LLM
    // summarizeAndSaveSegment already saved with summary/summaryJson at top level
    // so we only update in-memory state here — no redundant SAVE_CACHED_TOPIC
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

    const thisId = ++activeSummarizeId;
    store.setSummarizing(topic.url);
    simpleLoadingText.value = '';

    try {
      const summaryStrings = completedSegments.map(seg => seg.summary);
      const overallTask = summarizeSegmentsTask(summaryStrings);
      llmTaskId.value = overallTask.taskId;
      const st2 = getTaskState(overallTask.taskId);
      if (st2 && pipeline.value) st2.pipeline = pipeline.value;
      const overallResult = await overallTask.result;
      // Sync pipeline with final task state
      if (pipeline.value) {
        const ft = getTaskState(overallTask.taskId);
        if (ft?.pipeline) pipeline.value = JSON.parse(JSON.stringify(ft.pipeline));
      }
      const overallSummaryText = (overallResult.data as { summary: string }).summary;
      const overallSummaryJson = parseSummaryJSON(overallSummaryText);

      // Stale guard
      if (thisId !== activeSummarizeId) {
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
    // Use max across live detect + cached pageCount; activeTabDetect may be null/stale
    // when user opens sidepanel from a non-forum tab, but cached value may be stale too.
    const newTotalPages = Math.max(
      store.activeTabDetect.value?.pageCount ?? 0,
      topicInfo.value.pageCount,
    );

    // Use forumPostCount (live) to detect new posts, not just pageCount.
    // Prefer cached forumPostCount over activeTabDetect: the latter may be stale
    // when the user clicks "Cập nhật" from a non-forum tab.
    const currentSummarizedPosts = currentSegments.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
    const livePostCount = getLiveForumPostCount();
    const hasNewPosts = livePostCount > currentSummarizedPosts;

    // Skip only if no new pages AND no new posts within existing pages
    if (newTotalPages <= coveredEndPage && !hasNewPosts) {
      await generateOverallSummary();
      return;
    }

    if (isDynamic && dynamicSegmentBoundaries.value.length > 0) {
      // Dynamic mode: scrape new pages and append to last segment (or create new) via resume
      const topic = store.selectedTopic.value;
      error.value = '';
      scrapingWarnings.value = [];
      scrapingInfo.value = [];
      // Build initial pipeline: scrape remaining pages + overall summary placeholder
      // Segment steps will be appended progressively as each segment completes
      const totalPages = topicInfo.value ? Math.max(newTotalPages, topicInfo.value.pageCount) : newTotalPages;
      const remainingStart = coveredEndPage + 1;
      if (remainingStart <= totalPages) {
        const label = remainingStart === totalPages ? `Scrape trang ${remainingStart}` : `Scrape trang ${remainingStart}–${totalPages}`;
        pipeline.value = {
          workflow: 'summarize',
          steps: [
            { id: 'scrape_remaining', label, status: 'running' },
            { id: 'overall', label: 'Tóm tắt tổng quan', status: 'pending' },
          ],
        };
      } else {
        // No new pages but has new posts — still need pipeline for display
        pipeline.value = {
          workflow: 'summarize',
          steps: [
            { id: 'scrape_remaining', label: 'Scrape bài viết mới', status: 'running' },
            { id: 'overall', label: 'Tóm tắt tổng quan', status: 'pending' },
          ],
        };
      }
      const thisId = ++activeSummarizeId;
      store.setSummarizing(topic.url);
      try {
        const budget = await computeDynamicBudget();
        const resume = computeResumeState();
        if (resume && hasNewPosts) {
          // New posts on existing pages (may or may not also have new pages).
          // Re-scrape from the last page of the last segment to capture new posts,
          // then continue to any new pages if they exist.
          const lastSeg = segmentSummaries.value[resume.segmentIndex];
          const lastSegEndPage = lastSeg?.endPage ?? resume.pendingStartPage;
          // Exclude posts on lastSegEndPage from pendingPosts to avoid duplicates
          // when we re-scrape that page. deduplicateAndSort handles remaining overlap.
          const preservedPosts = (resume.pendingPosts ?? []).filter(p => {
            const page = (p as ScrapedPost).page;
            return page != null && page < lastSegEndPage;
          });
          const preservedTokens = preservedPosts.reduce(
            (sum, p) => sum + estimateTokens(`[${(p as ScrapedPost).author}] (#${(p as ScrapedPost).postNumber}):\n${(p as ScrapedPost).content}`),
            0,
          );
          const reResume: DynamicResumeState = {
            fromPage: lastSegEndPage,
            segmentIndex: resume.segmentIndex,
            pendingPosts: preservedPosts,
            pendingTokens: preservedTokens,
            pendingStartPage: resume.pendingStartPage,
          };
          await autoSummarizeDynamic(topic.url, newTotalPages, budget, thisId, reResume);
        } else if (resume && resume.fromPage <= newTotalPages) {
          await autoSummarizeDynamic(topic.url, newTotalPages, budget, thisId, resume);
        } else if (hasNewPosts) {
          await autoSummarizeDynamic(topic.url, newTotalPages, budget, thisId);
        }
        if (thisId === activeSummarizeId && !error.value) {
          const completed = segmentSummaries.value.filter(s => s?.summary).length;
          if (completed >= 1) {
            simpleLoadingText.value = 'Đang tạo tóm tắt tổng quan...';
            // markNextStepRunning(pipeline.value!, 'overall');
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

    // Fixed mode: build pipeline once, then summarize pending segments
    pipeline.value = buildSummarizePipeline(segments.value.map(s => ({ start: s.start, end: s.end })));
    markFirstStepRunning(pipeline.value);
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

    // Mark scrape as done
    if (pipeline.value) {
      const scrapeStep = pipeline.value.steps.find(s => s.status === 'running' && s.id.startsWith('scrape'));
      if (scrapeStep) pipeline.value = markNextStepRunning(pipeline.value, scrapeStep.id);
    }
    const segTask = summarize(posts);
    llmTaskId.value = segTask.taskId;
    const st3 = getTaskState(segTask.taskId);
    if (st3 && pipeline.value) st3.pipeline = JSON.parse(JSON.stringify(pipeline.value));
    const segResult = await segTask.result;
    // Sync pipeline with final task state
    if (pipeline.value) {
      const ft = getTaskState(segTask.taskId);
      if (ft?.pipeline) pipeline.value = JSON.parse(JSON.stringify(ft.pipeline));
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
      postCount: countRealPosts(posts),
      summarizedAt: Date.now(),
      complete: !incomplete,
    };

    const updated = makeDenseBase(segmentIndex);
    updated[segmentIndex] = newSeg;

    const segTotalPosts = updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
    const forumCount = getLiveForumPostCount();

    if (thisId !== activeSummarizeId) {
      // Stale: still save but don't update UI
      await saveTopic(topic, {
        forumPostCount: forumCount,
        totalPosts: Math.max(topic.totalPosts, segTotalPosts),
        summarizedPostCount: segTotalPosts,
        segments: updated,
      }).catch(() => { });
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
      summary: newSeg.summary,
      summaryJson: newSeg.summaryJson ?? undefined,
    });
    store.updateSelectedTopic({
      totalPosts: Math.max(topic.totalPosts, segTotalPosts),
      forumPostCount: forumCount,
      summarizedPostCount: segTotalPosts,
      segments: updated,
      summary: newSeg.summary,
      summaryJson: newSeg.summaryJson ?? undefined,
    } as Partial<CachedTopic>);
    activeSegmentIndex.value = segmentIndex;

    // Progressive append: insert segment summary step before "overall"
    if (pipeline.value) {
      const overallIdx = pipeline.value.steps.findIndex(s => s.id === 'overall');
      const newSegSteps: PipelineStep[] = pipeline.value.steps.slice(0, overallIdx >= 0 ? overallIdx : pipeline.value.steps.length);
      if (segmentIndex === 1) {
        // For the second segment, create and push the first segment's step
        const firstSegStep: PipelineStep = {
          id: 'summarize_0',
          label: 'Tóm tắt segment 1', 
          status: 'pending',
        };
        newSegSteps.push(firstSegStep);
      }
      const segStep: PipelineStep = {
        id: `summarize_${segmentIndex}`,
        label: `Tóm tắt segment ${segmentIndex + 1}`,
        status: 'pending',
      };
      newSegSteps.push(segStep);
      if (overallIdx >= 0) {
        newSegSteps.push(...pipeline.value.steps.slice(overallIdx));
      } 
      pipeline.value.steps = newSegSteps;
      pipeline.value = markNextStepRunning(pipeline.value, newSegSteps[newSegSteps.length - 1]?.id);
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
      let pageThreadDeleted = false;
      let pageThreadLocked = false;
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
        pageThreadDeleted = result.threadDeleted ?? false;
        pageThreadLocked = result.threadLocked ?? false;
      } finally {
        scrapeAbortCtrl = null;
      }
      isScraping.value = false;

      if (pageThreadDeleted) {
        if (cachedTopic.value) {
          await saveTopic(cachedTopic.value, { threadDeleted: true });
        }
        error.value = 'Thread đã bị xóa.';
        scrapeProgress.value = null;
        return;
      }

      if (pageThreadLocked) {
        if (cachedTopic.value) {
          await saveTopic(cachedTopic.value, { threadLocked: true });
        }
      }

      if (pageErrors.length) scrapingWarnings.value.push(...pageErrors);
      if (thisId !== activeSummarizeId) return;

      // News enrichment for page 1 only
      let enrichedPosts = pagePosts;
      if (page === 1) {
        const forumDomain = new URL(topicUrl).hostname;
        const newsDetection = detectNewsThread(pagePosts, forumDomain);
        const isNewsThread = newsDetection.isNews && newsDetection.articleUrls.length > 0;
        enrichedPosts = await enrichWithNewsArticles(
          pagePosts, topicUrl,
          msg => { simpleLoadingText.value = msg; },
          msg => { scrapingInfo.value = [...scrapingInfo.value, msg]; },
        );
        if (isNewsThread && cachedTopic.value) {
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

      if (page < totalPages && thisId === activeSummarizeId) {
        const jitter = Math.random() * Math.min(delayMs * 0.3, 500);
        await new Promise((r) => setTimeout(r, delayMs + jitter));
      }
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

    // Use max across live detect + cached pageCount so we never miss new pages
    // when the cached value is stale (same pattern as handleSegmentUpdate).
    const totalPages = Math.max(
      topicInfo.value.pageCount,
      store.activeTabDetect.value?.pageCount ?? 0,
    );
    const isDynamic = currentConfig.value?.dynamicSegments ?? true;

    error.value = '';
    scrapingWarnings.value = [];
    scrapingInfo.value = [];
    const thisId = ++activeSummarizeId;
    store.setSummarizing(topic.url);

    try {
      if (isDynamic) {
        const budget = await computeDynamicBudget();
        // Build pipeline for the full page range before dynamic processing
        pipeline.value = buildSummarizePipeline([{ start: 1, end: totalPages }]);
        markFirstStepRunning(pipeline.value);
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
          if (resume && resume.fromPage <= totalPages) {
            await autoSummarizeDynamic(topic.url, totalPages, budget, thisId, resume);
          } else if (!resume) {
            await autoSummarizeDynamic(topic.url, totalPages, budget, thisId);
          }
          // When resume.fromPage > totalPages, all pages are already summarized —
          // just proceed to generateOverallSummary below
        }
      } else {
        // Fixed mode: build pipeline once, then summarize all segments sequentially
        pipeline.value = buildSummarizePipeline(segments.value.map(s => ({ start: s.start, end: s.end })));
        markFirstStepRunning(pipeline.value);
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
          // markNextStepRunning(pipeline.value!, 'overall');
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
      }).catch(() => { });
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
    pipeline,
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
