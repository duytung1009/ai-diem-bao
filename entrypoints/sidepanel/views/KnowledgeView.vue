<script setup lang="ts">
import { ref, onActivated, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CachedTopic, KnowledgeEntry, LLMConfig } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import ProgressIndicator from '../components/ProgressIndicator.vue';
import StepTimeline from '../components/StepTimeline.vue';
import { useKnowledge } from '../composables/useKnowledge';
import { useTopicStore } from '../composables/useTopicStore';
import { useSummarize } from '../composables/useSummarize';
import BackButton from '../components/BackButton.vue';
import OperationConflictAlert from '../components/OperationConflictAlert.vue';
import CostConfirmModal from '../components/CostConfirmModal.vue';

const store = useTopicStore();
const knowledge = useKnowledge(store);
const { topicInfo } = useSummarize(store);

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
  browser.tabs.create({ url: `${base}${pageSegment}/post-${postNumber}` });
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

  try {
    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (loadedTopicUrl.value !== topic.url) return;
    if (fresh) {
      store.updateSelectedTopic(fresh);
      if (fresh.knowledgeEntries?.length) entries.value = fresh.knowledgeEntries as KnowledgeEntry[];
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
      const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', url);
      if (fresh) {
        store.updateSelectedTopic(fresh);
        if (fresh.knowledgeEntries?.length) entries.value = fresh.knowledgeEntries as KnowledgeEntry[];
      }
    } catch { /* ignore */ }
  }
});
</script>

<template>
  <div class="p-4 space-y-4">
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
        <h2 class="font-semibold text-sm text-(--color-text-primary)">Trích xuất kiến thức</h2>
      </div>

      <!-- Conflict alert: running task for old topic -->
      <OperationConflictAlert
        v-if="pendingConflict"
        operation="trích xuất kiến thức"
        :oldTopicTitle="loadedTopicTitle"
        :newTopicTitle="pendingConflict.newTitle"
        @cancel="handleConflictCancel"
        @goBack="handleConflictGoBack"
      />

      <template v-if="!pendingConflict">

      <!-- No posts warning -->
      <div v-if="!allPosts.length" class="text-xs alert alert-warning">
        Chưa có dữ liệu của thớt. Vui lòng tóm tắt thớt ở tab "Tóm tắt" trước.
      </div>

      <!-- F33: Per-segment extraction grid (Task 289+290) -->
      <template v-if="cachedTopic?.segments?.length && allPosts.length">
        <!-- Info banner: chỉ hiển thị khi > 5 phân đoạn để giải thích thời gian tốn -->
        <div v-if="cachedTopic.segments.length > 5" class="text-xs alert alert-info">
          <p class="font-medium">Thớt dài ({{ cachedTopic.segments.length }} phần)</p>
          <p class="mt-0.5">
            Trích xuất kiến thức gọi API <strong>nhiều lần hơn tóm tắt</strong> — mỗi phần cần ít nhất 1 lần gọi, cộng thêm 1 lần tổng hợp cuối.
            Với thớt này sẽ cần tối thiểu {{ cachedTopic.segments.length + 1 }} lần gọi, thời gian xử lý có thể <strong>lâu hơn nhiều</strong> so với khi tóm tắt.
            Nên thực hiện lúc rảnh và không cần kết quả ngay.
          </p>
        </div>
        <div class="card space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-(--color-text-secondary)">
              {{ knowledgeSegments.filter(s => s.status === 'done' || s.status === 'partial').length }} / {{ knowledgeSegments.length }} đoạn đã trích xuất
            </span>
            <div class="flex items-center gap-1">
              <!-- Batch in progress between segments -->
              <template v-if="isBatchExtracting && !isLoading">
                <span class="text-xs text-(--color-text-muted) mr-1">Đang chờ...</span>
                <button class="btn text-xs text-red-500 dark:text-red-400" @click="handleCancel">Hủy</button>
              </template>
              <!-- Extract all button -->
              <button
                v-else-if="!isLoading && knowledgeSegments.some(s => s.status === 'pending' || s.status === 'partial')"
                class="btn text-xs"
                @click="extractAllSegments">
                Trích xuất tất cả
              </button>
              <button class="btn" @click="segmentGridExpanded = !segmentGridExpanded">
                <svg class="w-4 h-4 text-(--color-text-secondary) transition-transform duration-200"
                  :class="{ 'rotate-180': segmentGridExpanded }"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>
          <div class="h-1.5 rounded-full bg-(--color-bg-muted) overflow-hidden">
            <div class="h-full rounded-full bg-blue-500 transition-all duration-300" :style="{ width: progressPercent + '%' }" />
          </div>
          <div v-if="segmentGridExpanded" class="space-y-1">
            <template v-for="seg in knowledgeSegments" :key="seg.segmentIndex">
              <!-- Row -->
              <div
                class="flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer hover:bg-(--color-bg-muted) transition-colors"
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
                    <svg class="w-3.5 h-3.5 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
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
                <button
                  v-if="seg.status === 'pending' || seg.status === 'partial'"
                  class="text-xs font-medium shrink-0 no-underline disabled:cursor-not-allowed disabled:text-(--color-text-muted) hover:enabled:text-blue-500"
                  :disabled="isLoading"
                  @click.stop="extractSegment(seg.segmentIndex)">
                  {{ seg.status === 'pending' ? 'Trích xuất' : 'Trích xuất lại' }}
                </button>
                <button
                  v-else-if="seg.status === 'done'"
                  class="text-xs font-medium shrink-0 no-underline disabled:cursor-not-allowed disabled:text-(--color-text-muted) hover:enabled:text-blue-500"
                  :disabled="isLoading"
                  @click.stop="reExtractSegment(seg.segmentIndex)">
                  Làm lại
                </button>
                <button
                  v-if="seg.status === 'extracting'"
                  class="text-xs font-medium shrink-0 no-underline disabled:cursor-not-allowed disabled:text-(--color-text-muted) hover:enabled:text-blue-500"
                  @click.stop="handleCancel">
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
                    <span class="badge text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">
                      Chưa tổng hợp ({{ seg.rawEntryCount }} mục thô)
                    </span>
                  </div>
                  <div
                    v-for="(entry, ei) in seg.chunks.flatMap(c => c.entries).slice(0, 5)"
                    :key="ei"
                    class="text-xs text-(--color-text-secondary) border-l-2 border-(--color-border) pl-2 py-0.5">
                    <span class="font-medium text-(--color-text-primary)">{{ entry.title }}</span>
                  </div>
                  <div v-if="seg.chunks.flatMap(c => c.entries).length > 5"
                    class="text-xs text-(--color-text-muted) pl-2">
                    + {{ seg.chunks.flatMap(c => c.entries).length - 5 }} mục khác
                  </div>
                </template>
              </div>
            </template>
          </div>
        </div>
      </template>

      <!-- F33: Stale reduce banner + reduce prompt (Task 291) -->
      <div v-if="isReduceStale && entries.length > 0 && !isLoading" class="text-xs alert alert-warning">
        <div class="flex items-center justify-between gap-2">
          <span>⚠ Có đoạn mới trích xuất chưa được tổng hợp vào danh sách.</span>
          <button class="btn btn-sm text-xs shrink-0" @click="onReduceManualClick">Tổng hợp lại</button>
        </div>
      </div>
      <div v-else-if="hasAnyExtractedSegment && entries.length === 0 && !isLoading"
        class="flex flex-col items-center space-y-2">
        <p class="text-sm text-(--color-text-secondary)">
          Đã trích xuất {{ knowledgeSegments.filter(s => s.status === 'done' || s.status === 'partial').length }} đoạn.
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
      <div v-if="error" class="text-xs alert alert-error">
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
      <div v-if="truncationWarning > 0 && !isLoading" class="text-xs alert alert-warning">
        <div class="flex items-start gap-3">
          <svg class="w-5 h-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div class="flex-1 text-sm text-amber-800 dark:text-amber-200">
            {{ truncationWarning }} chunk bị cắt ngắn (max_tokens). Kết quả có thể thiếu entries.
            Tăng <strong>Max output tokens</strong> trong Cài đặt rồi thử lại.
          </div>
        </div>
        <button class="btn btn-sm mt-2 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-800/60 border-amber-300 dark:border-amber-700"
          @click="onExtractClick">
          Trích xuất lại
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
          <!-- Tag filter pills -->
          <div v-if="allTags.length > 0" class="flex flex-wrap gap-1.5">
            <button v-for="tag in allTags" :key="tag" class="px-2 py-0.5 rounded-full text-xs transition-colors" :class="selectedTags.includes(tag)
              ? getTagClass(tag)
              : 'bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft)'" @click="toggleTag(tag)">
              {{ tag }}
            </button>
          </div>
          <!-- Category filter pills -->
          <div v-if="allCategories.length > 0" class="flex flex-wrap gap-1.5">
            <button v-if="selectedCategory"
              class="px-2 py-0.5 rounded-full text-xs transition-colors bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft)"
              @click="selectedCategory = null">
              Tất cả
            </button>
            <button v-for="cat in allCategories" :key="cat" class="px-2 py-0.5 rounded-full text-xs transition-colors" :class="selectedCategory === cat
              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
              : 'bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft)'"
              @click="selectedCategory = selectedCategory === cat ? null : cat">
              {{ cat }}
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <!-- Re-extract -->
          <div class="flex items-center gap-2">
            <button class="btn text-xs flex items-center gap-1" @click="router.push('/notebook')">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Sổ tay
            </button>
            <!-- Task 292: Extract dropdown when segments exist -->
            <template v-if="cachedTopic?.segments?.length">
              <div class="relative">
                <!-- Backdrop to close dropdown -->
                <div v-if="showExtractDropdown" class="fixed inset-0 z-9" @click="showExtractDropdown = false" />
                <button
                  class="btn text-xs flex items-center gap-1"
                  :disabled="isLoading"
                  @click="showExtractDropdown = !showExtractDropdown">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Trích xuất
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div
                  v-if="showExtractDropdown"
                  class="absolute left-0 top-full mt-1 z-10 bg-(--color-bg-elevated) border border-(--color-border) rounded shadow-lg min-w-max">
                  <button
                    class="block w-full text-left px-3 py-2 text-xs hover:bg-(--color-bg-muted) transition-colors"
                    @click="showExtractDropdown = false; onExtractClick()">
                    Trích xuất đoạn chưa xong
                  </button>
                  <button
                    class="block w-full text-left px-3 py-2 text-xs hover:bg-(--color-bg-muted) transition-colors"
                    @click="showExtractDropdown = false; handleClearKnowledgeData().then(() => handleExtract())">
                    Trích xuất lại tất cả
                  </button>
                </div>
              </div>
            </template>
            <!-- Fallback: no segments — keep original buttons (Task 292) -->
            <template v-else>
              <button v-if="hasFailed && !truncationWarning" class="btn text-xs flex items-center gap-1 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30"
                @click="onExtractClick">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Trích xuất lại
              </button>
              <button v-if="allPosts.length && newPostsCount > 0" class="btn text-xs flex items-center gap-1" @click="handleExtract">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Trích xuất bài mới<span> ({{ newPostsCount }})</span>
              </button>
            </template>
          </div>
          <!-- Clear tracking button -->
          <div v-if="excludedCount > 0" class="flex items-center justify-end">
            <button class="btn text-xs flex items-center gap-1 hover:text-red-600 dark:hover:text-red-400" @click="handleClearTracking">
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
              <h4 class="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide mb-2">
                {{ group.category }}
                <span class="font-normal normal-case ml-1">({{ group.entries.length }})</span>
              </h4>
              <div class="space-y-2">
                <div v-for="entry in group.entries" :key="entry.id" :id="`knowledge-entry-${entry.id}`" class="card">
                  <!-- Header: always visible, click to expand -->
                  <div class="flex items-start gap-2 cursor-pointer" @click="toggleExpand(entry.id)">
                    <!-- Chevron icon -->
                    <svg class="w-3.5 h-3.5 mt-0.5 shrink-0 transition-transform duration-200 text-(--color-text-muted)"
                      :class="expandedIds.has(entry.id) ? 'rotate-90' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                    <p class="text-sm font-semibold text-(--color-text-primary) flex-1 leading-snug">{{ entry.title }}</p>
                    <!-- Save button -->
                    <button class="p-0.5 transition-colors rounded" :class="entry.saved
                      ? 'text-yellow-500 dark:text-yellow-400'
                      : 'text-gray-300 dark:text-gray-600 hover:text-yellow-500 dark:hover:text-yellow-400'" :title="entry.saved ? 'Bỏ lưu' : 'Lưu kiến thức'"
                      @click.stop="toggleSave(entry)">
                      <svg v-if="entry.saved" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z" />
                      </svg>
                      <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z" />
                      </svg>
                    </button>
                    <!-- Delete button -->
                    <button class="p-0.5 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded"
                      title="Xóa kiến thức" @click.stop="handleDelete(entry)">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>

                  <!-- Body: collapsible with CSS Grid animation -->
                  <div class="grid transition-[grid-template-rows] duration-200 ease-in-out"
                    :class="expandedIds.has(entry.id) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
                    <div class="overflow-hidden">
                      <div class="pt-2 space-y-2">
                        <p class="text-xs text-(--color-text-secondary) leading-relaxed">{{ entry.content }}</p>
                        <!-- Tags -->
                        <div v-if="entry.tags.length > 0" class="flex flex-wrap gap-1">
                          <span v-for="tag in entry.tags" :key="tag" class="px-1.5 py-0.5 rounded text-xs" :class="getTagClass(tag)">
                            {{ tag }}
                          </span>
                        </div>
                        <!-- Source citation with timestamp -->
                        <p class="text-xs text-(--color-text-muted)">
                          — {{ entry.source.author }}<template v-if="entry.source.postNumber">, bài <button class="font-mono hover:underline cursor-pointer"
                              @click="openPostLink(entry.source.postNumber)">#{{ entry.source.postNumber }}</button></template><span
                            v-if="entry.source.timestamp">{{ formatTimestamp(entry.source.timestamp)
                            }}</span>
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
    </template>
    </template>
  </div>

  <!-- Cost confirm modal for extract / restore -->
  <CostConfirmModal
    v-if="confirmTarget === 'extract' && estimatedExtractCost"
    title="Trích xuất Kiến thức"
    :estimate="estimatedExtractCost"
    confirm-text="Tiếp tục"
    :warning="showExtractCostWarning ? 'Thớt dài, số lần gọi API sẽ cao hơn bình thường.' : undefined"
    @confirm="confirmTarget = null; handleExtract()"
    @cancel="confirmTarget = null"
  />
  <CostConfirmModal
    v-else-if="confirmTarget === 'restore' && estimatedRestoreCost"
    title="Khôi phục danh sách Kiến thức"
    :estimate="estimatedRestoreCost"
    confirm-text="Tiếp tục"
    :warning="showRestoreCostWarning ? 'Số chunks lớn, quá trình khôi phục sẽ mất nhiều thời gian.' : undefined"
    @confirm="confirmTarget = null; handleRestore()"
    @cancel="confirmTarget = null"
  />
  <CostConfirmModal
    v-else-if="confirmTarget === 'reduce' && estimatedReduceCost"
    title="Tổng hợp Kiến thức"
    :estimate="estimatedReduceCost"
    confirm-text="Tiếp tục"
    @confirm="confirmTarget = null; runReducePhaseManual()"
    @cancel="confirmTarget = null"
  />
</template>