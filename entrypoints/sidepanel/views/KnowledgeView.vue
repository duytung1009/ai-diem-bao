<script setup lang="ts">
import { ref, onActivated, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CachedTopic, KnowledgeEntry, LLMConfig, GlobalKnowledgeEntry, NotebookEntry } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import { globalToKnowledgeEntry } from '@/lib/text-similarity';
import { buildKnowledgeExport, downloadJson, safeFilename } from '@/lib/exporter';
import ProgressIndicator from '../components/ProgressIndicator.vue';
import StepTimeline from '../components/StepTimeline.vue';
import { useKnowledge } from '../composables/useKnowledge';
import { useTopicStore } from '../composables/useTopicStore';
import { useAlertSettings } from '../composables/useAlertSettings';

const { hideInfoAlerts, hideWarningAlerts } = useAlertSettings();
import { useSummarize } from '../composables/useSummarize';
import BackButton from '../components/BackButton.vue';
import KnowledgeEntryCard from '../components/KnowledgeEntryCard.vue';
import type { KnowledgeCardEntry } from '../components/KnowledgeEntryCard.vue';
import OperationConflictAlert from '../components/OperationConflictAlert.vue';
import CostConfirmModal from '../components/CostConfirmModal.vue';
import { estimateExtractCost } from '@/lib/llm/cost-estimator';
import { getModelMaxOutput } from '@/lib/token-estimator';

const store = useTopicStore();
const knowledge = useKnowledge(store);
const { topicInfo } = useSummarize(store);

const hasPartialSegments = computed(() =>
  knowledgeSegments.value.some(s => s.status === 'partial'),
);

const {
  entries, loadedTopicUrl, isLoading, error, llmTaskId,
  currentChunkIndex, totalChunks, currentPhase, currentConfig,
  confirmTarget, showClearDataAction, truncationWarning,
  cachedTopic, activePipeline, canRestore,
  estimatedExtractCost, showExtractCostWarning,
  estimatedRestoreCost, showRestoreCostWarning,
  estimatedReduceCost,
  allPosts,
  handleExtract, handleRestore, handleCancel,
  handleClearKnowledgeData, toggleSave, handleDelete, handleClearTracking,
  onExtractClick, onRestoreClick,
  knowledgeGuard,
  // F33 additions
  knowledgeSegments, isReduceStale, hasAnyExtractedSegment,
  extractSegment, reExtractSegment, runReducePhaseManual,
  isBatchExtracting, extractAllSegments, progressPercent,
} = knowledge;

// UI state (local to view)
const searchQuery = ref('');
const selectedTags = ref<string[]>([]);
const selectedCategory = ref<string | null>(null);
const expandedIds = ref<Set<string>>(new Set());
const showSavedOnly = ref(false);
const loadedTopicTitle = ref('');
const pendingConflict = ref<{ newUrl: string; newTitle: string } | null>(null);
// F33 segment grid UI state
const segmentGridExpanded = ref(false);
const expandedSegmentIndex = ref<number | null>(null);
const showExtractDropdown = ref(false);

// F33 helpers
function formatRelativeTime(ts: number | null): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} giờ trước`;
  return `${Math.floor(hrs / 24)} ngày trước`;
}

function onReduceManualClick() {
  const est = estimatedReduceCost.value;
  if (!est || (est.costUsd === 0 && est.apiCalls <= 3)) {
    runReducePhaseManual();
    return;
  }
  confirmTarget.value = 'reduce';
}

const showExtractAllModal = ref(false);

const estimatedExtractAllCost = computed(() => {
  if (!currentConfig.value || !cachedTopic.value?.segments) return null;
  const pending = knowledgeSegments.value.filter(s => s.status === 'pending' || s.status === 'partial');
  if (!pending.length) return null;
  const model = currentConfig.value.model;
  const maxOutput = currentConfig.value.knowledgeMaxTokens ?? currentConfig.value.maxTokens ?? getModelMaxOutput(model);
  return estimateExtractCost(pending.length, 3000, model, maxOutput);
});

function onExtractAllClick() {
  const est = estimatedExtractAllCost.value;
  if (!est || (est.costUsd === 0 && est.apiCalls <= 3)) {
    extractAllSegments();
    return;
  }
  showExtractAllModal.value = true;
}

function handleExportKnowledge() {
  if (!cachedTopic.value) return;
  const payload = buildKnowledgeExport(cachedTopic.value as CachedTopic);
  downloadJson(payload, `${safeFilename(cachedTopic.value.title)}_knowledge.json`);
}

// Focus scroll / route state
const route = useRoute();
const router = useRouter();
const focusId = computed(() => (route.query.focus as string | null) ?? null);
const hasFocused = ref(false);

watch(
  () => [entries.value.length, focusId.value] as const,
  async ([count, id]) => {
    if (!id || count === 0 || hasFocused.value) return;
    await nextTick();
    const el = document.getElementById(`knowledge-entry-${id}`);
    if (!el) return;
    expandedIds.value = new Set([...expandedIds.value, id]);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-blue-500');
    setTimeout(() => el.classList.remove('ring-2', 'ring-blue-500'), 2000);
    hasFocused.value = true;
    router.replace({ query: { ...route.query, focus: undefined } });
  },
  { immediate: true },
);

watch(() => route.fullPath, () => { hasFocused.value = false; });

watch(() => route.query.restore, (val) => {
  if (val === 'true' && canRestore.value) {
    onRestoreClick();
    router.replace({ query: { ...route.query, restore: undefined } });
  }
}, { immediate: true });

watch(() => route.query.extract, (val) => {
  if (val === 'true' && allPosts.value.length && !isLoading.value) {
    // ?extract=true is a legacy CTA signal — not applicable to segment-mode topics.
    // For those, the user is directed to the segment grid instead.
    if (!cachedTopic.value?.segments?.length) {
      onExtractClick();
    }
    router.replace({ query: { ...route.query, extract: undefined } });
  }
}, { immediate: true });

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

function normalizeEntry(entry: KnowledgeEntry): KnowledgeCardEntry {
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    tags: entry.tags,
    category: entry.category,
    sourceAuthor: entry.source.author,
    sourcePostNumber: entry.source.postNumber,
    sourceTimestamp: entry.source.timestamp,
    saved: entry.saved,
    postUrl: cachedTopic.value?.url,
  };
}

function findEntry(id: string): KnowledgeEntry | undefined {
  return entries.value.find(e => e.id === id);
}

function toggleExpand(id: string) {
  const s = new Set(expandedIds.value);
  s.has(id) ? s.delete(id) : s.add(id);
  expandedIds.value = s;
}

function toggleTag(tag: string) {
  const idx = selectedTags.value.indexOf(tag);
  if (idx >= 0) selectedTags.value.splice(idx, 1);
  else selectedTags.value.push(tag);
}

const allTags = computed(() => {
  const seen = new Map<string, string>();
  entries.value.forEach(e => e.tags.forEach(t => {
    const key = t.trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, t.trim());
  }));
  return [...seen.values()].sort();
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

const hasFailed = computed(() =>
  cachedTopic.value?.knowledgeChunks?.some(c => c.failed) ?? false
);

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
  const keys = Object.keys(groups).sort((a, b) => {
    if (a === 'Khác') return 1;
    if (b === 'Khác') return -1;
    return a.localeCompare(b, 'vi');
  });
  return keys.map(key => ({ category: key, entries: groups[key] }));
});

// Notebook is the single source of truth for which knowledge entries are saved.
// We fetch the saved ids once per load and derive each entry's `saved` flag.
const notebookSavedIds = ref<Set<string>>(new Set());

async function refreshNotebookSavedIds(): Promise<void> {
  try {
    const nb = await sendMessage<NotebookEntry[]>('GET_NOTEBOOK_ENTRIES') ?? [];
    notebookSavedIds.value = new Set(nb.map(e => e.id));
  } catch { /* keep previous ids */ }
}

// Dedup entries by id (cache + global store can overlap) and re-derive `saved`
// from notebook membership — never from the stale per-topic cache.
function applySavedFlag(): void {
  const seen = new Set<string>();
  const deduped: KnowledgeEntry[] = [];
  for (const e of entries.value) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    deduped.push({ ...e, saved: notebookSavedIds.value.has(e.id) });
  }
  entries.value = deduped;
}

// Fetch global knowledge entries belonging to `url` and append them to the
// view's entries (fire-and-forget; guards against a topic switch mid-fetch).
async function appendGlobalKnowledge(url: string): Promise<void> {
  const all = await sendMessage<GlobalKnowledgeEntry[]>('GET_ALL_KNOWLEDGE').catch(() => null);
  if (!all || loadedTopicUrl.value !== url) return;
  const converted = all.filter(e => e.topicRefs.includes(url)).map(globalToKnowledgeEntry);
  if (converted.length > 0) entries.value = [...entries.value, ...converted];
  applySavedFlag();
}

async function loadTopicData() {
  const topic = store.selectedTopic.value;
  if (!topic) return;
  const newUrl = topic.url;

  // Show conflict alert if extraction running for a different topic
  if (isLoading.value && loadedTopicUrl.value && newUrl !== loadedTopicUrl.value) {
    pendingConflict.value = { newUrl, newTitle: topic.title ?? '...' };
    return;
  }

  // Do NOT interfere if extraction is running for the same topic (CTA navigation)
  if (isLoading.value) return;

  knowledgeGuard.begin();
  currentChunkIndex.value = 0;
  totalChunks.value = 0;

  entries.value = [];
  loadedTopicUrl.value = topic.url;
  loadedTopicTitle.value = topic.title;
  expandedIds.value = new Set();
  showSavedOnly.value = false;
  if (topic.knowledgeEntries?.length) entries.value = topic.knowledgeEntries as KnowledgeEntry[];

  // Notebook = source of truth for `saved`: fetch ids, then derive + dedup.
  await refreshNotebookSavedIds();
  applySavedFlag();

  // Load global knowledge entries for this topic (dedups + re-applies saved flag)
  appendGlobalKnowledge(topic.url);

  try {
    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (loadedTopicUrl.value !== topic.url) return;
    if (fresh) {
      store.updateSelectedTopic(fresh);
      if (fresh.knowledgeEntries?.length) {
        entries.value = fresh.knowledgeEntries as KnowledgeEntry[];
        applySavedFlag();
      }
    }
  } catch { /* no cache */ }
}

function handleConflictCancel() {
  handleCancel();
  pendingConflict.value = null;
  loadTopicData();
}

async function handleConflictGoBack() {
  const oldUrl = loadedTopicUrl.value;
  if (oldUrl) {
    const oldTopic = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', oldUrl);
    if (oldTopic) store.selectTopic(oldTopic);
  }
  pendingConflict.value = null;
}

onActivated(async () => {
  sendMessage<LLMConfig>('GET_SETTINGS').then((cfg) => {
    if (cfg) currentConfig.value = cfg;
  }).catch(() => { });

  const url = store.selectedTopic.value?.url;
  if (!url) return;
  if (url !== loadedTopicUrl.value) {
    await loadTopicData();
  } else {
    try {
      // Notebook may have changed while away — re-derive `saved` from it.
      await refreshNotebookSavedIds();
      const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', url);
      if (fresh) {
        store.updateSelectedTopic(fresh);
        if (fresh.knowledgeEntries?.length) entries.value = fresh.knowledgeEntries as KnowledgeEntry[];
      }
      applySavedFlag();
      // Reload global knowledge for this topic (dedups + re-applies saved flag)
      appendGlobalKnowledge(url);
    } catch { /* ignore */ }
  }
});
</script>

<template>
  <div class="p-3 space-y-2">
    <!-- No topic selected -->
    <div v-if="!topicInfo" class="text-center py-8">
      <p class="text-sm text-(--color-text-secondary)">Chưa chọn thớt.</p>
      <BackButton class="mt-3" />
    </div>

    <!-- Topic loaded -->
    <template v-else>
      <!-- Back button + Refresh -->
      <div class="flex items-center justify-between">
        <BackButton />
        <h2 class="section-heading">Trích xuất kiến thức</h2>
      </div>

      <!-- Conflict alert: running task for old topic -->
      <OperationConflictAlert v-if="pendingConflict" operation="trích xuất kiến thức" :oldTopicTitle="loadedTopicTitle"
        :newTopicTitle="pendingConflict.newTitle" @cancel="handleConflictCancel" @goBack="handleConflictGoBack" />

      <template v-if="!pendingConflict">

        <!-- No posts warning -->
        <div v-if="!allPosts.length" class="alert alert-warning text-xs">
          Chưa có dữ liệu của thớt. Vui lòng tóm tắt thớt ở tab "Tóm tắt" trước.
        </div>

        <!-- F33: Per-segment extraction grid (Task 289+290) -->
        <template v-if="cachedTopic?.segments?.length && allPosts.length">
          <!-- Info banner: chỉ hiển thị khi > 5 phân đoạn để giải thích thời gian tốn -->
          <div v-if="cachedTopic.segments.length > 5 && !hideInfoAlerts" class="alert alert-info text-xs">
            <p class="font-medium">Thớt dài ({{ cachedTopic.segments.length }} phần)</p>
            <p class="mt-0.5">
              Trích xuất kiến thức gọi API <strong>nhiều lần hơn tóm tắt</strong> — mỗi phần cần ít nhất 1 lần gọi, cộng thêm 1 lần tổng hợp cuối.
              Với thớt này sẽ cần tối thiểu {{ cachedTopic.segments.length + 1 }} lần gọi, thời gian xử lý sẽ <strong>lâu hơn nhiều</strong> so với khi tóm
              tắt.
              <br/>
              Nên thực hiện lúc rảnh và không cần kết quả ngay.
            </p>
          </div>
          <div v-if="hasPartialSegments && !hideWarningAlerts" class="alert alert-warning text-xs mt-2">
            <p class="font-medium">
              Trích xuất chưa hoàn tất, một số đoạn gặp lỗi
            </p>
            <p class="mt-0.5">
              Một hoặc nhiều chunk bị lỗi khi trích xuất. Nguyên nhân khả năng cao là model quá nhỏ -> context window không đủ khiến LLM trả về quá nhiều entry, vượt <code>max_tokens</code>.
              <br/>Có thể bấm <strong>Trích xuất lại</strong> đoạn bị lỗi, hoặc <strong>đổi sang model lớn hơn</strong> trong Cài đặt để trích xuất ổn định hơn.
            </p>
          </div>
          <div class="card space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-(--color-text-secondary)">
                {{knowledgeSegments.filter(s => s.status === 'done' || s.status === 'partial').length}} / {{ knowledgeSegments.length }} đoạn đã trích xuất
              </span>
              <div class="flex items-center gap-3">
                <!-- Batch in progress between segments -->
                <template v-if="isBatchExtracting && !isLoading">
                  <span class="text-xs text-(--color-text-muted) mr-1">Đang chờ...</span>
                  <button class="btn text-xs text-(--color-error-text)" @click="handleCancel">Hủy</button>
                </template>
                <!-- Extract all button -->
                <button v-else-if="!isLoading && knowledgeSegments.some(s => s.status === 'pending' || s.status === 'partial')" class="btn text-xs"
                  @click="onExtractAllClick">
                  Trích xuất tất cả
                </button>
                <button class="btn" @click="segmentGridExpanded = !segmentGridExpanded">
                  <svg class="w-4 h-4 text-(--color-text-secondary) transition-transform duration-200" :class="{ 'rotate-180': segmentGridExpanded }"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>
            <div class="h-1.5 rounded-full bg-(--color-bg-muted) overflow-hidden">
              <div class="h-full rounded-full bg-(--color-accent) transition-all duration-300" :style="{ width: progressPercent + '%' }" />
            </div>
            <div v-if="segmentGridExpanded" class="space-y-1">
              <template v-for="seg in knowledgeSegments" :key="seg.segmentIndex">
                <!-- Row -->
                <div class="flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer hover:bg-(--color-bg-muted) transition-colors"
                  :class="{ 'bg-(--color-accent-soft)': expandedSegmentIndex === seg.segmentIndex }"
                  @click="expandedSegmentIndex = expandedSegmentIndex === seg.segmentIndex ? null : seg.segmentIndex">
                  <!-- Status icon -->
                  <div class="shrink-0 w-4 flex justify-center text-sm leading-none">
                    <template v-if="seg.status === 'done'">
                      <svg class="w-3.5 h-3.5 text-(--color-success-text)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </template>
                    <template v-else-if="seg.status === 'extracting'">
                      <svg class="w-3.5 h-3.5 animate-spin text-(--color-accent)" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </template>
                    <template v-else-if="seg.status === 'partial'">⚠️</template>
                    <template v-else>○</template>
                  </div>
                  <!-- Label -->
                  <span class="flex-1 text-xs text-(--color-text-primary)">
                    Trang {{ seg.startPage }}–{{ seg.endPage }}
                    <span class="text-(--color-text-muted)">
                      · {{ seg.postCount }} bài
                    </span>
                    <!-- Entry count -->
                    <span v-if="seg.rawEntryCount > 0" class="text-(--color-text-muted)">
                      · {{ seg.rawEntryCount }} mục
                    </span>
                    <!-- Relative time -->
                    <span v-if="seg.lastExtractedAt" class="text-(--color-text-muted)">
                      · {{ formatRelativeTime(seg.lastExtractedAt) }}
                    </span>
                  </span>
                  <!-- Action button -->
                  <button v-if="seg.status === 'pending' || seg.status === 'partial'"
                    class="text-xs font-medium shrink-0 link disabled:cursor-not-allowed disabled:text-(--color-text-muted)" :disabled="isLoading"
                    @click.stop="extractSegment(seg.segmentIndex)">
                    {{ seg.status === 'pending' ? 'Trích xuất' : 'Trích xuất lại' }}
                  </button>
                  <button v-else-if="seg.status === 'done'"
                    class="text-xs font-medium shrink-0 link disabled:cursor-not-allowed disabled:text-(--color-text-muted)" :disabled="isLoading"
                    @click.stop="reExtractSegment(seg.segmentIndex)">
                    Làm lại
                  </button>
                  <button v-if="seg.status === 'extracting'"
                    class="text-xs font-medium shrink-0 link disabled:cursor-not-allowed disabled:text-(--color-text-muted)" @click.stop="handleCancel">
                    Hủy
                  </button>
                </div>
                <!-- Task 290: Preview panel for expanded segment -->
                <div v-if="expandedSegmentIndex === seg.segmentIndex" class="ml-6 mb-1 space-y-1">
                  <div v-if="seg.chunks.length === 0" class="text-xs text-(--color-text-muted) py-1 pl-2">
                    Chưa có dữ liệu trích xuất.
                  </div>
                  <template v-else>
                    <div class="flex items-center gap-2 py-0.5">
                      <span class="badge bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">
                        Chưa tổng hợp ({{ seg.rawEntryCount }} mục thô)
                      </span>
                    </div>
                    <div v-for="(entry, ei) in seg.chunks.flatMap(c => c.entries).slice(0, 5)" :key="ei"
                      class="text-xs text-(--color-text-secondary) border-l-2 border-(--color-border) pl-2 py-0.5">
                      <span class="font-medium text-(--color-text-primary)">{{ entry.title }}</span>
                    </div>
                    <div v-if="seg.chunks.flatMap(c => c.entries).length > 5" class="text-xs text-(--color-text-muted) pl-2">
                      + {{seg.chunks.flatMap(c => c.entries).length - 5}} mục khác
                    </div>
                  </template>
                </div>
              </template>
            </div>
          </div>
        </template>

        <!-- F33: Stale reduce banner + reduce prompt (Task 291) -->
        <div v-if="isReduceStale && entries.length > 0 && !isLoading && !hideWarningAlerts" class="alert alert-warning text-xs">
          <div class="flex items-center justify-between gap-2">
            <span>⚠ Có đoạn mới trích xuất chưa được tổng hợp vào danh sách.</span>
            <button class="btn btn-sm btn-soft text-xs shrink-0" @click="onReduceManualClick">Tổng hợp lại</button>
          </div>
        </div>
        <div v-else-if="hasAnyExtractedSegment && entries.length === 0 && !isLoading" class="flex flex-col items-center space-y-2">
          <p class="text-sm text-(--color-text-secondary)">
            Đã trích xuất {{knowledgeSegments.filter(s => s.status === 'done' || s.status === 'partial').length}} đoạn.
            Nhấn Tổng hợp để tạo danh sách kiến thức.
          </p>
          <button class="btn-llm" @click="onReduceManualClick">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
            </svg>
            Tổng hợp kiến thức
          </button>
        </div>

        <!-- Restore button when entries empty but knowledgeChunks exist (legacy non-segment mode only) -->
        <template v-if="allPosts.length && !entries.length && !isLoading && !cachedTopic?.segments?.length">
          <template v-if="canRestore">
            <button class="btn-llm" @click="onRestoreClick">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
              </svg>
              Khôi phục danh sách
            </button>
          </template>
          <!-- Extract button — only when no chunks to restore -->
          <div v-else class="flex flex-col items-center space-y-2">
            <p class="text-sm text-(--color-text-secondary)">Chưa trích xuất kiến thức cho thớt này.</p>
            <button class="btn-llm" @click="onExtractClick">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
              </svg>
              Trích xuất Kiến thức
            </button>
          </div>
        </template>

        <!-- Progress -->
        <StepTimeline v-if="isLoading && activePipeline" :pipeline="activePipeline" :show-cancel="isLoading" @cancel="handleCancel" />
        <ProgressIndicator v-else-if="isLoading" :task-id="llmTaskId" :fallback-message="progressLabel" :show-cancel="isLoading" @cancel="handleCancel" />

        <!-- Error -->
        <div v-if="error" class="alert alert-error text-xs">
          <div class="flex items-start gap-3">
            <svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p class="text-sm flex-1">{{ error }}</p>
            <button class="shrink-0 text-(--color-text-muted) hover:text-(--color-text-primary) transition-colors"
              @click="error = ''; showClearDataAction = false">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <button v-if="showClearDataAction" class="btn btn-sm btn-danger mt-2 text-xs" @click="handleClearKnowledgeData">
            Xoá dữ liệu kiến thức và thử lại
          </button>
        </div>

        <!-- Truncation warning banner -->
        <div v-if="truncationWarning > 0 && !isLoading && !hideWarningAlerts" class="alert alert-warning text-xs">
          <div class="flex items-start gap-3">
            <svg class="w-5 h-5 shrink-0 mt-0.5 text-(--color-warning-text)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div class="flex-1 text-sm text-(--color-warning-text)">
              {{ truncationWarning }} chunk bị cắt ngắn (max_tokens). Kết quả có thể thiếu entries.
              Tăng <strong>Max output tokens</strong> trong Cài đặt rồi thử lại.
            </div>
          </div>
          <button class="btn btn-sm btn-soft mt-2 text-xs" @click="onExtractClick">
            Trích xuất lại
          </button>
        </div>

        <!-- Entry list -->
        <template v-if="entries.length && !isLoading">
          <!-- Search + Saved filter + Tag filter -->
          <div class="space-y-2">
            <!-- Search + Saved filter toggle + Export -->
            <div class="flex items-center gap-2">
              <div class="relative flex-1">
                <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-(--color-text-muted)" fill="none" stroke="currentColor"
                  viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input v-model="searchQuery" type="text" placeholder="Tìm kiến thức..." class="input pl-8 pr-8 text-xs w-full" />
                <!-- Saved filter toggle -->
                <button v-if="savedCount > 0" class="absolute right-2 top-1/2 -translate-y-1/2 transition-colors"
                  :class="showSavedOnly ? 'text-amber-500' : 'text-(--color-text-muted) hover:text-(--color-text-secondary)'"
                  :title="showSavedOnly ? 'Xem tất cả' : `Chỉ hiện đã lưu (${savedCount})`" @click="showSavedOnly = !showSavedOnly">
                  <svg v-if="showSavedOnly" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z" />
                  </svg>
                  <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z" />
                  </svg>
                </button>
              </div>
              <!-- Export knowledge button -->
              <button class="btn btn-ghost btn-sm" title="Xuất kiến thức ra file JSON" @click="handleExportKnowledge">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Xuất JSON
              </button>
            </div>
            <!-- Tag filter pills -->
            <div v-if="allTags.length > 0" class="flex flex-wrap gap-1.5">
              <button v-for="tag in allTags" :key="tag" class="badge capitalize transition-colors" :class="selectedTags.includes(tag)
                ? getTagClass(tag)
                : 'badge-neutral'" @click="toggleTag(tag)">
                {{ tag }}
              </button>
            </div>
            <!-- Category filter pills -->
            <div v-if="allCategories.length > 0" class="flex flex-wrap gap-1.5">
              <button v-if="selectedCategory" class="badge badge-neutral" @click="selectedCategory = null">
                Tất cả
              </button>
              <button v-for="cat in allCategories.slice(0, 10)" :key="cat" class="badge capitalize transition-colors" :class="selectedCategory === cat
                ? 'badge-accent'
                : 'badge-neutral'" @click="selectedCategory = selectedCategory === cat ? null : cat">
                {{ cat }}
              </button>
            </div>
          </div>

          <div class="flex items-center justify-start">
            <!-- Notebook navigation -->
            <div class="flex items-center gap-2">
              <!-- Task 292: Extract dropdown when segments exist -->
              <template v-if="cachedTopic?.segments?.length">
                <div class="relative">
                  <!-- Backdrop to close dropdown -->
                  <div v-if="showExtractDropdown" class="fixed inset-0 z-9" @click="showExtractDropdown = false" />
                  <button class="btn btn-ghost btn-sm flex items-center gap-1" :disabled="isLoading" @click="showExtractDropdown = !showExtractDropdown">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Trích xuất
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div v-if="showExtractDropdown"
                    class="absolute left-0 top-full mt-1 z-10 bg-(--color-bg-surface) border border-(--color-border) rounded shadow-elevated min-w-max">
                    <button class="block w-full text-left px-3 py-2 text-xs hover:bg-(--color-bg-muted) transition-colors"
                      @click="showExtractDropdown = false; onExtractClick()">
                      Trích xuất đoạn chưa xong
                    </button>
                    <button class="block w-full text-left px-3 py-2 text-xs hover:bg-(--color-bg-muted) transition-colors"
                      @click="showExtractDropdown = false; handleClearKnowledgeData().then(() => handleExtract())">
                      Trích xuất lại tất cả
                    </button>
                  </div>
                </div>
              </template>
              <!-- Fallback: no segments — keep original buttons (Task 292) -->
              <template v-else>
                <button v-if="hasFailed && !truncationWarning" class="btn btn-ghost btn-sm flex items-center gap-1 text-(--color-warning-text)"
                  @click="onExtractClick">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Trích xuất lại
                </button>
                <button v-if="allPosts.length && newPostsCount > 0" class="btn btn-ghost btn-sm flex items-center gap-1" @click="handleExtract">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Trích xuất bài mới<span> ({{ newPostsCount }})</span>
                </button>
              </template>
            </div>
            <!-- Clear tracking button -->
            <div v-if="excludedCount > 0" class="flex items-center justify-end">
              <button class="btn btn-ghost btn-sm flex items-center gap-1 hover:text-(--color-error-text)" @click="handleClearTracking">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Xóa tracking ({{ excludedCount }} bài đã loại)
              </button>
            </div>
          </div>

          <!-- Stats -->
          <div class="flex items-center justify-between">
            <span class="text-xs text-(--color-text-muted)">
              {{ filteredEntries.length }}/{{ entries.length }} kiến thức
              <span v-if="cachedTopic?.llmConfig?.model" class="ml-2 italic opacity-70">
                {{ cachedTopic.llmConfig.model }}
              </span>
            </span>
          </div>

          <!-- No results after filter -->
          <div v-if="filteredEntries.length === 0" class="text-center py-6">
            <p class="text-xs text-(--color-text-muted)">Không tìm thấy kiến thức phù hợp với bộ lọc.</p>
          </div>

          <!-- Entry cards grouped by category -->
          <div class="space-y-4">
            <template v-for="group in groupedEntries" :key="group.category">
              <div>
                <h4 class="section-heading mb-2">
                  {{ group.category }}
                  <span class="font-normal normal-case ml-1">({{ group.entries.length }})</span>
                </h4>
                <div class="space-y-2">
                  <div v-for="entry in group.entries" :key="entry.id" :id="`knowledge-entry-${entry.id}`">
                    <KnowledgeEntryCard
                      :entry="normalizeEntry(entry)"
                      :expanded="expandedIds.has(entry.id)"
                      :show-save="true"
                      :show-delete="true"
                      :show-post-link="true"
                      @toggle-expand="toggleExpand"
                      @toggle-save="id => { const e = findEntry(id); if (e) toggleSave(e); }"
                      @delete="id => { const e = findEntry(id); if (e) handleDelete(e); }"
                    />
                  </div>
                </div>
              </div>
            </template>
          </div>
        </template>
      </template>
    </template>
  </div>

  <!-- Cost confirm modal for extract / restore -->
  <CostConfirmModal v-if="confirmTarget === 'extract' && estimatedExtractCost" title="Trích xuất Kiến thức" :estimate="estimatedExtractCost"
    confirm-text="Tiếp tục" :warning="showExtractCostWarning ? 'Thớt dài, số lần gọi API sẽ cao hơn bình thường.' : undefined"
    @confirm="confirmTarget = null; handleExtract()" @cancel="confirmTarget = null" />
  <CostConfirmModal v-else-if="confirmTarget === 'restore' && estimatedRestoreCost" title="Khôi phục danh sách Kiến thức" :estimate="estimatedRestoreCost"
    confirm-text="Tiếp tục" :warning="showRestoreCostWarning ? 'Số chunks lớn, quá trình khôi phục sẽ mất nhiều thời gian.' : undefined"
    @confirm="confirmTarget = null; handleRestore()" @cancel="confirmTarget = null" />
  <CostConfirmModal v-else-if="confirmTarget === 'reduce' && estimatedReduceCost" title="Tổng hợp Kiến thức" :estimate="estimatedReduceCost"
    confirm-text="Tiếp tục" @confirm="confirmTarget = null; runReducePhaseManual()" @cancel="confirmTarget = null" />

  <!-- Cost confirm modal for extract all segments -->
  <CostConfirmModal v-if="showExtractAllModal && estimatedExtractAllCost" title="Trích xuất tất cả đoạn" :estimate="estimatedExtractAllCost"
    confirm-text="Tiếp tục" @confirm="showExtractAllModal = false; extractAllSegments()" @cancel="showExtractAllModal = false" />
</template>