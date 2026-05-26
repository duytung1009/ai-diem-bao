import { ref, computed, watch } from 'vue';
import type { KnowledgeEntry, KnowledgeChunk, LLMConfig, CachedTopic, ScrapedPost, NotebookEntry, CostEstimate } from '@/lib/types';
import { sendMessage, sendMessageQuiet } from '@/lib/messaging';
import { estimateTokens, calculateSegmentBudget, getContextLimit, getModelMaxOutput } from '@/lib/token-estimator';
import { planKnowledgeChunks, KNOWLEDGE_CHUNK_PROMPT_TOKENS } from '@/lib/llm/summarizer';
import { estimateExtractCalls, estimateExtractCost } from '@/lib/llm/cost-estimator';
import { LLM_WARN_THRESHOLD_CALLS, CONTEXT_USAGE_RATIO, RESPONSE_BUFFER_TOKENS, MAP_REDUCE_CHUNK_DELAY_MS, KNOWLEDGE_MAX_CHUNK_BUDGET } from '@/lib/constants';
import { buildKnowledgePrompt } from '@/lib/prompts';
import { buildKnowledgePipeline } from '@/lib/pipeline-builder';
import { createRunGuard } from '@/lib/run-guard';
import { useLLM } from './useLLM';
import { usePipeline } from './usePipeline';
import { useTopicStore } from './useTopicStore';
import { useOptimisticUpdate } from './useOptimisticUpdate';

export function useKnowledge(store: ReturnType<typeof useTopicStore>) {
  const { extractKnowledgeChunkTask, reduceKnowledgeChunksTask, cancelTask, getTaskState } = useLLM();
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
  const confirmTarget = ref<'extract' | 'restore' | null>(null);
  const showClearDataAction = ref(false);

  // --- Non-reactive ---
  const knowledgeGuard = createRunGuard();

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
    const model = currentConfig.value.model ?? 'gpt-4o-mini';
    const chunks = planKnowledgeChunks(allPosts.value, model, currentConfig.value.contextWindow, knowledgeMaxTokens.value, currentConfig.value.thinkingEnabled, currentConfig.value.thinkingBudget);
    return estimateExtractCalls(chunks.length);
  });

  const estimatedExtractCost = computed<CostEstimate | null>(() => {
    if (!allPosts.value.length || !currentConfig.value || isLoading.value) return null;
    const model = currentConfig.value.model ?? 'gpt-4o-mini';
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
    const model = currentConfig.value.model ?? 'gpt-4o-mini';
    const apiCalls = len <= 1 ? 0 : len;
    if (apiCalls === 0) return null;
    const maxOutput = knowledgeMaxTokens.value ?? getModelMaxOutput(model);
    // avg chunk tokens: approximate from existing chunks or use default
    const chunks = cachedTopic.value?.knowledgeChunks ?? [];
    const avgTokens = chunks.length > 0 ? Math.round(chunks.reduce((s, c) => s + c.entries.length * 200, 0) / chunks.length) : 2000;
    return estimateExtractCost(len, avgTokens, model, maxOutput);
  });

  const showRestoreCostWarning = computed(() => estimatedRestoreApiCalls.value > LLM_WARN_THRESHOLD_CALLS);

  // Effective max output tokens for knowledge flow — uses dedicated field with fallback to summarize
  const knowledgeMaxTokens = computed(() =>
    currentConfig.value?.knowledgeMaxTokens ?? currentConfig.value?.maxTokens,
  );

  // --- Helpers ---

  function enrichEntries(newEntries: KnowledgeEntry[]): KnowledgeEntry[] {
    const postMap = new Map(allPosts.value.map(p => [p.postNumber, p]));
    return newEntries.map(e => {
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
    // 0.8 safety margin + 500 tokens/entry (thực tế ~400-600) để tránh JSON bị cắt.
    const TOKENS_PER_ENTRY_REDUCE = 500;
    return Math.max(10, Math.floor(maxOutputTokens * 0.8 / TOKENS_PER_ENTRY_REDUCE));
  }

  function computeKnowledgeResumeState(): {
    startFromPostNumber: number;
    existingChunks: KnowledgeChunk[];
  } {
    const chunks = (cachedTopic.value?.knowledgeChunks ?? []) as KnowledgeChunk[];
    if (chunks.length === 0) return { startFromPostNumber: 0, existingChunks: [] };

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
      currentConfig.value?.model ?? 'gpt-4o-mini',
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
  }

  async function runReducePhase(
    chunks: KnowledgeChunk[],
    excludedNums: Set<number>,
    guardId: number,
    topicUrl: string,
  ): Promise<void> {
    currentPhase.value = 'reducing';
    const allPartial = chunks.map(c => c.entries);
    const dynamicMin = Math.max(chunks.length, 3);
    const finalCap = Math.min(200, Math.max(dynamicMin, chunks.length * 4));

    let finalEntries: KnowledgeEntry[];
    if (allPartial.length === 1) {
      finalEntries = enrichEntries(allPartial[0]);
    } else {
      const model = currentConfig.value?.model ?? 'gpt-4o-mini';
      const contextLimit = getContextLimit(model, currentConfig.value?.contextWindow);
      const promptOverhead = estimateTokens(buildKnowledgePrompt('reduce', {}, finalCap)) + RESPONSE_BUFFER_TOKENS;
      const usableTokens = Math.floor(contextLimit * CONTEXT_USAGE_RATIO) - promptOverhead;
      const totalTokens = estimateTokens(JSON.stringify(allPartial)) * 1.4;

      let entriesToReduce = allPartial;

      if (totalTokens > usableTokens && allPartial.length > 2) {
        const groupCount = Math.max(2, Math.ceil(totalTokens / usableTokens));
        const groupSize = Math.ceil(allPartial.length / groupCount);
        const groupResults: KnowledgeEntry[][] = [];

        for (let g = 0; g < allPartial.length; g += groupSize) {
          if (knowledgeGuard.isStale(guardId)) return;
          const group = allPartial.slice(g, g + groupSize);
          const { taskId, result } = reduceKnowledgeChunksTask(group);
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
          if (g + groupSize < allPartial.length) {
            await new Promise(r => setTimeout(r, MAP_REDUCE_CHUNK_DELAY_MS));
          }
        }
        entriesToReduce = groupResults;
      }

      const maxPerCall = calcMaxOutputEntries(knowledgeMaxTokens.value ?? currentConfig.value?.maxTokens ?? 2000);

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
        rawFinalEntries = ((reduceResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [];
      } else {
        const numCalls = Math.ceil(finalCap / maxPerCall);
        const groupSize = Math.ceil(entriesToReduce.length / numCalls);
        const allRaw: KnowledgeEntry[] = [];

        for (let g = 0; g < entriesToReduce.length; g += groupSize) {
          if (knowledgeGuard.isStale(guardId)) return;
          const group = entriesToReduce.slice(g, g + groupSize);
          const { taskId, result } = reduceKnowledgeChunksTask(group, maxPerCall);
          llmTaskId.value = taskId;
          const st = getTaskState(taskId);
          if (st && pl.pipeline.value) {
            st.pipeline = JSON.parse(JSON.stringify(pl.pipeline.value));
          }
          const groupResult = await result;
          if (knowledgeGuard.isStale(guardId)) return;
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
  }

  // --- Public orchestration functions ---

  async function handleExtract() {
    confirmTarget.value = null;
    if (!allPosts.value.length) return;
    if (isLoading.value) return;

    const guardId = knowledgeGuard.begin();
    error.value = '';
    isLoading.value = true;
    currentPhase.value = 'extracting';
    currentChunkIndex.value = 0;
    totalChunks.value = 0;

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
        if (existingChunks.length > 0) {
          currentPhase.value = 'reducing';
          pl.pipeline.value = buildKnowledgePipeline(existingChunks.length);
          for (let j = 0; j < existingChunks.length; j++) {
            pl.markDone(`extract_${j}`);
          }
          pl.markRunning('reduce');
          await runReducePhase(existingChunks, excludedNums, guardId, topicUrl);
          pl.markDone('reduce');
        } else if (entries.value.length > 0) {
          error.value = 'Không có bài viết mới để trích xuất kiến thức.';
        }
        return;
      }

      let budget = calculateSegmentBudget(
        currentConfig.value?.model ?? 'gpt-4o-mini',
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

      const chunkPlan = planKnowledgeChunks(
        postsToProcess,
        currentConfig.value?.model ?? 'gpt-4o-mini',
        currentConfig.value?.contextWindow,
        knowledgeMaxTokens.value,
        currentConfig.value?.thinkingEnabled,
        currentConfig.value?.thinkingBudget,
      );
      const newChunks: KnowledgeChunk[] = [...resume.existingChunks];
      totalChunks.value = newChunks.length + chunkPlan.length;

      // Build reactive pipeline upfront (mirrors Summary's pl.buildSummarizePipeline)
      const totalSteps = newChunks.length + chunkPlan.length;
      pl.pipeline.value = buildKnowledgePipeline(totalSteps);
      for (let j = 0; j < resume.existingChunks.length; j++) {
        pl.markDone(`extract_${j}`);
      }
      pl.markFirstRunning();

      for (let i = 0; i < chunkPlan.length; i++) {
        if (knowledgeGuard.isStale(guardId)) return;
        currentChunkIndex.value = newChunks.length;
        currentPhase.value = 'extracting';

        const segIdx = newChunks.length;
        const segId = `extract_${segIdx}`;
        pl.markRunning(segId);

        const { startIndex, endIndex } = chunkPlan[i];
        const chunkPosts = postsToProcess.slice(startIndex, endIndex + 1);
        const isLastChunk = i === chunkPlan.length - 1;

        const { taskId, result } = extractKnowledgeChunkTask(chunkPosts, topicTitle);
        llmTaskId.value = taskId;
        const st = getTaskState(taskId);
        if (st && pl.pipeline.value) {
          st.pipeline = JSON.parse(JSON.stringify(pl.pipeline.value));
        }
        const llmResult = await result;
        if (knowledgeGuard.isStale(guardId)) return;
        pl.markDone(segId);
        // Sync back from task state
        const ft = getTaskState(taskId);
        if (ft?.pipeline) pl.pipeline.value = JSON.parse(JSON.stringify(ft.pipeline));

        const chunkEntries = enrichEntries(
          ((llmResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [],
        );

        const chunkTokens = chunkPosts.reduce(
          (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
          0,
        );

        const chunkRecord: KnowledgeChunk = {
          index: newChunks.length,
          startPostNumber: chunkPosts[0].postNumber,
          endPostNumber: chunkPosts[chunkPosts.length - 1].postNumber,
          entries: chunkEntries,
          extractedAt: Date.now(),
          complete: isLastChunk ? (chunkTokens >= budget * 0.8) : true,
        };
        newChunks.push(chunkRecord);

        await persistChunks(newChunks, guardId, topicUrl);
      }

      if (knowledgeGuard.isStale(guardId)) return;
      pl.markRunning('reduce');
      await runReducePhase(newChunks, excludedNums, guardId, topicUrl);
      pl.markDone('reduce');
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

  async function toggleSave(entry: KnowledgeEntry) {
    const next = !entry.saved;
    const updated = entries.value.map(e =>
      e.id === entry.id ? { ...e, saved: next } : e
    ) as KnowledgeEntry[];
    entries.value = updated;
    const saved = updated.filter(e => e.saved);
    await optimisticUpdate({ knowledgeEntries: saved });

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
