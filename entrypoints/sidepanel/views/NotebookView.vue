<script setup lang="ts">
import { ref, computed, onActivated } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage, sendMessageQuiet } from '@/lib/messaging';
import type { NotebookEntry, CachedTopic } from '@/lib/types';
import { buildNotebookExport, downloadJson, safeFilename } from '@/lib/exporter';
import { parseAnswerHtml } from '@/lib/qa-parser';
import { useNotebook, type ViewMode } from '../composables/useNotebook';
import { useTopicStore } from '../composables/useTopicStore';
import NotebookEntryEditor from '../components/NotebookEntryEditor.vue';
import NotebookQAPanel from '../components/NotebookQAPanel.vue';
import KnowledgeEntryCard from '../components/KnowledgeEntryCard.vue';
import type { KnowledgeCardEntry } from '../components/KnowledgeEntryCard.vue';
import PillTabs from '../components/PillTabs.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import { useNotebookQA } from '../composables/useNotebookQA';
import type { GlobalKnowledgeEntry } from '@/lib/types';

const router = useRouter();
const store = useTopicStore();
const { entries, stats, isLoading, error, filters, viewMode, allTags, allTopicUrls, filteredEntries, groupedEntries, loadEntries, loadStats, unsaveEntry } = useNotebook();

// Sub-tabs
const notebookSubTab = ref<'entries' | 'qa' | 'knowledge'>('entries');
const subTabs = [
  { value: 'entries' as const, label: 'Sổ tay' },
  { value: 'qa' as const, label: 'Hỏi đáp' },
  { value: 'knowledge' as const, label: 'Kho kiến thức' },
];

// Q&A (notebook)
const { history: qaHistory, isLoading: qaLoading, progressMessage: qaProgress, error: qaError, pendingConfirm: qaPendingConfirm, ask: qaAsk, confirmAsk: qaConfirmAsk, cancelConfirm: qaCancelConfirm, cancelQA, clearHistory: clearQAHistory } = useNotebookQA();

// Global knowledge entries list
const knowledgeEntries = ref<GlobalKnowledgeEntry[]>([]);
const knowledgeLoading = ref(false);
const knowledgeSearchInput = ref('');
const knowledgeExpandedIds = ref(new Set<string>());
const knowledgeSort = ref<'recent' | 'title' | 'sources'>('recent');
const knowledgeFiltered = computed(() => {
  if (!knowledgeSearchInput.value) return knowledgeEntries.value;
  const q = knowledgeSearchInput.value.toLowerCase();
  return knowledgeEntries.value.filter(e =>
    e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) || e.tags.some(t => t.toLowerCase().includes(q))
  );
});

const knowledgeSorted = computed(() => {
  const items = [...knowledgeFiltered.value];
  switch (knowledgeSort.value) {
    case 'recent':
      items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      break;
    case 'title':
      items.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
      break;
    case 'sources':
      items.sort((a, b) => b.sources.length - a.sources.length);
      break;
  }
  return items;
});

const knowledgeGrouped = computed(() => {
  const groups: Record<string, GlobalKnowledgeEntry[]> = {};
  for (const e of knowledgeSorted.value) {
    const label = e.sources[0]?.topicTitle ?? e.topicRefs[0] ?? 'Khác';
    if (!groups[label]) groups[label] = [];
    groups[label].push(e);
  }
  return Object.entries(groups)
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([key, entries]) => ({ key, entries }));
});

// Convert global knowledge entries to NotebookEntry shape for the QA composable.
const knowledgeEntriesForQA = computed<NotebookEntry[]>(() =>
  knowledgeEntries.value.map(e => {
    const s = e.sources[0];
    return {
      id: e.id,
      title: e.title,
      content: e.content,
      tags: [...e.tags],
      category: e.category,
      source: { author: s?.author ?? '', postNumber: s?.postNumber ?? 0, timestamp: s?.timestamp },
      extractedAt: e.extractedAt,
      saved: false,
      savedAt: e.extractedAt,
      sourceTopicUrl: s?.topicUrl ?? e.topicRefs[0] ?? '',
      sourceTopicTitle: s?.topicTitle ?? '',
    };
  })
);

async function loadKnowledgeEntries() {
  knowledgeLoading.value = true;
  try {
    knowledgeEntries.value = await sendMessage<GlobalKnowledgeEntry[]>('GET_ALL_KNOWLEDGE') ?? [];
  } catch { knowledgeEntries.value = []; }
  finally { knowledgeLoading.value = false; }
}

async function refreshPinnedIds(): Promise<void> {
  try {
    const nb = await sendMessage<NotebookEntry[]>('GET_NOTEBOOK_ENTRIES') ?? [];
    pinnedEntryIds.value = new Set(nb.map(e => e.id));
  } catch { /* keep */ }
}

function normalizeKnowledgeEntry(entry: GlobalKnowledgeEntry): KnowledgeCardEntry {
  const primarySource = entry.sources[0];
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    tags: entry.tags,
    category: entry.category,
    sourceAuthor: primarySource?.author ?? '',
    sourcePostNumber: primarySource?.postNumber,
    sourceTimestamp: primarySource?.timestamp,
    pinned: pinnedEntryIds.value.has(entry.id),
    mergedCount: entry.mergedCount,
    sourcesCount: entry.sources.length,
    topicRefsCount: entry.topicRefs.length,
    postUrl: entry.topicRefs[0],
  };
}

function findKnowledgeEntry(id: string): GlobalKnowledgeEntry | undefined {
  return knowledgeEntries.value.find(e => e.id === id);
}

// Pin to notebook
const pinnedEntryIds = ref(new Set<string>());
async function pinToNotebook(entry: GlobalKnowledgeEntry) {
  if (pinnedEntryIds.value.has(entry.id)) return;
  const primarySource = entry.sources[0];
  const notebookEntry: NotebookEntry = {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    tags: entry.tags,
    category: entry.category,
    source: { author: primarySource?.author ?? '', postNumber: primarySource?.postNumber ?? 0 },
    sourceTopicUrl: primarySource?.topicUrl ?? entry.topicRefs[0] ?? '',
    sourceTopicTitle: primarySource?.topicTitle ?? '',
    savedAt: Date.now(),
    extractedAt: entry.extractedAt,
    manual: 0,
  };
  try {
    await sendMessage('UPSERT_NOTEBOOK_ENTRY', notebookEntry);
    pinnedEntryIds.value = new Set([...pinnedEntryIds.value, entry.id]);
    await loadEntries();
    await loadStats();
  } catch (err) { console.warn('[NotebookView] pin failed', err); }
}

// Focus entry (for citation click)
const focusEntryId = ref<string | null>(null);

function handleCitationClick(entryId: string) {
  notebookSubTab.value = 'knowledge';
  knowledgeSearchInput.value = '';
  knowledgeExpandedIds.value.add(entryId);
  setTimeout(() => {
    document.getElementById(`knowledge-global-${entryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

const expandedIds = ref<Set<string>>(new Set());
const editingId = ref<string | null>(null);

// Bulk select
const isSelectMode = ref(false);
const selectedIds = ref(new Set<string>());

const selectedEntries = computed(() => entries.value.filter(e => selectedIds.value.has(e.id)));
const selectedTags = computed(() => {
  const tags = new Set<string>();
  for (const e of selectedEntries.value) e.tags.forEach(t => tags.add(t));
  return [...tags].sort();
});

const bulkCategory = ref('');
const bulkAddTag = ref('');
const bulkRemoveTag = ref('');
const bulkDeleteConfirm = ref(false);

function toggleSelectMode() {
  isSelectMode.value = !isSelectMode.value;
  if (!isSelectMode.value) selectedIds.value = new Set();
  bulkDeleteConfirm.value = false;
}

function toggleSelect(id: string) {
  const s = new Set(selectedIds.value);
  s.has(id) ? s.delete(id) : s.add(id);
  selectedIds.value = s;
}

function selectAll() {
  selectedIds.value = new Set(filteredEntries.value.map(e => e.id));
}

async function applyBulkCategory() {
  const cat = bulkCategory.value.trim() || undefined;
  const ids = [...selectedIds.value];
  if (!ids.length) return;
  try {
    await sendMessage('BULK_UPDATE_NOTEBOOK_ENTRIES', { ids, patch: { category: cat ?? null, editedAt: Date.now() } });
    await Promise.all([loadEntries(), loadStats()]);
    bulkCategory.value = '';
  } catch (err) { console.warn('[NotebookView] bulk category failed', err); }
}

async function applyBulkAddTag() {
  const tag = bulkAddTag.value.trim().toLowerCase();
  if (!tag) return;
  const ids = [...selectedIds.value];
  try {
    await sendMessage('BULK_UPDATE_NOTEBOOK_ENTRIES', { ids, patch: { addTags: [tag], editedAt: Date.now() } });
    await Promise.all([loadEntries(), loadStats()]);
    bulkAddTag.value = '';
  } catch (err) { console.warn('[NotebookView] bulk add tag failed', err); }
}

async function applyBulkRemoveTag() {
  if (!bulkRemoveTag.value) return;
  const ids = [...selectedIds.value];
  try {
    await sendMessage('BULK_UPDATE_NOTEBOOK_ENTRIES', { ids, patch: { removeTags: [bulkRemoveTag.value], editedAt: Date.now() } });
    await Promise.all([loadEntries(), loadStats()]);
    bulkRemoveTag.value = '';
  } catch (err) { console.warn('[NotebookView] bulk remove tag failed', err); }
}

async function applyBulkDelete() {
  const ids = [...selectedIds.value];
  try {
    await sendMessage('BULK_DELETE_NOTEBOOK_ENTRIES', { ids });
    entries.value = entries.value.filter(e => !selectedIds.value.has(e.id));
    selectedIds.value = new Set();
    bulkDeleteConfirm.value = false;
    await loadStats();
  } catch (err) { console.warn('[NotebookView] bulk delete failed', err); }
}

// Manual entry creation
const showCreateForm = ref(false);
const newEntryDraft = ref<NotebookEntry | null>(null);

function startCreateEntry() {
  newEntryDraft.value = {
    id: crypto.randomUUID(),
    title: '',
    content: '',
    tags: [],
    savedAt: Date.now(),
    sourceTopicUrl: '',
    sourceTopicTitle: '',
    source: { author: 'Bạn', postNumber: 0 },
    manual: 1,
    extractedAt: Date.now(),
  };
  showCreateForm.value = true;
}

async function handleSaveQAAsNote(question: string, answer: string, selectedEntryIds: string[], citedEntryIds?: string[]) {
  const htmlContent = parseAnswerHtml(answer, selectedEntryIds);
  const citedMeta = (citedEntryIds && citedEntryIds.length > 0) ? JSON.stringify({
    ids: citedEntryIds,
    titles: citedEntryIds.map(id => knowledgeEntries.value.find(e => e.id === id)?.title ?? id),
  }) : undefined;
  const entry: NotebookEntry = {
    id: crypto.randomUUID(),
    title: question.slice(0, 80) || 'Hỏi đáp',
    content: htmlContent,
    userNote: citedMeta,
    tags: [],
    savedAt: Date.now(),
    extractedAt: Date.now(),
    sourceTopicUrl: '',
    sourceTopicTitle: '',
    source: { author: 'Hỏi đáp', postNumber: 0 },
    manual: 1,
    category: 'Hỏi đáp',
  };
  await handleCreateEntry(entry);
}

interface QACitedEntry { id: string; title: string }

function parseQACitedEntries(userNote: string | undefined): QACitedEntry[] {
  if (!userNote) return [];
  try {
    const meta = JSON.parse(userNote);
    if (meta.ids && meta.titles) {
      return meta.ids.map((id: string, i: number) => ({ id, title: meta.titles[i] ?? id }));
    }
  } catch { /* not Q&A meta */ }
  return [];
}

function handleQACitationClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('[data-entry-id]') as HTMLElement | null;
  if (btn?.dataset.entryId) handleCitationClick(btn.dataset.entryId);
}

async function handleCreateEntry(entry: NotebookEntry) {
  try {
    await sendMessage('UPSERT_NOTEBOOK_ENTRY', entry);
    entries.value = [entry, ...entries.value];
    showCreateForm.value = false;
    newEntryDraft.value = null;
    await loadStats();
  } catch (err) { console.warn('[NotebookView] create manual entry failed', err); }
}

// Category counts — used by the bulk-actions category datalist
const categoryCounts = computed<[string, number][]>(() => {
  const counts = new Map<string, number>();
  entries.value.forEach(e => {
    const cat = e.category || 'Khác';
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  });
  return [...counts.entries()].sort(([a], [b]) =>
    a === 'Khác' ? 1 : b === 'Khác' ? -1 : a.localeCompare(b, 'vi'),
  );
});

function startEdit(entry: NotebookEntry) {
  expandedIds.value = new Set([...expandedIds.value, entry.id]);
  editingId.value = entry.id;
}

function cancelEdit() {
  editingId.value = null;
}

async function handleSaveEntry(updated: NotebookEntry) {
  try {
    await sendMessage('UPSERT_NOTEBOOK_ENTRY', updated);
    entries.value = entries.value.map(e => e.id === updated.id ? updated : e);
    editingId.value = null;

    // Sync topic cache fire-and-forget
    if (updated.sourceTopicUrl && !updated.manual) {
      sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', updated.sourceTopicUrl).then(cached => {
        if (!cached?.knowledgeEntries) return;
        const updatedEntries = cached.knowledgeEntries.map(e => e.id === updated.id ? updated : e);
        sendMessageQuiet('SAVE_CACHED_TOPIC', { url: updated.sourceTopicUrl, knowledgeEntries: updatedEntries });
      }).catch(() => { });
    }
  } catch (err) {
    console.warn('[NotebookView] save entry failed', err);
  }
}

function toggleExpand(id: string) {
  const s = new Set(expandedIds.value);
  s.has(id) ? s.delete(id) : s.add(id);
  expandedIds.value = s;
}

function openPostLink(entry: NotebookEntry) {
  const base = entry.sourceTopicUrl.replace(/\/$/, '');
  const pageSegment = entry.source?.postNumber ? `/post-${entry.source.postNumber}` : '';
  browser.tabs.create({ url: `${base}${pageSegment}` });
}

async function openInExtension(entry: NotebookEntry) {
  const cached = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', entry.sourceTopicUrl);
  if (cached) {
    store.selectTopic(cached);
    router.push(`/knowledge?focus=${entry.id}`);
  } else {
    openPostLink(entry);
  }
}

function handleExportGroup(group: { key: string; entries: NotebookEntry[] }) {
  const payload = buildNotebookExport(group.entries);
  const name = group.entries[0]?.sourceTopicTitle ?? group.key;
  downloadJson(payload, `${safeFilename(name)}_notebook.json`);
}

function handleExportEntry(entry: NotebookEntry) {
  const payload = buildNotebookExport([entry]);
  const name = entry.sourceTopicTitle || entry.title;
  downloadJson(payload, `${safeFilename(name)}_entry.json`);
}

function formatTimestamp(ts: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

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

const viewModes: { value: ViewMode; label: string }[] = [
  { value: 'topic', label: 'Thớt' },
  { value: 'timeline', label: 'Dòng thời gian' },
  { value: 'category', label: 'Danh mục' },
  { value: 'tag', label: 'Tag' },
];

async function handleUnsave(entry: NotebookEntry) {
  await unsaveEntry(entry);
}

onActivated(async () => {
  await Promise.all([loadEntries(), loadStats(), loadKnowledgeEntries(), refreshPinnedIds()]);
});
</script>

<template>
  <div class="p-3 flex flex-col h-full space-y-2">
    <!-- Sub-tab bar -->
    <PillTabs :tabs="subTabs" :model-value="notebookSubTab"
      :loading-tabs="qaLoading ? new Set(['qa'] as const) : undefined"
      :dot-tabs="knowledgeLoading ? new Set(['knowledge'] as const) : undefined"
      @update:model-value="notebookSubTab = $event" />

    <!-- Q&A tab -->
    <div v-show="notebookSubTab === 'qa'" class="flex-1 min-h-0 flex flex-col">
      <p class="text-xs text-(--color-text-muted)">
        Tra cứu trên toàn bộ kho kiến thức — {{ knowledgeEntries.length }} mục từ tất cả thớt đã trích xuất.
      </p>
      <LoadingSpinner v-if="knowledgeLoading" text="Đang tải kho kiến thức..." />
      <NotebookQAPanel v-else :entries="knowledgeEntriesForQA" :history="qaHistory" :is-loading="qaLoading" :progress-message="qaProgress" :error="qaError"
        :pending-confirm="qaPendingConfirm" @ask="q => qaAsk(q, knowledgeEntriesForQA)" @confirm-ask="qaConfirmAsk" @cancel-confirm="qaCancelConfirm"
        @cancel-q-a="cancelQA" @citation-click="handleCitationClick" @save-as-note="handleSaveQAAsNote" @clear-history="clearQAHistory" />
    </div>

    <!-- Entries tab -->
    <div v-show="notebookSubTab === 'entries'">
      <!-- Header -->
      <div class="space-y-2">
        <!-- Tab description -->
        <p class="text-xs text-(--color-text-muted)">
          Ghi chú đã lưu từ các thớt. Nhấn ⭐ trong tab Kiến thức của bất kỳ thớt nào để lưu.
        </p>
        <!-- Search -->
        <div class="relative">
          <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-(--color-text-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input v-model="filters.search" type="text" placeholder="Tìm kiếm ghi chú..." class="input pl-8 pr-8 text-xs w-full" />
        </div>

        <!-- Stats + create button -->
        <div class="flex items-center gap-2">
          <p class="text-xs text-(--color-text-muted) flex-1">
            {{ filteredEntries.length }}/{{ stats.totalEntries }} ghi chú
          </p>
          <button class="btn btn-ghost btn-sm text-xs shrink-0" @click="startCreateEntry">
            + Ghi chú
          </button>
        </div>

        <!-- Filter bar -->
        <div class="space-y-2">
          <!-- Tag pills -->
          <!-- <div v-if="allTags.length > 0" class="flex flex-wrap gap-1.5">
            <button v-for="tag in allTags" :key="tag" class="badge capitalize transition-colors" :class="filters.tag === tag
              ? getTagClass(tag)
              : 'badge-neutral'" @click="filters.tag = filters.tag === tag ? null : tag">
              {{ tag }}
            </button>
          </div> -->
          <!-- Category pills -->
          <div v-if="stats.categories.length > 0" class="flex flex-wrap gap-1.5 items-center">
            <button v-if="filters.category" class="badge badge-neutral" @click="filters.category = null">
              Tất cả danh mục
            </button>
            <button v-for="cat in stats.categories" :key="cat" class="badge capitalize transition-colors" :class="filters.category === cat
              ? 'badge-accent'
              : 'badge-neutral'" @click="filters.category = filters.category === cat ? null : cat">
              {{ cat }}
            </button>
          </div>
        </div>

        <!-- View mode buttons -->
        <div class="flex items-center gap-2 text-xs flex-wrap">
          <span class="text-(--color-text-secondary)">Sắp xếp:</span>
          <button v-for="vm in viewModes" :key="vm.value" class="badge capitalize transition-colors" :class="viewMode === vm.value
            ? 'badge-accent'
            : 'badge-neutral'" @click="viewMode = vm.value">
            {{ vm.label }}
          </button>
          <button v-if="entries.length > 0" class="badge ml-auto transition-colors" :class="isSelectMode ? 'badge-accent' : 'badge-neutral'"
            @click="toggleSelectMode">
            {{ isSelectMode ? 'Thoát chọn' : 'Chọn' }}
          </button>
        </div>

        <!-- Bulk actions bar -->
        <div v-if="isSelectMode" class="card text-xs space-y-2">
          <!-- Selection count + select all / clear -->
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-(--color-text-secondary) font-medium">{{ selectedIds.size }} đã chọn</span>
            <button class="link text-xs" @click="selectAll">Chọn tất cả</button>
            <button v-if="selectedIds.size > 0" class="link text-xs" @click="selectedIds = new Set()">Bỏ chọn</button>
          </div>

          <template v-if="selectedIds.size > 0">
            <!-- Bulk category -->
            <div class="flex items-center gap-1.5">
              <label class="text-(--color-text-muted) shrink-0">Danh mục:</label>
              <input v-model="bulkCategory" type="text" :list="`bulk-cat-list`" class="input text-xs flex-1 min-w-0" placeholder="Tên danh mục (trống = xóa)..."
                @keydown.enter="applyBulkCategory" />
              <datalist id="bulk-cat-list">
                <option v-for="[cat] in categoryCounts" :key="cat" :value="cat === 'Khác' ? '' : cat" />
              </datalist>
              <button class="btn btn-primary btn-sm text-xs px-2 shrink-0" @click="applyBulkCategory">Áp dụng</button>
            </div>

            <!-- Bulk add tag -->
            <div class="flex items-center gap-1.5">
              <label class="text-(--color-text-muted) shrink-0">Thêm tag:</label>
              <input v-model="bulkAddTag" type="text" class="input text-xs flex-1 min-w-0" placeholder="Tag mới..." @keydown.enter="applyBulkAddTag" />
              <button class="btn btn-primary btn-sm text-xs px-2 shrink-0" @click="applyBulkAddTag">Thêm</button>
            </div>

            <!-- Bulk remove tag -->
            <div v-if="selectedTags.length > 0" class="flex items-center gap-1.5">
              <label class="text-(--color-text-muted) shrink-0">Xóa tag:</label>
              <select v-model="bulkRemoveTag" class="input text-xs flex-1 min-w-0">
                <option value="">-- Chọn tag --</option>
                <option v-for="tag in selectedTags" :key="tag" :value="tag">{{ tag }}</option>
              </select>
              <button class="btn btn-ghost btn-sm text-xs px-2 shrink-0 text-(--color-error-text)" @click="applyBulkRemoveTag">Xóa</button>
            </div>

            <!-- Bulk delete -->
            <div v-if="!bulkDeleteConfirm">
              <button class="btn btn-ghost btn-sm text-xs text-(--color-error-text)" @click="bulkDeleteConfirm = true">
                Xóa {{ selectedIds.size }} mục
              </button>
            </div>
            <div v-else class="bg-(--color-error-bg) text-(--color-error-text) rounded p-2 space-y-1.5">
              <p>Xóa vĩnh viễn {{ selectedIds.size }} mục đã chọn?</p>
              <div class="flex gap-2">
                <button class="btn btn-sm text-xs px-2 bg-(--color-error-text) text-white" @click="applyBulkDelete">Xóa</button>
                <button class="btn btn-ghost btn-sm text-xs px-2" @click="bulkDeleteConfirm = false">Hủy</button>
              </div>
            </div>
          </template>
        </div>

        <!-- Loading -->
        <LoadingSpinner v-if="isLoading" text="Đang tải ghi chú..." />

        <!-- Error -->
        <div v-if="error" class="alert alert-error text-xs">{{ error }}</div>

        <!-- Empty state -->
        <div v-if="!isLoading && entries.length === 0" class="card text-center py-10 space-y-3">
          <div class="text-3xl">📝</div>
          <p class="text-sm text-(--color-text-primary) font-medium">Chưa có ghi chú nào</p>
          <p class="text-xs text-(--color-text-muted)">Vào tab <strong>Kiến thức</strong> của bất kỳ thớt nào, nhấn ⭐ để lưu vào đây.</p>
          <button class="btn btn-sm btn-primary" @click="startCreateEntry">+ Tạo ghi chú thủ công</button>
        </div>

        <!-- Create manual entry form -->
        <div v-if="showCreateForm && newEntryDraft" class="card">
          <p class="text-xs text-(--color-text-muted) font-medium mb-1">Tạo ghi chú mới</p>
          <NotebookEntryEditor :entry="newEntryDraft" :all-categories="stats.categories" @save="handleCreateEntry"
            @cancel="showCreateForm = false; newEntryDraft = null" />
        </div>

        <!-- Entry groups -->
        <div v-if="filteredEntries.length > 0" class="space-y-4">
          <div v-for="group in groupedEntries" :key="group.key + (group.subLabel || '')">
            <div class="flex items-end gap-2 mb-1">
              <h4 class="section-heading flex-1 mb-1">
                {{ group.key }}
                <span v-if="group.subLabel" class="text-(--color-text-muted) font-normal normal-case">
                  · {{ group.subLabel }}
                </span>
                <span class="font-normal normal-case ml-1">({{ group.entries.length }})</span>
              </h4>
              <button class="btn btn-ghost btn-sm text-xs" title="Xuất nhóm này ra file JSON" @click="handleExportGroup(group)">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Xuất JSON
              </button>
            </div>
            <div class="space-y-2">
              <div v-for="entry in group.entries" :key="entry.id" class="card transition-colors duration-500"
                :class="{ 'ring-2 ring-(--color-secondary)': focusEntryId === entry.id }">
                <!-- Header -->
                <div class="flex items-start gap-2 cursor-pointer"
                  @click="isSelectMode ? toggleSelect(entry.id) : editingId !== entry.id && toggleExpand(entry.id)">
                  <!-- Checkbox (select mode) -->
                  <input v-if="isSelectMode" type="checkbox" class="mt-0.5 shrink-0 accent-(--color-secondary)" :checked="selectedIds.has(entry.id)" @click.stop
                    @change="toggleSelect(entry.id)" />
                  <svg v-else class="w-3.5 h-3.5 mt-0.5 shrink-0 transition-transform duration-200 text-(--color-text-muted)"
                    :class="expandedIds.has(entry.id) ? 'rotate-90' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-(--color-text-primary) leading-snug">{{ entry.title }}</p>
                    <!-- Edited badge -->
                    <span v-if="entry.editedAt" class="text-xs text-(--color-text-muted) italic"
                      :title="`Đã sửa: ${new Date(entry.editedAt).toLocaleDateString('vi-VN')}`">đã sửa</span>
                  </div>
                  <!-- Manual badge -->
                  <span v-if="entry.manual" class="badge badge-neutral shrink-0">✍ Tự tạo</span>
                  <!-- Edit button -->
                  <button v-if="!isSelectMode && editingId !== entry.id"
                    class="p-0.5 text-(--color-text-muted) hover:text-(--color-secondary) transition-colors rounded shrink-0" title="Sửa"
                    @click.stop="startEdit(entry)">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <!-- Unsave button -->
                  <button v-if="!isSelectMode && editingId !== entry.id"
                    class="p-0.5 text-(--color-text-muted) hover:text-(--color-error-text) transition-colors rounded shrink-0" title="Bỏ lưu"
                    @click.stop="handleUnsave(entry)">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                  <!-- Export button -->
                  <button v-if="!isSelectMode && editingId !== entry.id"
                    class="p-0.5 text-(--color-text-muted) hover:text-(--color-secondary) transition-colors rounded shrink-0" title="Xuất JSON"
                    @click.stop="handleExportEntry(entry)">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                </div>

                <!-- Body -->
                <div class="grid transition-[grid-template-rows] duration-200 ease-in-out"
                  :class="expandedIds.has(entry.id) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
                  <div class="overflow-hidden">
                    <!-- Edit mode -->
                    <NotebookEntryEditor v-if="editingId === entry.id" :entry="entry" :all-categories="stats.categories" @save="handleSaveEntry"
                      @cancel="cancelEdit" />
                    <!-- View mode -->
                    <div v-else class="pt-2 space-y-2">
                      <p v-if="entry.category === 'Hỏi đáp'" class="text-sm text-(--color-text-secondary) leading-relaxed" v-html="entry.content" @click="handleQACitationClick"></p>
                      <p v-else class="text-xs text-(--color-text-secondary) leading-relaxed">{{ entry.content }}</p>
                      <!-- Cited entries for Q&A notes -->
                      <div v-if="entry.category === 'Hỏi đáp' && entry.userNote" class="space-y-0.5">
                        <p class="text-xs text-(--color-text-muted) font-medium">Nguồn:</p>
                        <div class="flex flex-wrap gap-1">
                          <button v-for="item in parseQACitedEntries(entry.userNote)" :key="item.id"
                            class="badge badge-neutral text-xs hover:badge-accent transition-colors"
                            @click="handleCitationClick(item.id)">
                            {{ item.title }}
                          </button>
                        </div>
                      </div>
                      <!-- User note -->
                      <p v-if="entry.userNote && entry.category !== 'Hỏi đáp'" class="text-xs text-(--color-text-muted) italic border-l-2 border-(--color-border) pl-2">{{ entry.userNote }}</p>
                      <!-- Tags -->
                      <div v-if="entry.tags.length > 0" class="flex flex-wrap gap-1">
                        <span v-for="tag in entry.tags" :key="tag" class="badge text-xs capitalize" :class="getTagClass(tag)">
                          {{ tag }}
                        </span>
                      </div>
                      <!-- Source info -->
                      <p class="text-xs text-(--color-text-muted)">
                        {{ entry.source.author }}<template v-if="entry.source.postNumber"> · bài <button class="font-mono link" @click="openPostLink(entry)">#{{
                          entry.source.postNumber }}</button></template><span v-if="entry.source.timestamp"> · {{
                              formatTimestamp(entry.source.timestamp) }}</span>
                      </p>
                      <!-- Source topic link -->
                      <p v-if="!!entry.sourceTopicTitle" class="text-xs">
                        <button class="link text-start" title="Mở trong extension" @click="openInExtension(entry)">
                          {{ entry.sourceTopicTitle }}
                        </button>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- end entries tab -->
     
    <!-- Knowledge tab (global store) -->
    <div v-show="notebookSubTab === 'knowledge'" class="space-y-3">
      <p class="text-xs text-(--color-text-muted)">
        Kho kiến thức tổng hợp từ tất cả thớt đã trích xuất. Tab <strong>Hỏi đáp</strong> tra cứu trực tiếp trên kho này.
      </p>

      <!-- Knowledge entry list -->
      <div class="space-y-2">
        <div class="relative">
          <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-(--color-text-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input v-model="knowledgeSearchInput" type="text" placeholder="Tìm kiếm trong kho..." class="input text-xs w-full pl-8" />
        </div>
        <p class="text-xs text-(--color-text-muted)">
          <template v-if="knowledgeSearchInput">{{ knowledgeFiltered.length }}/{{ knowledgeEntries.length }}</template>
          <template v-else>{{ knowledgeEntries.length }}</template>
          mục
        </p>
        <!-- Sort + group controls -->
        <div v-if="knowledgeEntries.length > 0" class="flex items-center gap-2 text-xs flex-wrap">
          <span class="text-(--color-text-secondary)">Sắp xếp:</span>
          <button v-for="opt in [
            { value: 'recent' as const, label: 'Mới nhất' },
            { value: 'title' as const, label: 'Tên A-Z' },
            { value: 'sources' as const, label: 'Nhiều nguồn' },
          ]" :key="opt.value" class="badge transition-colors" :class="knowledgeSort === opt.value ? 'badge-accent' : 'badge-neutral'"
            @click="knowledgeSort = opt.value">
            {{ opt.label }}
          </button>
        </div>
      </div>

      <LoadingSpinner v-if="knowledgeLoading" text="Đang tải kho kiến thức..." />

      <div v-else-if="knowledgeFiltered.length === 0" class="card text-center py-8 space-y-2">
        <div class="text-2xl">{{ knowledgeEntries.length === 0 ? '🧠' : '🔍' }}</div>
        <p class="text-xs text-(--color-text-muted)">
          {{ knowledgeEntries.length === 0 ? 'Chưa có kiến thức nào. Hãy trích xuất từ một thớt.' : 'Không tìm thấy mục nào khớp.' }}
        </p>
      </div>

      <div v-else class="space-y-4">
        <template v-for="group in knowledgeGrouped" :key="group.key">
          <div>
            <h4 class="section-heading mb-2">
              {{ group.key }}
              <span class="font-normal normal-case ml-1">({{ group.entries.length }})</span>
            </h4>
          </div>
          <div class="space-y-2">
            <div v-for="entry in group.entries" :key="entry.id" :id="`knowledge-global-${entry.id}`">
              <KnowledgeEntryCard
                :entry="normalizeKnowledgeEntry(entry)"
                :expanded="knowledgeExpandedIds.has(entry.id)"
                :show-pin="true"
                :show-category="true"
                :show-merged-info="true"
                :show-post-link="true"
                @toggle-expand="id => knowledgeExpandedIds.has(id) ? knowledgeExpandedIds.delete(id) : knowledgeExpandedIds.add(id)"
                @toggle-pin="id => { const e = findKnowledgeEntry(id); if (e) pinToNotebook(e); }"
              />
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>