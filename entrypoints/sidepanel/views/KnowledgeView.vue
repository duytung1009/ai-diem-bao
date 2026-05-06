<script setup lang="ts">
import { ref, onActivated, computed } from 'vue';
import type { CachedTopic, KnowledgeEntry, KnowledgeChunk, LLMConfig, ScrapedPost } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import { estimateTokens, calculateSegmentBudget, getContextLimit, getThinkingOverhead } from '@/lib/token-estimator';
import { planKnowledgeChunks, KNOWLEDGE_CHUNK_PROMPT_TOKENS } from '@/lib/llm/summarizer';
import { estimateExtractCalls } from '@/lib/llm/cost-estimator';
import { LLM_WARN_THRESHOLD_CALLS, CONTEXT_USAGE_RATIO, RESPONSE_BUFFER_TOKENS, MAP_REDUCE_CHUNK_DELAY_MS, TOKENS_PER_KNOWLEDGE_ENTRY, REDUCE_OUTPUT_FRACTION } from '@/lib/constants';
import { buildKnowledgeReducePrompt } from '@/lib/prompts';
import ProgressIndicator from '../components/ProgressIndicator.vue';
import ConfirmInline from '../components/ConfirmInline.vue';
import { useLLM } from '../composables/useLLM';
import { useTopicStore } from '../composables/useTopicStore';
import { useSummarize } from '../composables/useSummarize';

const { extractKnowledge: runExtract, extractKnowledgeChunkTask, reduceKnowledgeChunksTask, cancelTask } = useLLM();
const store = useTopicStore();
const { topicInfo } = useSummarize(store);

const entries = ref<KnowledgeEntry[]>([]);
const cachedTopic = ref<CachedTopic | null>(null);
const loadedTopicUrl = ref<string | null>(null);
const isLoading = ref(false);
const error = ref('');
const llmTaskId = ref<string | null>(null);
const searchQuery = ref('');
const selectedTags = ref<string[]>([]);
const selectedCategory = ref<string | null>(null);
const expandedIds = ref<Set<string>>(new Set());
const showSavedOnly = ref(false);
const confirmingExtract = ref(false);

// F24: chunked flow state
let activeExtractId = 0;
const currentChunkIndex = ref(0);
const totalChunks = ref(0);
const currentPhase = ref<'idle' | 'extracting' | 'reducing'>('idle');
const currentConfig = ref<LLMConfig | null>(null);

// Cost estimate for extract — skip during active extraction (warning is hidden then anyway)
const estimatedExtractApiCalls = computed(() => {
  if (!allPosts.value.length || !currentConfig.value || isLoading.value) return 0;
  const model = currentConfig.value.model ?? 'gpt-4o-mini';
  const chunks = planKnowledgeChunks(allPosts.value, model, currentConfig.value.contextWindow, currentConfig.value.maxTokens, currentConfig.value.thinkingEnabled, currentConfig.value.thinkingBudget);
  return estimateExtractCalls(chunks.length);
});
const showExtractCostWarning = computed(() => estimatedExtractApiCalls.value > LLM_WARN_THRESHOLD_CALLS);

const TAG_CLASSES: Record<string, string> = {
  'kinh nghiệm': 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400',
  'mẹo': 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
  'cảnh báo': 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
  'thống kê': 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400',
  'so sánh': 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400',
  'hướng dẫn': 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400',
  'đánh giá': 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400',
  'tài nguyên': 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400',
};

function getTagClass(tag: string): string {
  return TAG_CLASSES[tag] ?? 'bg-(--color-bg-muted) text-(--color-text-secondary)';
}

function toggleExpand(id: string) {
  const s = new Set(expandedIds.value);
  s.has(id) ? s.delete(id) : s.add(id);
  expandedIds.value = s;
}

function openPostLink(postNumber: number) {
  if (!cachedTopic.value) return;
  const post = allPosts.value.find(p => p.postNumber === postNumber);
  const base = cachedTopic.value.url.replace(/\/$/, '');
  const pageSegment = post?.page && post.page > 1 ? `/page-${post.page}` : '';
  browser.tabs.create({ url: `${base}${pageSegment}#post-${postNumber}` });
}

function formatTimestamp(ts: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function toggleTag(tag: string) {
  const idx = selectedTags.value.indexOf(tag);
  if (idx >= 0) selectedTags.value.splice(idx, 1);
  else selectedTags.value.push(tag);
}

// Posts may live in segments[].posts (segment mode) or top-level posts (legacy)
const allPosts = computed(() => {
  if (!cachedTopic.value) return [];
  if (cachedTopic.value.posts?.length) return cachedTopic.value.posts;
  return cachedTopic.value.segments?.flatMap(s => s?.posts ?? []) ?? [];
});

const allTags = computed(() => {
  const tags = new Set<string>();
  entries.value.forEach(e => e.tags.forEach(t => tags.add(t)));
  return [...tags].sort();
});

const savedCount = computed(() => entries.value.filter(e => e.saved).length);

const excludedCount = computed(() =>
  cachedTopic.value?.excludedKnowledgePostNumbers?.length ?? 0
);

const newPostsCount = computed(() => {
  const last = cachedTopic.value?.lastKnowledgePostNumber ?? -1;
  if (last < 0) return 0;
  return allPosts.value.filter(p => p.postNumber > last).length;
});

const progressLabel = computed(() => {
  if (currentPhase.value === 'extracting' && totalChunks.value > 0) {
    return `Đang trích xuất phần ${currentChunkIndex.value + 1}/${totalChunks.value}...`;
  }
  if (currentPhase.value === 'reducing') return 'Đang gộp kiến thức...';
  return 'Đang trích xuất kiến thức...';
});

const allCategories = computed(() => {
  const cats = new Set<string>();
  entries.value.forEach(e => { if (e.category) cats.add(e.category); });
  return [...cats].sort((a, b) => a.localeCompare(b, 'vi'));
});

const filteredEntries = computed(() => {
  let result = entries.value;
  if (showSavedOnly.value) result = result.filter(e => e.saved);
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    result = result.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q)
    );
  }
  if (selectedTags.value.length > 0) {
    result = result.filter(e =>
      e.tags.some(t => selectedTags.value.includes(t))
    );
  }
  if (selectedCategory.value) {
    result = result.filter(e => e.category === selectedCategory.value);
  }
  return result;
});

const groupedEntries = computed(() => {
  const groups: Record<string, typeof entries.value> = {};
  for (const e of filteredEntries.value) {
    const cat = e.category || 'Khác';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(e);
  }
  // Sort categories alphabetically, 'Khác' last
  const keys = Object.keys(groups).sort((a, b) => {
    if (a === 'Khác') return 1;
    if (b === 'Khác') return -1;
    return a.localeCompare(b, 'vi');
  });
  return keys.map(key => ({ category: key, entries: groups[key] }));
});

async function loadTopicData() {
  // Cancel any in-progress extract (mirrors F23 invariant in useSummarize)
  activeExtractId++;
  isLoading.value = false;
  llmTaskId.value = null;
  currentPhase.value = 'idle';
  currentChunkIndex.value = 0;
  totalChunks.value = 0;

  const topic = store.selectedTopic.value;
  if (!topic) return;
  const url = topic.url;

  entries.value = [];
  cachedTopic.value = null;
  loadedTopicUrl.value = url;
  expandedIds.value = new Set();
  showSavedOnly.value = false;
  cachedTopic.value = topic as CachedTopic;
  if (topic.knowledgeEntries?.length) entries.value = topic.knowledgeEntries as KnowledgeEntry[];

  try {
    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', url);
    if (loadedTopicUrl.value !== url) return; // topic switched during await — discard stale result
    if (fresh) {
      cachedTopic.value = fresh;
      if (fresh.knowledgeEntries?.length) entries.value = fresh.knowledgeEntries as KnowledgeEntry[];
    }
  } catch { /* no cache */ }
}

onActivated(async () => {
  // Reload settings in case user changed them
  sendMessage<LLMConfig>('GET_SETTINGS').then((cfg) => {
    if (cfg) currentConfig.value = cfg;
  }).catch(() => {});

  const url = store.selectedTopic.value?.url;
  if (!url) return;
  if (url !== loadedTopicUrl.value) {
    await loadTopicData();
  } else {
    // Same topic — refresh from cache in case entries were updated elsewhere
    try {
      const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', url);
      if (fresh) {
        cachedTopic.value = fresh;
        if (fresh.knowledgeEntries?.length) entries.value = fresh.knowledgeEntries as KnowledgeEntry[];
      }
    } catch { /* ignore */ }
  }
});

/** Enrich entries with timestamp from allPosts */
function enrichEntries(newEntries: KnowledgeEntry[]): KnowledgeEntry[] {
  const postMap = new Map(allPosts.value.map(p => [p.postNumber, p]));
  return newEntries.map(e => {
    const post = postMap.get(e.source.postNumber);
    return post?.timestamp ? { ...e, source: { ...e.source, timestamp: post.timestamp } } : e;
  });
}

/** Merge saved entries from previous results with fresh entries — saved entries survive re-extract */
function mergeSavedWithFresh(saved: KnowledgeEntry[], fresh: KnowledgeEntry[]): KnowledgeEntry[] {
  const freshByPostNum = new Set(fresh.map(e => e.source.postNumber));
  const savedNotInFresh = saved.filter(e => !freshByPostNum.has(e.source.postNumber));
  return [...savedNotInFresh, ...fresh];
}

/** Determine resume state from existing knowledgeChunks */
function computeKnowledgeResumeState(): {
  startFromPostNumber: number;
  existingChunks: KnowledgeChunk[];
} {
  const chunks = cachedTopic.value?.knowledgeChunks ?? [];
  if (chunks.length === 0) return { startFromPostNumber: 0, existingChunks: [] };

  const lastChunk = chunks[chunks.length - 1];
  if (lastChunk.complete === false) {
    // Last chunk incomplete → drop it, resume from its startPostNumber
    return {
      startFromPostNumber: lastChunk.startPostNumber,
      existingChunks: chunks.slice(0, -1),
    };
  }
  // All complete → resume from after last post
  return {
    startFromPostNumber: lastChunk.endPostNumber + 1,
    existingChunks: [...chunks],
  };
}

/** Persist chunks to cache without updating entries.value (entries only update after reduce) */
async function persistChunks(chunks: KnowledgeChunk[], guardId: number, topicUrl: string): Promise<void> {
  if (guardId !== activeExtractId) return;
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: topicUrl,
    knowledgeChunks: chunks,
  }).catch(() => {});

  if (cachedTopic.value?.url === topicUrl) {
    cachedTopic.value = {
      ...cachedTopic.value,
      knowledgeChunks: [...chunks],
      lastKnowledgePostNumber: chunks.length > 0
        ? chunks[chunks.length - 1].endPostNumber
        : cachedTopic.value.lastKnowledgePostNumber,
    };
  }
}

/** Direct path: single LLM call for small topics that fit in context */
async function runDirectExtract(postsToProcess: ScrapedPost[], guardId: number, topicUrl: string, topicTitle: string): Promise<void> {
  currentPhase.value = 'extracting';
  const { taskId, result } = runExtract(postsToProcess, topicTitle);
  llmTaskId.value = taskId;
  const llmResult = await result;
  if (guardId !== activeExtractId) return;

  const newEntries = enrichEntries(
    ((llmResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [],
  );

  // Create single chunk record for consistency (QD4)
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

  entries.value = merged;
  expandedIds.value = new Set();
  store.updateSelectedTopic({ knowledgeEntries: merged });
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: topicUrl,
    knowledgeEntries: merged,
    knowledgeChunks: [chunk],
    lastKnowledgePostNumber: chunk.endPostNumber,
  }).catch(() => {});

  const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topicUrl).catch(() => null);
  if (fresh && guardId === activeExtractId) cachedTopic.value = fresh;
}

function onExtractClick() {
  if (showExtractCostWarning.value) {
    confirmingExtract.value = true;
  } else {
    handleExtract();
  }
}

async function handleExtract() {
  confirmingExtract.value = false;
  if (!allPosts.value.length) return;
  if (isLoading.value) return;

  const thisId = ++activeExtractId;
  error.value = '';
  isLoading.value = true;
  currentPhase.value = 'extracting';
  currentChunkIndex.value = 0;
  totalChunks.value = 0;

  // Ensure config is loaded
  if (!currentConfig.value) {
    const cfg = await sendMessage<LLMConfig>('GET_SETTINGS').catch(() => null);
    if (cfg) currentConfig.value = cfg;
  }

  try {
    // 0. Snapshot topic identity at call time (Layer 2 guard — topic switch also caught by activeExtractId++ in loadTopicData)
    const topicUrl = cachedTopic.value?.url;
    const topicTitle = cachedTopic.value?.title;
    if (!topicUrl || !topicTitle) return;

    // 1. Determine resume state
    const resume = computeKnowledgeResumeState();

    // Reset search/filter on a fresh extract (no prior chunks)
    if (resume.existingChunks.length === 0 && resume.startFromPostNumber === 0) {
      searchQuery.value = '';
      selectedTags.value = [];
    }

    const excludedNums = new Set(cachedTopic.value?.excludedKnowledgePostNumbers ?? []);

    // 2. Filter posts: >= startFromPostNumber, not excluded
    const postsToProcess = allPosts.value
      .filter(p => p.postNumber >= resume.startFromPostNumber && !excludedNums.has(p.postNumber))
      .sort((a, b) => a.postNumber - b.postNumber);

    if (postsToProcess.length === 0) {
      // Check if all chunks complete but no final reduce yet (resume reduce only)
      const existingChunks = resume.existingChunks;
      if (existingChunks.length > 0) {
        // Re-run reduce with existing chunks
        currentPhase.value = 'reducing';
        await runReducePhase(existingChunks, excludedNums, thisId, topicUrl);
      } else if (entries.value.length > 0) {
        error.value = 'Không có bài viết mới để trích xuất kiến thức.';
      }
      return;
    }

    // 3. Decide path: direct (fits context, no existing chunks) or chunked
    const budget = calculateSegmentBudget(
      currentConfig.value?.model ?? 'gpt-4o-mini',
      KNOWLEDGE_CHUNK_PROMPT_TOKENS,
      2000,
      currentConfig.value?.contextWindow,
    );
    const totalTokens = postsToProcess.reduce(
      (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
      0,
    );

    if (totalTokens <= budget && resume.existingChunks.length === 0) {
      // Direct path — single call, no reduce
      await runDirectExtract(postsToProcess, thisId, topicUrl, topicTitle);
      return;
    }

    // 4. Chunked path
    const chunkPlan = planKnowledgeChunks(
      postsToProcess,
      currentConfig.value?.model ?? 'gpt-4o-mini',
      currentConfig.value?.contextWindow,
      currentConfig.value?.maxTokens,
      currentConfig.value?.thinkingEnabled,
      currentConfig.value?.thinkingBudget,
    );
    const newChunks: KnowledgeChunk[] = [...resume.existingChunks];
    totalChunks.value = newChunks.length + chunkPlan.length;

    // 5. Extract each chunk
    for (let i = 0; i < chunkPlan.length; i++) {
      if (thisId !== activeExtractId) return; // cancelled
      currentChunkIndex.value = newChunks.length;
      currentPhase.value = 'extracting';

      const { startIndex, endIndex } = chunkPlan[i];
      const chunkPosts = postsToProcess.slice(startIndex, endIndex + 1);
      const isLastChunk = i === chunkPlan.length - 1;

      const { taskId, result } = extractKnowledgeChunkTask(chunkPosts, topicTitle);
      llmTaskId.value = taskId;
      const llmResult = await result;
      if (thisId !== activeExtractId) return;

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
        // Last chunk: incomplete if < 80% budget (allows appending new posts)
        complete: isLastChunk ? (chunkTokens >= budget * 0.8) : true,
      };
      newChunks.push(chunkRecord);

      // Persist per chunk (resume if cancelled/error)
      await persistChunks(newChunks, thisId, topicUrl);
    }

    // 6. Reduce phase
    if (thisId !== activeExtractId) return;
    await runReducePhase(newChunks, excludedNums, thisId, topicUrl);
  } catch (err) {
    if (thisId !== activeExtractId) return; // cancelled, ignore
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (thisId === activeExtractId) {
      isLoading.value = false;
      llmTaskId.value = null;
      currentPhase.value = 'idle';
      currentChunkIndex.value = 0;
      totalChunks.value = 0;
    }
  }
}

/** Reduce phase: merge all chunk entries into final knowledgeEntries.
 *  Tree-reduces if total entry JSON exceeds the model's usable context budget.
 */
function calcMaxOutputEntries(
  contextLimit: number,
  promptTokens: number,
  inputTokens: number,
): number {
  void promptTokens; void inputTokens; // reserved for future precise budget
  const outputBudget = contextLimit * REDUCE_OUTPUT_FRACTION;
  return Math.max(10, Math.floor(outputBudget / TOKENS_PER_KNOWLEDGE_ENTRY));
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
    // Single chunk — skip reduce call
    finalEntries = enrichEntries(allPartial[0]);
  } else {
    // Estimate token budget for a single reduce call
    const model = currentConfig.value?.model ?? 'gpt-4o-mini';
    const contextLimit = getContextLimit(model, currentConfig.value?.contextWindow);
    const promptOverhead = estimateTokens(buildKnowledgeReducePrompt(finalCap)) + RESPONSE_BUFFER_TOKENS;
    const usableTokens = Math.floor(contextLimit * CONTEXT_USAGE_RATIO) - promptOverhead;
    // Vietnamese/JSON text tokenizes ~1.35–1.40× more than char-based estimate; use 1.4 to keep groups safely within context
    const totalTokens = estimateTokens(JSON.stringify(allPartial)) * 1.4;

    let entriesToReduce = allPartial;

    if (totalTokens > usableTokens && allPartial.length > 2) {
      // Too large for one call — batch-reduce first, then do a final reduce
      const groupCount = Math.max(2, Math.ceil(totalTokens / usableTokens));
      const groupSize = Math.ceil(allPartial.length / groupCount);
      const groupResults: KnowledgeEntry[][] = [];

      for (let g = 0; g < allPartial.length; g += groupSize) {
        if (guardId !== activeExtractId) return;
        const group = allPartial.slice(g, g + groupSize);
        const { taskId, result } = reduceKnowledgeChunksTask(group);
        llmTaskId.value = taskId;
        const groupResult = await result;
        if (guardId !== activeExtractId) return;
        groupResults.push(
          ((groupResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [],
        );
        if (g + groupSize < allPartial.length) {
          await new Promise(r => setTimeout(r, MAP_REDUCE_CHUNK_DELAY_MS));
        }
      }
      entriesToReduce = groupResults;
    }

    // Determine if output would overflow context; if so, split into multiple calls
    const promptTokens = estimateTokens(buildKnowledgeReducePrompt(finalCap));
    const inputTokens = estimateTokens(JSON.stringify(entriesToReduce)) * 1.4;
    const maxPerCall = calcMaxOutputEntries(contextLimit, promptTokens, inputTokens);

    let rawFinalEntries: KnowledgeEntry[];
    if (finalCap <= maxPerCall) {
      // Fit in one call — existing path
      const { taskId, result } = reduceKnowledgeChunksTask(entriesToReduce, finalCap);
      llmTaskId.value = taskId;
      const reduceResult = await result;
      if (guardId !== activeExtractId) return;
      rawFinalEntries = ((reduceResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [];
    } else {
      // Split output: multiple calls, each produces maxPerCall entries
      const numCalls = Math.ceil(finalCap / maxPerCall);
      const groupSize = Math.ceil(entriesToReduce.length / numCalls);
      const allRaw: KnowledgeEntry[] = [];

      for (let g = 0; g < entriesToReduce.length; g += groupSize) {
        if (guardId !== activeExtractId) return;
        const group = entriesToReduce.slice(g, g + groupSize);
        const { taskId, result } = reduceKnowledgeChunksTask(group, maxPerCall);
        llmTaskId.value = taskId;
        const groupResult = await result;
        if (guardId !== activeExtractId) return;
        allRaw.push(
          ...((groupResult.data as { entries?: KnowledgeEntry[] })?.entries ?? []),
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

  // Filter excluded entries
  const filteredFinal = finalEntries.filter(e => !excludedNums.has(e.source.postNumber));

  // Merge strategy: saved entries survive re-extract
  const savedEntries = entries.value.filter(e => e.saved);
  const merged = mergeSavedWithFresh(savedEntries, filteredFinal);

  entries.value = merged;
  expandedIds.value = new Set();
  store.updateSelectedTopic({ knowledgeEntries: merged });
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: topicUrl,
    knowledgeEntries: merged,
    knowledgeChunks: chunks,
    lastKnowledgePostNumber: chunks[chunks.length - 1].endPostNumber,
  }).catch(() => {});

  const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topicUrl).catch(() => null);
  if (fresh && guardId === activeExtractId) cachedTopic.value = fresh;
}

function handleCancel() {
  if (llmTaskId.value) cancelTask(llmTaskId.value);
  activeExtractId++;
  isLoading.value = false;
  llmTaskId.value = null;
  currentPhase.value = 'idle';
  currentChunkIndex.value = 0;
  totalChunks.value = 0;
  // Partial progress already persisted per-chunk → auto-resume on next click
}

async function toggleSave(entry: KnowledgeEntry) {
  const updated = entries.value.map(e =>
    e.id === entry.id ? { ...e, saved: !e.saved } : e
  ) as KnowledgeEntry[];
  entries.value = updated;
  store.updateSelectedTopic({ knowledgeEntries: updated });
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: cachedTopic.value!.url,
    knowledgeEntries: updated,
  }).catch(() => {});
}

async function handleDelete(entry: KnowledgeEntry) {
  const updated = entries.value.filter(e => e.id !== entry.id) as KnowledgeEntry[];
  const excluded = [
    ...(cachedTopic.value?.excludedKnowledgePostNumbers ?? []),
    entry.source.postNumber,
  ];
  entries.value = updated;
  store.updateSelectedTopic({ knowledgeEntries: updated });
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: cachedTopic.value!.url,
    knowledgeEntries: updated,
    excludedKnowledgePostNumbers: excluded,
  }).catch(() => {});
  const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', cachedTopic.value!.url).catch(() => null);
  if (fresh) cachedTopic.value = fresh;
}

async function handleClearTracking() {
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: cachedTopic.value!.url,
    excludedKnowledgePostNumbers: [],
    lastKnowledgePostNumber: 0,
    knowledgeChunks: [], // F24: clear all chunks so next extract starts fresh
  }).catch(() => {});
  const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', cachedTopic.value!.url).catch(() => null);
  if (fresh) cachedTopic.value = fresh;
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

      <h2 class="font-semibold text-sm text-(--color-text-primary)">Kiến thức từ Topic</h2>

      <!-- No posts warning -->
      <div v-if="!allPosts.length" class="alert alert-warning">
        Chưa có dữ liệu bài viết. Vui lòng tóm tắt topic ở tab "Tóm tắt" trước.
      </div>

      <!-- Extract button (no entries yet) — with optional confirm for high-cost topics -->
      <template v-if="allPosts.length && !entries.length && !isLoading">
        <button
          v-if="!confirmingExtract"
          class="w-full btn btn-primary"
          @click="onExtractClick"
        >
          Trích xuất Kiến thức
        </button>
        <ConfirmInline
          v-else
          :message="`Trích xuất kiến thức từ topic này. Tiếp tục?`"
          :warning="showExtractCostWarning ? `⚠️ Ước tính ~${estimatedExtractApiCalls} API calls. Chi phí có thể cao.` : undefined"
          @confirm="handleExtract()"
          @cancel="confirmingExtract = false"
        />
      </template>

      <!-- Progress -->
      <ProgressIndicator v-if="isLoading" :task-id="llmTaskId" :fallback-message="progressLabel" />
      <button v-if="isLoading" class="w-full btn btn-secondary mt-2 text-xs" @click="handleCancel">
        Hủy
      </button>

      <!-- Error -->
      <div v-if="error" class="alert alert-error flex items-start gap-3">
        <svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p class="text-sm flex-1">{{ error }}</p>
        <button class="shrink-0 text-(--color-text-muted) hover:text-(--color-text-primary) transition-colors" @click="error = ''">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Entry list -->
      <template v-if="entries.length && !isLoading">
        <!-- Search + Saved filter + Tag filter -->
        <div class="space-y-2">
          <!-- Search + Saved filter toggle -->
          <div class="relative">
            <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-(--color-text-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Tìm kiến thức..."
              class="input pl-8 pr-8 text-xs w-full"
            />
            <!-- Saved filter toggle -->
            <button
              v-if="savedCount > 0"
              class="absolute right-2 top-1/2 -translate-y-1/2 transition-colors"
              :class="showSavedOnly ? 'text-amber-500' : 'text-(--color-text-muted) hover:text-(--color-text-secondary)'"
              :title="showSavedOnly ? 'Xem tất cả' : `Chỉ hiện đã lưu (${savedCount})`"
              @click="showSavedOnly = !showSavedOnly"
            >
              <svg v-if="showSavedOnly" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z" />
              </svg>
              <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z" />
              </svg>
            </button>
          </div>
          <!-- Tag filter pills -->
          <div v-if="allTags.length > 0" class="flex flex-wrap gap-1.5">
            <button
              v-for="tag in allTags"
              :key="tag"
              class="px-2 py-0.5 rounded-full text-xs transition-colors"
              :class="selectedTags.includes(tag)
                ? getTagClass(tag)
                : 'bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft)'"
              @click="toggleTag(tag)"
            >
              {{ tag }}
            </button>
          </div>
          <!-- Category filter pills -->
          <div v-if="allCategories.length > 0" class="flex flex-wrap gap-1.5">
            <button
              v-if="selectedCategory"
              class="px-2 py-0.5 rounded-full text-xs transition-colors bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft)"
              @click="selectedCategory = null"
            >
              Tất cả
            </button>
            <button
              v-for="cat in allCategories"
              :key="cat"
              class="px-2 py-0.5 rounded-full text-xs transition-colors"
              :class="selectedCategory === cat
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
                : 'bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft)'"
              @click="selectedCategory = selectedCategory === cat ? null : cat"
            >
              {{ cat }}
            </button>
          </div>
        </div>

        <!-- Stats + re-extract -->
        <div class="flex items-center justify-between text-xs text-(--color-text-muted)">
          <span>
            {{ filteredEntries.length }}/{{ entries.length }} kiến thức
            <span v-if="cachedTopic?.llmConfig?.model" class="ml-2 italic opacity-70">
              · {{ cachedTopic.llmConfig.provider }}: {{ cachedTopic.llmConfig.model }}
            </span>
          </span>
          <button
            v-if="allPosts.length"
            class="text-blue-600 hover:text-blue-700"
            @click="handleExtract"
          >
            Trích xuất bài mới<span v-if="newPostsCount > 0"> ({{ newPostsCount }})</span>
          </button>
        </div>

        <!-- Clear tracking button -->
        <div v-if="excludedCount > 0" class="flex items-center justify-end text-xs text-(--color-text-muted)">
          <button
            class="w-full text-left text-xs text-(--color-text-muted) hover:text-red-500 transition-colors"
            @click="handleClearTracking"
          >
            Xóa tracking ({{ excludedCount }} bài đã loại)
          </button>
        </div>

        <!-- No results after filter -->
        <div v-if="filteredEntries.length === 0" class="text-center py-6">
          <p class="text-xs text-(--color-text-muted)">Không tìm thấy kiến thức phù hợp với bộ lọc.</p>
        </div>

        <!-- Entry cards grouped by category -->
        <div class="space-y-4">
          <template v-for="group in groupedEntries" :key="group.category">
            <div>
              <h4 class="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide mb-2">
                {{ group.category }}
                <span class="font-normal normal-case ml-1">({{ group.entries.length }})</span>
              </h4>
              <div class="space-y-2">
                <div
                  v-for="entry in group.entries"
                  :key="entry.id"
                  class="card"
                >
            <!-- Header: always visible, click to expand -->
            <div class="flex items-start gap-2 cursor-pointer" @click="toggleExpand(entry.id)">
              <!-- Chevron icon -->
              <svg
                class="w-3.5 h-3.5 mt-0.5 shrink-0 transition-transform duration-200 text-(--color-text-muted)"
                :class="expandedIds.has(entry.id) ? 'rotate-90' : ''"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
              <p class="text-sm font-semibold text-(--color-text-primary) flex-1 leading-snug">{{ entry.title }}</p>
              <!-- Save button -->
              <button
                class="p-0.5 transition-colors rounded"
                :class="entry.saved 
                  ? 'text-yellow-500 dark:text-yellow-400' 
                  : 'text-gray-300 dark:text-gray-600 hover:text-yellow-500 dark:hover:text-yellow-400'"
                :title="entry.saved ? 'Bỏ lưu' : 'Lưu kiến thức'"
                @click.stop="toggleSave(entry)"
              >
                <svg v-if="entry.saved" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z" />
                </svg>
                <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z" />
                </svg>
              </button>
              <!-- Delete button -->
              <button
                class="p-0.5 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded"
                title="Xóa kiến thức"
                @click.stop="handleDelete(entry)"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            <!-- Body: collapsible with CSS Grid animation -->
            <div
              class="grid transition-[grid-template-rows] duration-200 ease-in-out"
              :class="expandedIds.has(entry.id) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
            >
              <div class="overflow-hidden">
                <div class="pt-2 space-y-2">
                  <p class="text-xs text-(--color-text-secondary) leading-relaxed">{{ entry.content }}</p>
                  <!-- Tags -->
                  <div v-if="entry.tags.length > 0" class="flex flex-wrap gap-1">
                    <span
                      v-for="tag in entry.tags"
                      :key="tag"
                      class="px-1.5 py-0.5 rounded text-xs"
                      :class="getTagClass(tag)"
                    >
                      {{ tag }}
                    </span>
                  </div>
                  <!-- Source citation with timestamp -->
                  <p class="text-xs text-(--color-text-muted)">
                    — {{ entry.source.author }}<template v-if="entry.source.postNumber">, bài <button
                        class="font-mono hover:underline cursor-pointer"
                        @click="openPostLink(entry.source.postNumber)"
                      >#{{ entry.source.postNumber }}</button></template><span v-if="entry.source.timestamp"> · {{ formatTimestamp(entry.source.timestamp) }}</span>
                  </p>
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      </template>
    </div>
      </template>

      <!-- Empty state (has posts but no entries extracted) -->
      <div v-if="!isLoading && !entries.length && allPosts.length" class="text-center py-6">
        <p class="text-xs text-(--color-text-muted)">Bấm nút phía trên để trích xuất kiến thức từ topic.</p>
      </div>
    </template>
  </div>
</template>
