import { ref, computed, watch, readonly } from 'vue';
import type { KnowledgeEntry, KnowledgeChunk, LLMConfig, CachedTopic, ScrapedPost, NotebookEntry, CostEstimate, TopicSegment } from '@/lib/types';
import { sendMessage, sendMessageQuiet } from '@/lib/messaging';
import { estimateTokens, calculateSegmentBudget, getContextLimit, getModelMaxOutput } from '@/lib/token-estimator';
import { planKnowledgeChunks, KNOWLEDGE_CHUNK_PROMPT_TOKENS } from '@/lib/llm/summarizer';
import { estimateExtractCalls, estimateExtractCost, buildCostEstimate } from '@/lib/llm/cost-estimator';
import { LLM_WARN_THRESHOLD_CALLS, CONTEXT_USAGE_RATIO, RESPONSE_BUFFER_TOKENS, MAP_REDUCE_CHUNK_DELAY_MS, KNOWLEDGE_MAX_CHUNK_BUDGET } from '@/lib/constants';
import { buildKnowledgePrompt } from '@/lib/prompts';
import { buildKnowledgePipeline } from '@/lib/pipeline-builder';
import { createRunGuard } from '@/lib/run-guard';
import { normalizeCategories } from '@/lib/category-normalizer';
import { useLLM } from './useLLM';
import { usePipeline } from './usePipeline';
import { useTopicStore } from './useTopicStore';
import { useOptimisticUpdate } from './useOptimisticUpdate';

// F33: per-segment view model (derived, never cached)
export interface KnowledgeSegmentView {
  segmentIndex: number;
  startPage: number;
  endPage: number;
  postCount: number;
  status: 'pending' | 'extracting' | 'done' | 'partial';
  chunks: KnowledgeChunk[];
  rawEntryCount: number;
  lastExtractedAt: number | null;
}

export function useKnowledge(store: ReturnType<typeof useTopicStore>) {
  const { extractKnowledgeChunkTask, reduceKnowledgeChunksTask, cancelTask, getTaskState, checkLLMConfigured } = useLLM();
  const pl = usePipeline();
  const { optimisticUpdate } = useOptimisticUpdate(store);

  // --- Reactive state ---
  const entries = ref<KnowledgeEntry[]>([]);
  const loadedTopicUrl = ref<string | null>(null);
  const isLoading = ref(false);

  watch(isLoading, (val) => {
    store.setCurrentOperation('extract', val);
  });
  const error = ref('');
  const llmTaskId = ref<string | null>(null);
  const currentChunkIndex = ref(0);
  const totalChunks = ref(0);
  const currentPhase = ref<'idle' | 'extracting' | 'reducing'>('idle');
  const currentConfig = ref<LLMConfig | null>(null);
  const confirmTarget = ref<'extract' | 'restore' | 'reduce' | null>(null);
  const showClearDataAction = ref(false);
  const truncationWarning = ref(0);  // count of truncated chunks in last run

  // --- Non-reactive ---
  const knowledgeGuard = createRunGuard();

  // F33: tracks which segment is currently being extracted (null = idle/global extract)
  const activeKnowledgeSegmentIndex = ref<number | null>(null);
  // F33: true while extractAllSegments is iterating (including idle gaps between segments)
  const isBatchExtracting = ref(false);

  // --- Computed ---
  const cachedTopic = computed(() => store.selectedTopic.value);

  const activePipeline = computed(() => {
    if (llmTaskId.value) {
      const task = getTaskState(llmTaskId.value);
      if (task?.pipeline) return task.pipeline;
    }
    return pl.pipeline.value;
  });

  const allPosts = computed<ScrapedPost[]>(() => {
    const ct = cachedTopic.value as CachedTopic | null;
    if (!ct) return [];
    const posts = ct.posts?.length
      ? ct.posts
      : ct.segments?.flatMap(s => s.posts ?? []) ?? [];
    return [...posts] as ScrapedPost[];
  });

  const canRestore = computed(() => {
    const ct = cachedTopic.value;
    return !!ct?.knowledgeChunks?.length && !entries.value.some(e => !e.saved);
  });

  const estimatedExtractApiCalls = computed(() => {
    if (!allPosts.value.length || !currentConfig.value || isLoading.value) return 0;
    const model = currentConfig.value.model;
    const chunks = planKnowledgeChunks(allPosts.value, model, currentConfig.value.contextWindow, knowledgeMaxTokens.value, currentConfig.value.thinkingEnabled, currentConfig.value.thinkingBudget);
    return estimateExtractCalls(chunks.length);
  });

  const estimatedExtractCost = computed<CostEstimate | null>(() => {
    if (!allPosts.value.length || !currentConfig.value || isLoading.value) return null;
    const model = currentConfig.value.model;
    const chunks = planKnowledgeChunks(allPosts.value, model, currentConfig.value.contextWindow, knowledgeMaxTokens.value, currentConfig.value.thinkingEnabled, currentConfig.value.thinkingBudget);
    if (!chunks.length) return null;
    const totalTokens = allPosts.value.reduce((sum, p) => sum + estimateTokens(p.content), 0);
    const avgChunkTokens = Math.round(totalTokens / chunks.length);
    const maxOutput = knowledgeMaxTokens.value ?? getModelMaxOutput(model);
    return estimateExtractCost(chunks.length, avgChunkTokens, model, maxOutput);
  });

  const showExtractCostWarning = computed(() => estimatedExtractApiCalls.value > LLM_WARN_THRESHOLD_CALLS);

  const estimatedRestoreApiCalls = computed(() => {
    if (!canRestore.value) return 0;
    const len = cachedTopic.value?.knowledgeChunks?.length ?? 0;
    return len <= 1 ? 0 : len;
  });

  const estimatedRestoreCost = computed<CostEstimate | null>(() => {
    if (!canRestore.value || !currentConfig.value) return null;
    const len = cachedTopic.value?.knowledgeChunks?.length ?? 0;
    if (!len) return null;
    const model = currentConfig.value.model;
    const apiCalls = len <= 1 ? 0 : len;
    if (apiCalls === 0) return null;
    const maxOutput = knowledgeMaxTokens.value ?? getModelMaxOutput(model);
    // avg chunk tokens: approximate from existing chunks or use default
    const chunks = cachedTopic.value?.knowledgeChunks ?? [];
    const avgTokens = chunks.length > 0 ? Math.round(chunks.reduce((s, c) => s + c.entries.length * 200, 0) / chunks.length) : 2000;
    return estimateExtractCost(len, avgTokens, model, maxOutput);
  });

  const showRestoreCostWarning = computed(() => estimatedRestoreApiCalls.value > LLM_WARN_THRESHOLD_CALLS);

  const estimatedReduceCost = computed<CostEstimate | null>(() => {
    if (!currentConfig.value) return null;
    const chunks = (cachedTopic.value?.knowledgeChunks ?? []).filter(c => c.entries.length > 0);
    if (!chunks.length) return null;
    // Single chunk → enrichEntries in memory, no API calls
    if (chunks.length === 1) return null;
    const model = currentConfig.value.model;
    const maxOutput = knowledgeMaxTokens.value ?? currentConfig.value?.maxTokens ?? 2000;
    const maxPerCall = calcMaxOutputEntries(maxOutput);
    const totalEntries = chunks.reduce((s, c) => s + c.entries.length, 0);
    const preReduceGroups = Math.ceil(totalEntries / (maxPerCall * 4));
    const apiCalls = preReduceGroups + 1;
    // Rough avg input tokens per pre-reduce group
    const avgTokens = Math.round(Math.min(maxPerCall * 4, totalEntries) * 200);
    return buildCostEstimate(apiCalls, avgTokens * apiCalls, Math.round(apiCalls * maxOutput * 0.6), model);
  });

  // Effective max output tokens for knowledge flow — uses dedicated field with fallback to summarize
  const knowledgeMaxTokens = computed(() =>
    currentConfig.value?.knowledgeMaxTokens ?? currentConfig.value?.maxTokens,
  );

  // F33: per-segment extraction views derived from cached topic
  const knowledgeSegments = computed<KnowledgeSegmentView[]>(() => {
    const segs = cachedTopic.value?.segments ?? [];
    const chunks = (cachedTopic.value?.knowledgeChunks ?? []) as KnowledgeChunk[];
    return segs.reduce<KnowledgeSegmentView[]>((acc, seg, i) => {
      if (!seg) return acc;
      const segChunks = chunks.filter(c => c.segmentIndex === i);
      const hasFailed = segChunks.some(c => c.failed);
      let status: KnowledgeSegmentView['status'];
      if (activeKnowledgeSegmentIndex.value === i) {
        status = 'extracting';
      } else if (segChunks.length === 0) {
        status = 'pending';
      } else if (hasFailed) {
        status = 'partial';
      } else {
        status = 'done';
      }
      const rawEntryCount = segChunks.reduce((sum, c) => sum + c.entries.length, 0);
      const lastExtractedAt = segChunks.length > 0
        ? Math.max(...segChunks.map(c => c.extractedAt))
        : null;
      acc.push({
        segmentIndex: i,
        startPage: seg.startPage,
        endPage: seg.endPage,
        postCount: seg.posts?.length ?? 0,
        status,
        chunks: segChunks,
        rawEntryCount,
        lastExtractedAt,
      });
      return acc;
    }, []);
  });

  // F33: true when any chunk was extracted AFTER the last reduce (entries are stale)
  const isReduceStale = computed(() => {
    const reducedAt = cachedTopic.value?.knowledgeReducedAt;
    if (!reducedAt) return false;
    const chunks = (cachedTopic.value?.knowledgeChunks ?? []) as KnowledgeChunk[];
    return chunks.some(c => !c.failed && c.extractedAt > reducedAt);
  });

  // F33: true if there are extracted segment chunks (entries exist pre-reduce)
  const hasAnyExtractedSegment = computed(() => {
    const chunks = (cachedTopic.value?.knowledgeChunks ?? []) as KnowledgeChunk[];
    return chunks.some(c => c.segmentIndex !== undefined && !c.failed);
  });

  // --- Helpers ---

  function enrichEntries(newEntries: KnowledgeEntry[]): KnowledgeEntry[] {
    const postMap = new Map(allPosts.value.map(p => [p.postNumber, p]));
    const normalized = normalizeCategories(newEntries);
    return normalized.map(e => {
      const post = postMap.get(e.source.postNumber);
      return post?.timestamp ? { ...e, source: { ...e.source, timestamp: post.timestamp } } : e;
    });
  }

  function mergeSavedWithFresh(saved: KnowledgeEntry[], fresh: KnowledgeEntry[]): KnowledgeEntry[] {
    const freshByPostNum = new Set(fresh.map(e => e.source.postNumber));
    const savedNotInFresh = saved.filter(e => !freshByPostNum.has(e.source.postNumber));
    return [...savedNotInFresh, ...fresh];
  }

  function clientSideDedup(entries: KnowledgeEntry[]): KnowledgeEntry[] {
    const seen = new Set<string>();
    return entries.filter(e => {
      const key = e.title.toLowerCase().replace(/[^\p{L}\d]/gu, '').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function calcMaxOutputEntries(maxOutputTokens: number): number {
    // Dùng maxOutputTokens (knowledgeMaxTokens) thay vì contextLimit:
    // contextLimit là input budget, không phải output budget.
    // 700 tokens/entry thay vì 500: thực tế entry dài có thể đạt 700-1000 tokens
    // (title + content chi tiết + tags + source + JSON overhead). 500 gây underestimate
    // dẫn đến cap quá lớn → completion_tokens vượt max khi LLM trả về entries verbose.
    const TOKENS_PER_ENTRY_REDUCE = 700;
    return Math.max(2, Math.floor(maxOutputTokens * 0.8 / TOKENS_PER_ENTRY_REDUCE));
  }

  // F33: find which segment index a post belongs to (undefined if no segments / not found)
  function findSegmentForPost(
    postNumber: number,
    segments: ReadonlyArray<{ posts?: ReadonlyArray<{ postNumber: number }> }>,
  ): number | undefined {
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].posts?.some(p => p.postNumber === postNumber)) return i;
    }
    return undefined;
  }

  /**
   * @deprecated Legacy resume logic for full-thread (non-segment) extraction.
   * Segment-mode topics use per-segment resume via computeSegmentResumeState() instead.
   */
  function computeKnowledgeResumeState(): {
    startFromPostNumber: number;
    existingChunks: KnowledgeChunk[];
  } {
    const chunks = (cachedTopic.value?.knowledgeChunks ?? []) as KnowledgeChunk[];
    if (chunks.length === 0) return { startFromPostNumber: 0, existingChunks: [] };

    // If any chunk is marked failed, resume from the first failed chunk
    const firstFailedIdx = chunks.findIndex(c => c.failed);
    if (firstFailedIdx !== -1) {
      return {
        startFromPostNumber: chunks[firstFailedIdx].startPostNumber,
        existingChunks: chunks.slice(0, firstFailedIdx),
      };
    }

    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk.complete === false) {
      return {
        startFromPostNumber: lastChunk.startPostNumber,
        existingChunks: chunks.slice(0, -1),
      };
    }
    return {
      startFromPostNumber: lastChunk.endPostNumber + 1,
      existingChunks: [...chunks],
    };
  }

  async function persistChunks(chunks: KnowledgeChunk[], guardId: number, topicUrl: string): Promise<void> {
    if (knowledgeGuard.isStale(guardId)) return;
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: topicUrl,
      knowledgeChunks: chunks,
    }).catch(() => {});

    if (cachedTopic.value?.url === topicUrl) {
      store.updateSelectedTopic({
        knowledgeChunks: [...chunks],
        lastKnowledgePostNumber: chunks.length > 0
          ? chunks[chunks.length - 1].endPostNumber
          : cachedTopic.value.lastKnowledgePostNumber,
      });
    }
  }

  // --- Internal orchestration ---

  // F33: resume state for a single segment's existing chunks
  function computeSegmentResumeState(
    segmentExistingChunks: KnowledgeChunk[],
    segmentPosts: ScrapedPost[],
  ): { startFromPostNumber: number; resumeChunks: KnowledgeChunk[] } {
    if (segmentExistingChunks.length === 0) {
      return { startFromPostNumber: segmentPosts[0]?.postNumber ?? 0, resumeChunks: [] };
    }
    const firstFailed = segmentExistingChunks.findIndex(c => c.failed);
    if (firstFailed !== -1) {
      return {
        startFromPostNumber: segmentExistingChunks[firstFailed].startPostNumber,
        resumeChunks: segmentExistingChunks.slice(0, firstFailed),
      };
    }
    const last = segmentExistingChunks[segmentExistingChunks.length - 1];
    if (last.complete === false) {
      return {
        startFromPostNumber: last.startPostNumber,
        resumeChunks: segmentExistingChunks.slice(0, -1),
      };
    }
    return { startFromPostNumber: last.endPostNumber + 1, resumeChunks: [...segmentExistingChunks] };
  }

  /**
   * F33: Shared chunk extraction loop — used by handleExtract and extractSegment.
   * @param postsToProcess  posts to extract (already filtered/sorted)
   * @param existingChunks  chunks already extracted in this run (resume support); their .index starts at 0
   * @param guardId         run guard ID
   * @param topicUrl        topic URL for persistence
   * @param topicTitle      topic title for LLM prompt
   * @param segmentIdx      if provided, stamps segmentIndex on each new chunk; if undefined, auto-detects from topic segments
   * @param prefixChunks    additional chunks to prepend when persisting (other segments' chunks)
   */
  async function runChunkExtraction(
    postsToProcess: ScrapedPost[],
    existingChunks: KnowledgeChunk[],
    guardId: number,
    topicUrl: string,
    topicTitle: string,
    segmentIdx?: number,
    prefixChunks: KnowledgeChunk[] = [],
  ): Promise<{ allChunks: KnowledgeChunk[]; truncatedCount: number }> {
    const chunkPlan = planKnowledgeChunks(
      postsToProcess,
      currentConfig.value?.model,
      currentConfig.value?.contextWindow,
      knowledgeMaxTokens.value,
      currentConfig.value?.thinkingEnabled,
      currentConfig.value?.thinkingBudget,
    );

    const totalExtracts = existingChunks.length + chunkPlan.length;
    pl.pipeline.value = buildKnowledgePipeline(totalExtracts);
    for (let j = 0; j < existingChunks.length; j++) {
      pl.markDone(`extract_${j}`);
    }
    pl.markFirstRunning();

    let budget = calculateSegmentBudget(
      currentConfig.value?.model,
      KNOWLEDGE_CHUNK_PROMPT_TOKENS,
      2000,
      currentConfig.value?.contextWindow,
    );
    budget = Math.min(budget, KNOWLEDGE_MAX_CHUNK_BUDGET);

    const newChunks: KnowledgeChunk[] = [...existingChunks];
    totalChunks.value = totalExtracts;
    let truncatedCount = 0;

    const topicSegments = cachedTopic.value?.segments ?? [];

    for (let i = 0; i < chunkPlan.length; i++) {
      if (knowledgeGuard.isStale(guardId)) return { allChunks: newChunks, truncatedCount };
      currentChunkIndex.value = newChunks.length;
      currentPhase.value = 'extracting';

      const segId = `extract_${newChunks.length}`;
      pl.markRunning(segId);

      const { startIndex, endIndex } = chunkPlan[i];
      const chunkPosts = postsToProcess.slice(startIndex, endIndex + 1);
      const isLastChunk = i === chunkPlan.length - 1;

      const { taskId, result } = extractKnowledgeChunkTask(chunkPosts, topicTitle);
      llmTaskId.value = taskId;
      const st = getTaskState(taskId);
      if (st && pl.pipeline.value) st.pipeline = JSON.parse(JSON.stringify(pl.pipeline.value));

      const llmResult = await result;
      if (knowledgeGuard.isStale(guardId)) return { allChunks: newChunks, truncatedCount };
      pl.markDone(segId);
      const ft = getTaskState(taskId);
      if (ft?.pipeline) pl.pipeline.value = JSON.parse(JSON.stringify(ft.pipeline));

      const wasTruncated = (llmResult.data as { truncated?: boolean })?.truncated === true;
      if (wasTruncated) truncatedCount++;

      const chunkEntries = enrichEntries(
        ((llmResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [],
      );
      const chunkTokens = chunkPosts.reduce(
        (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
        0,
      );

      // F33: auto-detect segmentIndex from topic segments if not explicitly provided
      const resolvedSegIdx = segmentIdx !== undefined
        ? segmentIdx
        : findSegmentForPost(chunkPosts[0].postNumber, topicSegments);

      newChunks.push({
        index: newChunks.length,
        startPostNumber: chunkPosts[0].postNumber,
        endPostNumber: chunkPosts[chunkPosts.length - 1].postNumber,
        entries: chunkEntries,
        extractedAt: Date.now(),
        complete: isLastChunk ? (chunkTokens >= budget * 0.8) : true,
        failed: wasTruncated || undefined,
        segmentIndex: resolvedSegIdx,
      });

      // Persist full set: prefix (other segments) + this run's chunks
      await persistChunks([...prefixChunks, ...newChunks], guardId, topicUrl);
    }

    return { allChunks: newChunks, truncatedCount };
  }

  /**
   * @deprecated Legacy single-call extraction for short non-segment threads.
   * Not used by segment-mode flow.
   */
  async function runDirectExtract(
    postsToProcess: ScrapedPost[],
    guardId: number,
    topicUrl: string,
    topicTitle: string,
  ): Promise<void> {
    currentPhase.value = 'extracting';
    pl.pipeline.value = buildKnowledgePipeline(1);
    pl.markFirstRunning();
    const { taskId, result } = extractKnowledgeChunkTask(postsToProcess, topicTitle, 'extract');
    llmTaskId.value = taskId;
    const st = getTaskState(taskId);
    if (st && pl.pipeline.value) st.pipeline = JSON.parse(JSON.stringify(pl.pipeline.value));
    const llmResult = await result;
    if (knowledgeGuard.isStale(guardId)) return;
    pl.markDone('extract_0');

    const newEntries = enrichEntries(
      ((llmResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [],
    );

    const budget = calculateSegmentBudget(
      currentConfig.value?.model,
      KNOWLEDGE_CHUNK_PROMPT_TOKENS,
      2000,
      currentConfig.value?.contextWindow,
    );
    const chunkTokens = postsToProcess.reduce(
      (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
      0,
    );
    const chunk: KnowledgeChunk = {
      index: 0,
      startPostNumber: postsToProcess[0].postNumber,
      endPostNumber: postsToProcess[postsToProcess.length - 1].postNumber,
      entries: newEntries,
      extractedAt: Date.now(),
      complete: chunkTokens >= budget * 0.8,
    };

    // Persist raw chunk immediately — never lose LLM output even if save below fails
    await persistChunks([chunk], guardId, topicUrl);

    const savedEntries = entries.value.filter(e => e.saved);
    const excludedNums = new Set(cachedTopic.value?.excludedKnowledgePostNumbers ?? []);
    const filteredNew = newEntries.filter(e => !excludedNums.has(e.source.postNumber));
    const merged = mergeSavedWithFresh(savedEntries, filteredNew);

    const savedMerged = merged.filter(e => e.saved);
    entries.value = merged;
    store.updateSelectedTopic({ knowledgeEntries: savedMerged });
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: topicUrl,
      knowledgeEntries: savedMerged,
      knowledgeChunks: [chunk],
      lastKnowledgePostNumber: chunk.endPostNumber,
    }).catch(() => {});
    sendMessage('INSERT_KNOWLEDGE_WITH_DEDUP', { entries: newEntries, topic: { url: topicUrl, title: topicTitle } }).catch(() => {});
  }

  function updateReduceStepLabel(label: string): void {
    const step = pl.pipeline.value?.steps.find(s => s.id === 'reduce');
    if (step) step.label = label;
  }

  async function runReducePhase(
    chunks: KnowledgeChunk[],
    excludedNums: Set<number>,
    guardId: number,
    topicUrl: string,
  ): Promise<void> {
    currentPhase.value = 'reducing';
    const allPartial = chunks.map(c => c.entries);
    const totalPosts = cachedTopic.value?.totalPosts ?? chunks.reduce((s, c) => s + (c.endPostNumber - c.startPostNumber + 1), 0);
    const finalCap = Math.max(3, Math.min(200, Math.ceil(totalPosts / 5)));

    let finalEntries: KnowledgeEntry[];
    if (allPartial.length === 1) {
      finalEntries = enrichEntries(allPartial[0]);
    } else {
      const model = currentConfig.value?.model;
      const contextLimit = getContextLimit(model, currentConfig.value?.contextWindow);
      const maxOutput = knowledgeMaxTokens.value ?? currentConfig.value?.maxTokens ?? 2000;
      const promptOverhead = estimateTokens(buildKnowledgePrompt('reduce', {}, finalCap)) + RESPONSE_BUFFER_TOKENS;
      // Input must fit within: context_window - max_output_tokens (not just 75% of context_window)
      const usableTokens = Math.floor((contextLimit - maxOutput) * CONTEXT_USAGE_RATIO) - promptOverhead;
      const totalTokens = estimateTokens(JSON.stringify(allPartial)) * 1.4;

      const maxPerCall = calcMaxOutputEntries(knowledgeMaxTokens.value ?? currentConfig.value?.maxTokens ?? 2000);

      let entriesToReduce = allPartial;

      if (totalTokens > usableTokens && allPartial.length >= 2) {
        const allFlatEntries = allPartial.flat();
        const entriesPerGroup = maxPerCall * 4;
        const flatGroups: KnowledgeEntry[][] = [];

        for (let i = 0; i < allFlatEntries.length; i += entriesPerGroup) {
          flatGroups.push(allFlatEntries.slice(i, i + entriesPerGroup));
        }

        if (flatGroups.length > 0) {
          const groupResults: KnowledgeEntry[][] = [];
          for (let g = 0; g < flatGroups.length; g++) {
            if (knowledgeGuard.isStale(guardId)) return;
            updateReduceStepLabel(`Gộp sơ bộ (${g + 1}/${flatGroups.length})`);
            const { taskId, result } = reduceKnowledgeChunksTask([flatGroups[g]], maxPerCall);
            llmTaskId.value = taskId;
            const st = getTaskState(taskId);
            if (st && pl.pipeline.value) {
              st.pipeline = JSON.parse(JSON.stringify(pl.pipeline.value));
            }
            const groupResult = await result;
            if (knowledgeGuard.isStale(guardId)) return;
            groupResults.push(
              ((groupResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [],
            );
            if (g < flatGroups.length - 1) {
              await new Promise(r => setTimeout(r, MAP_REDUCE_CHUNK_DELAY_MS));
            }
          }
          entriesToReduce = groupResults;
        }
      }

      let rawFinalEntries: KnowledgeEntry[];
      if (finalCap <= maxPerCall) {
        const { taskId, result } = reduceKnowledgeChunksTask(entriesToReduce, finalCap);
        llmTaskId.value = taskId;
        const st = getTaskState(taskId);
        if (st && pl.pipeline.value) {
          st.pipeline = JSON.parse(JSON.stringify(pl.pipeline.value));
        }
        const reduceResult = await result;
        if (knowledgeGuard.isStale(guardId)) return;
        const wasTruncated = (reduceResult.data as { truncated?: boolean })?.truncated === true;
        if (wasTruncated) truncationWarning.value++;
        rawFinalEntries = ((reduceResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [];
      } else {
        const numCalls = Math.ceil(finalCap / maxPerCall);
        const groupSize = Math.ceil(entriesToReduce.length / numCalls);
        const allRaw: KnowledgeEntry[] = [];

        for (let g = 0; g < entriesToReduce.length; g += groupSize) {
          if (knowledgeGuard.isStale(guardId)) return;
          const callIndex = Math.floor(g / groupSize) + 1;
          updateReduceStepLabel(`Gộp kiến thức (${callIndex}/${numCalls})`);
          const group = entriesToReduce.slice(g, g + groupSize);
          const { taskId, result } = reduceKnowledgeChunksTask(group, maxPerCall);
          llmTaskId.value = taskId;
          const st = getTaskState(taskId);
          if (st && pl.pipeline.value) {
            st.pipeline = JSON.parse(JSON.stringify(pl.pipeline.value));
          }
          const groupResult = await result;
          if (knowledgeGuard.isStale(guardId)) return;
          const wasTruncated = (groupResult.data as { truncated?: boolean })?.truncated === true;
          if (wasTruncated) truncationWarning.value++;
          allRaw.push(
            ...((groupResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [],
          );
          if (g + groupSize < entriesToReduce.length) {
            await new Promise(r => setTimeout(r, MAP_REDUCE_CHUNK_DELAY_MS));
          }
        }
        rawFinalEntries = clientSideDedup(allRaw);
      }
      finalEntries = enrichEntries(rawFinalEntries);
    }

    // Early save: persist raw reduce output immediately so LLM investment is never lost
    const rawFiltered = finalEntries.filter(e => !excludedNums.has(e.source.postNumber));
    sendMessage('SAVE_CACHED_TOPIC', {
      url: topicUrl,
      knowledgeEntries: rawFiltered,
      knowledgeChunks: chunks,
      lastKnowledgePostNumber: chunks[chunks.length - 1].endPostNumber,
    }).catch(() => {});

    if (finalEntries.length === 0) {
      throw new Error('Gộp kiến thức không trả về kết quả. LLM có thể trả về dữ liệu không hợp lệ — vui lòng thử lại hoặc tăng Context window trong Cài đặt.');
    }

    const filteredFinal = finalEntries.filter(e => !excludedNums.has(e.source.postNumber));

    const savedEntries = entries.value.filter(e => e.saved);
    const merged = mergeSavedWithFresh(savedEntries, filteredFinal);

    const savedMerged = merged.filter(e => e.saved);
    entries.value = merged;
    store.updateSelectedTopic({ knowledgeEntries: savedMerged });
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: topicUrl,
      knowledgeEntries: savedMerged,
      knowledgeChunks: chunks,
      lastKnowledgePostNumber: chunks[chunks.length - 1].endPostNumber,
    }).catch(() => {});
    sendMessage('INSERT_KNOWLEDGE_WITH_DEDUP', { entries: finalEntries, topic: { url: topicUrl, title: cachedTopic.value?.title ?? '' } }).catch(() => {});
  }

  // --- Public orchestration functions ---

  /**
   * @deprecated Legacy full-thread extraction. Processes all posts as one flat batch without segment
   * awareness. For segment-mode topics use extractSegment() / extractAllSegments() instead.
   * Still used for non-segment topics and the "Trích xuất lại tất cả" power-user dropdown.
   */
  async function handleExtract() {
    confirmTarget.value = null;
    if (!allPosts.value.length) return;
    if (isLoading.value) return;

    const configCheck = await checkLLMConfigured();
    if (!configCheck.ok) { error.value = configCheck.error!; return; }

    const guardId = knowledgeGuard.begin();
    error.value = '';
    isLoading.value = true;
    currentPhase.value = 'extracting';
    currentChunkIndex.value = 0;
    totalChunks.value = 0;
    truncationWarning.value = 0;

    if (!currentConfig.value) {
      const cfg = await sendMessage<LLMConfig>('GET_SETTINGS').catch(() => null);
      if (cfg) currentConfig.value = cfg;
    }

    try {
      const topicUrl = cachedTopic.value?.url;
      const topicTitle = cachedTopic.value?.title;
      if (!topicUrl || !topicTitle) return;

      const resume = computeKnowledgeResumeState();

      if (resume.existingChunks.length === 0 && resume.startFromPostNumber === 0) {
        // Search/filter state will be reset by KnowledgeView based on this condition
      }

      const excludedNums = new Set(cachedTopic.value?.excludedKnowledgePostNumbers ?? []);

      const postsToProcess = allPosts.value
        .filter(p => p.postNumber >= resume.startFromPostNumber && !excludedNums.has(p.postNumber))
        .sort((a, b) => a.postNumber - b.postNumber);

      if (postsToProcess.length === 0) {
        const existingChunks = resume.existingChunks;
        const allChunks = (cachedTopic.value?.knowledgeChunks ?? []) as KnowledgeChunk[];
        // Detect if failed chunks were found but their posts can't be located in allPosts
        // (e.g. posts were re-scraped, allPosts shrank, or cache lost post data).
        const hasMissingFailedPosts =
          allChunks.some(c => c.failed) && existingChunks.length < allChunks.length;

        if (hasMissingFailedPosts) {
          // Failed chunks detected but no posts available to re-extract them
          error.value =
            'Không tìm thấy bài viết cho các đoạn bị lỗi. Vui lòng scrape lại bài viết từ diễn đàn.';
        } else if (existingChunks.length > 0 && entries.value.length === 0) {
          // All posts already extracted but reduce hasn't produced entries yet — run reduce
          currentPhase.value = 'reducing';
          pl.pipeline.value = buildKnowledgePipeline(existingChunks.length);
          for (let j = 0; j < existingChunks.length; j++) {
            pl.markDone(`extract_${j}`);
          }
          pl.markRunning('reduce');
          await runReducePhase(existingChunks, excludedNums, guardId, topicUrl);
          pl.markDone('reduce');
          await optimisticUpdate({ knowledgeReducedAt: Date.now() });
        } else {
          error.value = 'Không có bài viết mới để trích xuất kiến thức.';
        }
        return;
      }

      let budget = calculateSegmentBudget(
        currentConfig.value?.model,
        KNOWLEDGE_CHUNK_PROMPT_TOKENS,
        2000,
        currentConfig.value?.contextWindow,
      );
      budget = Math.min(budget, KNOWLEDGE_MAX_CHUNK_BUDGET);
      const totalTokens = postsToProcess.reduce(
        (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
        0,
      );

      if (totalTokens <= budget && resume.existingChunks.length === 0) {
        // Direct path — single call, no reduce
        await runDirectExtract(postsToProcess, guardId, topicUrl, topicTitle);
        return;
      }

      // Chunked path — delegate to shared helper (Task 285)
      const { allChunks: newChunks, truncatedCount } = await runChunkExtraction(
        postsToProcess, resume.existingChunks, guardId, topicUrl, topicTitle,
      );

      if (knowledgeGuard.isStale(guardId)) return;
      pl.markRunning('reduce');
      await runReducePhase(newChunks, excludedNums, guardId, topicUrl);
      pl.markDone('reduce');
      // F33: persist timestamp so staleness detection works
      await optimisticUpdate({ knowledgeReducedAt: Date.now() });

      if (truncatedCount > 0) {
        truncationWarning.value = truncatedCount;
      }
    } catch (err) {
      if (knowledgeGuard.isStale(guardId)) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (knowledgeGuard.isStale(guardId)) return;
      isLoading.value = false;
      llmTaskId.value = null;
      currentPhase.value = 'idle';
      currentChunkIndex.value = 0;
      totalChunks.value = 0;
    }
  }

  async function handleRestore() {
    confirmTarget.value = null;
    showClearDataAction.value = false;
    const topicUrl = cachedTopic.value?.url;
    if (!topicUrl) return;
    const rawChunks = cachedTopic.value?.knowledgeChunks;
    if (!rawChunks?.length) return;
    const chunks = rawChunks.map(c => ({ ...c, entries: [...c.entries] })) as KnowledgeChunk[];
    if (isLoading.value) return;

    const guardId = knowledgeGuard.begin();
    error.value = '';
    isLoading.value = true;
    currentPhase.value = 'reducing';
    currentChunkIndex.value = 0;
    totalChunks.value = 0;
    truncationWarning.value = 0;

    if (!currentConfig.value) {
      const cfg = await sendMessage<LLMConfig>('GET_SETTINGS').catch(() => null);
      if (cfg) currentConfig.value = cfg;
    }

    try {
      // Restore ignores exclusions — user explicitly wants everything back
      const excludedNums = new Set<number>();
      // Build pipeline: mark existing extract steps done, reduce running
      pl.pipeline.value = buildKnowledgePipeline(chunks.length);
      for (let j = 0; j < chunks.length; j++) {
        pl.markDone(`extract_${j}`);
      }
      pl.markRunning('reduce');
      await runReducePhase(chunks, excludedNums, guardId, topicUrl);
      store.updateSelectedTopic({ excludedKnowledgePostNumbers: [] });
      await sendMessage('SAVE_CACHED_TOPIC', { url: topicUrl, excludedKnowledgePostNumbers: [] }).catch(() => {});
      pl.markDone('reduce');
    } catch (err) {
      if (knowledgeGuard.isStale(guardId)) return;
      const msg = err instanceof Error ? err.message : String(err);
      error.value = msg;
      if (msg.includes('Gộp kiến thức không trả về kết quả')) {
        showClearDataAction.value = true;
      }
    } finally {
      if (knowledgeGuard.isStale(guardId)) return;
      isLoading.value = false;
      llmTaskId.value = null;
      currentPhase.value = 'idle';
      currentChunkIndex.value = 0;
      totalChunks.value = 0;
    }
  }

  function handleCancel() {
    if (llmTaskId.value) cancelTask(llmTaskId.value);
    knowledgeGuard.begin();
    isLoading.value = false;
    llmTaskId.value = null;
    currentPhase.value = 'idle';
    currentChunkIndex.value = 0;
    totalChunks.value = 0;
    isBatchExtracting.value = false;  // stop batch loop if running
    activeKnowledgeSegmentIndex.value = null;  // unblock stuck segment UI after cancel
  }

  /** F33: Extract all pending/partial segments sequentially. Cancellable via handleCancel(). */
  async function extractAllSegments(): Promise<void> {
    const segs = cachedTopic.value?.segments;
    if (!segs?.length || isLoading.value || isBatchExtracting.value) return;

    const configCheck = await checkLLMConfigured();
    if (!configCheck.ok) { error.value = configCheck.error!; return; }

    const toProcess = knowledgeSegments.value
      .filter(s => s.status === 'pending' || s.status === 'partial')
      .map(s => s.segmentIndex);

    if (toProcess.length === 0) return;

    isBatchExtracting.value = true;
    truncationWarning.value = 0;
    try {
      for (const segIdx of toProcess) {
        if (!isBatchExtracting.value) break;
        await extractSegment(segIdx);
        if (!isBatchExtracting.value) break;
      }
    } finally {
      isBatchExtracting.value = false;
    }
  }

  async function handleClearKnowledgeData() {
    await optimisticUpdate({
      knowledgeChunks: [],
      knowledgeEntries: [],
      lastKnowledgePostNumber: 0,
      excludedKnowledgePostNumbers: [],
    });
    showClearDataAction.value = false;
    error.value = '';
  }

  // Notebook is the single source of truth for `saved` (F41). Update the local
  // flag for instant UI, then upsert/remove the notebook entry. On reload the
  // flag is re-derived from the notebook (see KnowledgeView.applySavedFlag).
  async function toggleSave(entry: KnowledgeEntry) {
    const next = !entry.saved;
    entries.value = entries.value.map(e =>
      e.id === entry.id ? { ...e, saved: next } : e
    ) as KnowledgeEntry[];

    const topic = cachedTopic.value;
    if (next && topic) {
      const notebookEntry: NotebookEntry = {
        ...entry,
        saved: true,
        sourceTopicUrl: topic.url,
        sourceTopicTitle: topic.title,
        savedAt: Date.now(),
      };
      sendMessageQuiet('UPSERT_NOTEBOOK_ENTRY', notebookEntry);
    } else if (!next) {
      sendMessageQuiet('DELETE_NOTEBOOK_ENTRY', { id: entry.id });
    }
  }


  async function handleDelete(entry: KnowledgeEntry) {
    const updated = entries.value.filter(e => e.id !== entry.id) as KnowledgeEntry[];
    const excluded = [
      ...(cachedTopic.value?.excludedKnowledgePostNumbers ?? []),
      entry.source.postNumber,
    ];
    entries.value = updated;
    const saved = updated.filter(e => e.saved);
    await optimisticUpdate({ knowledgeEntries: saved, excludedKnowledgePostNumbers: excluded });
    if (entry.saved) sendMessageQuiet('DELETE_NOTEBOOK_ENTRY', { id: entry.id });
  }

  async function handleClearTracking() {
    await optimisticUpdate({
      excludedKnowledgePostNumbers: [],
      lastKnowledgePostNumber: 0,
      knowledgeChunks: [],
    });
  }

  // --- F33: per-segment extraction functions ---

  /** Extract knowledge for a single segment by index. Does NOT run reduce. */
  async function extractSegment(segmentIdx: number): Promise<void> {
    const segs = cachedTopic.value?.segments;
    if (!segs?.length || segmentIdx >= segs.length) return;
    if (isLoading.value) return;

    const configCheck = await checkLLMConfigured();
    if (!configCheck.ok) { error.value = configCheck.error!; return; }

    const guardId = knowledgeGuard.begin();
    error.value = '';
    isLoading.value = true;
    currentPhase.value = 'extracting';
    currentChunkIndex.value = 0;
    totalChunks.value = 0;
    activeKnowledgeSegmentIndex.value = segmentIdx;

    if (!currentConfig.value) {
      const cfg = await sendMessage<LLMConfig>('GET_SETTINGS').catch(() => null);
      if (cfg) currentConfig.value = cfg;
    }

    try {
      const topicUrl = cachedTopic.value?.url;
      const topicTitle = cachedTopic.value?.title;
      if (!topicUrl || !topicTitle) return;

      const segmentPosts = [...(segs[segmentIdx].posts ?? [])].sort((a, b) => a.postNumber - b.postNumber);
      const allChunksCurrent = (cachedTopic.value?.knowledgeChunks ?? []) as KnowledgeChunk[];
      const segExistingChunks = allChunksCurrent.filter(c => c.segmentIndex === segmentIdx);
      const otherChunks = allChunksCurrent.filter(c => c.segmentIndex !== segmentIdx);

      const { startFromPostNumber, resumeChunks } = computeSegmentResumeState(segExistingChunks, segmentPosts);

      const excludedNums = new Set(cachedTopic.value?.excludedKnowledgePostNumbers ?? []);
      const postsToExtract = segmentPosts.filter(
        p => p.postNumber >= startFromPostNumber && !excludedNums.has(p.postNumber),
      );

      if (postsToExtract.length === 0) {
        error.value = 'Không có bài viết mới để trích xuất cho đoạn này.';
        return;
      }

      await runChunkExtraction(postsToExtract, resumeChunks, guardId, topicUrl, topicTitle, segmentIdx, otherChunks);
      // Note: runChunkExtraction already persists incrementally with otherChunks as prefix
    } catch (err) {
      if (knowledgeGuard.isStale(guardId)) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (knowledgeGuard.isStale(guardId)) return;
      isLoading.value = false;
      llmTaskId.value = null;
      currentPhase.value = 'idle';
      currentChunkIndex.value = 0;
      totalChunks.value = 0;
      activeKnowledgeSegmentIndex.value = null;
      pl.pipeline.value = null;  // clear extraction-only pipeline (no reduce step used)
    }
  }

  /** Remove all chunks for a specific segment from cache. */
  async function clearSegment(segmentIdx: number): Promise<void> {
    const topicUrl = cachedTopic.value?.url;
    if (!topicUrl) return;
    const guardId = knowledgeGuard.begin();
    const remaining = ((cachedTopic.value?.knowledgeChunks ?? []) as KnowledgeChunk[])
      .filter(c => c.segmentIndex !== segmentIdx);
    await persistChunks(remaining, guardId, topicUrl);
  }

  /** Clear a segment's chunks then re-extract it from scratch. */
  async function reExtractSegment(segmentIdx: number): Promise<void> {
    await clearSegment(segmentIdx);
    await extractSegment(segmentIdx);
  }

  /** Run the reduce phase manually on current chunks (for stale banner "Tổng hợp lại"). */
  async function runReducePhaseManual(): Promise<void> {
    const topicUrl = cachedTopic.value?.url;
    if (!topicUrl) return;
    const chunks = (cachedTopic.value?.knowledgeChunks ?? []) as KnowledgeChunk[];
    if (!chunks.length) return;
    if (isLoading.value) return;

    const configCheck = await checkLLMConfigured();
    if (!configCheck.ok) { error.value = configCheck.error!; return; }

    const guardId = knowledgeGuard.begin();
    error.value = '';
    isLoading.value = true;
    currentPhase.value = 'reducing';
    currentChunkIndex.value = 0;
    totalChunks.value = 0;
    truncationWarning.value = 0;

    if (!currentConfig.value) {
      const cfg = await sendMessage<LLMConfig>('GET_SETTINGS').catch(() => null);
      if (cfg) currentConfig.value = cfg;
    }

    try {
      const excludedNums = new Set(cachedTopic.value?.excludedKnowledgePostNumbers ?? []);
      pl.pipeline.value = buildKnowledgePipeline(chunks.length);
      for (let j = 0; j < chunks.length; j++) pl.markDone(`extract_${j}`);
      pl.markRunning('reduce');
      await runReducePhase(chunks, excludedNums, guardId, topicUrl);
      pl.markDone('reduce');
      await optimisticUpdate({ knowledgeReducedAt: Date.now() });
    } catch (err) {
      if (knowledgeGuard.isStale(guardId)) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (knowledgeGuard.isStale(guardId)) return;
      isLoading.value = false;
      llmTaskId.value = null;
      currentPhase.value = 'idle';
      currentChunkIndex.value = 0;
      totalChunks.value = 0;
    }
  }

  const progressPercent = computed(() =>
    knowledgeSegments?.value?.length > 0
      ? Math.round((knowledgeSegments.value.filter(s => s.status === 'done' || s.status === 'partial').length / knowledgeSegments.value.length) * 100)
      : 0,
  );
  
  return {
    entries,
    loadedTopicUrl,
    isLoading,
    error,
    llmTaskId,
    currentChunkIndex,
    totalChunks,
    currentPhase,
    currentConfig,
    confirmTarget,
    showClearDataAction,
    truncationWarning,
    knowledgeGuard,
    cachedTopic,
    activePipeline,
    canRestore,
    estimatedExtractApiCalls,
    estimatedExtractCost,
    showExtractCostWarning,
    estimatedRestoreApiCalls,
    estimatedRestoreCost,
    showRestoreCostWarning,
    estimatedReduceCost,
    allPosts,
    extractKnowledgeChunkTask,
    reduceKnowledgeChunksTask,
    cancelTask,
    getTaskState,
    pl,
    enrichEntries,
    clientSideDedup,
    mergeSavedWithFresh,
    calcMaxOutputEntries,
    computeKnowledgeResumeState,
    handleExtract,
    handleRestore,
    handleCancel,
    handleClearKnowledgeData,
    toggleSave,
    handleDelete,
    handleClearTracking,
    progressPercent,
    // F33 new exports
    activeKnowledgeSegmentIndex: readonly(activeKnowledgeSegmentIndex),
    isBatchExtracting: readonly(isBatchExtracting),
    knowledgeSegments,
    isReduceStale,
    hasAnyExtractedSegment,
    extractSegment,
    clearSegment,
    reExtractSegment,
    runReducePhaseManual,
    extractAllSegments,
    /** @deprecated Gates handleExtract() — use extractAllSegments() for segment-mode topics. */
    onExtractClick() {
      const est = estimatedExtractCost.value;
      if (!est || (est.costUsd === 0 && est.apiCalls <= 3)) {
        handleExtract();
        return;
      }
      confirmTarget.value = 'extract';
    },
    onRestoreClick() {
      const est = estimatedRestoreCost.value;
      if (!est || (est.costUsd === 0 && est.apiCalls <= 3)) {
        handleRestore();
        return;
      }
      confirmTarget.value = 'restore';
    },
  };
}
