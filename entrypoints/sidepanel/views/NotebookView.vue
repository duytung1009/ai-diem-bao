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
import IconButton from '../components/IconButton.vue';
import ConfirmInline from '../components/ConfirmInline.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import SearchInput from '../components/SearchInput.vue';
import EmptyState from '../components/EmptyState.vue';
import { useNotebookQA } from '../composables/useNotebookQA';
import { getTagClass } from '@/lib/tag-styles';
import type { GlobalKnowledgeEntry } from '@/lib/types';

const router = useRouter();
const store = useTopicStore();
const { entries, stats, isLoading, error, filters, viewMode, filteredEntries, groupedEntries, loadEntries, loadStats, unsaveEntry } = useNotebook();

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

function handleDeleteGlobal(id: string) {
  knowledgeEntries.value = knowledgeEntries.value.filter(e => e.id !== id);
  sendMessageQuiet('DELETE_KNOWLEDGE_ENTRY', { id });
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
    source: { author: '', postNumber: 0 },
    fromQA: 1,
  };
  await handleCreateEntry(entry);
}

interface QACitedEntry { id: string; title: string }

// Backward compat: old entries used category='Hỏi đáp', new entries use fromQA=1
function isQAEntry(entry: NotebookEntry): boolean {
  return !!entry.fromQA || entry.category === 'Hỏi đáp';
}

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

async function handleCopyEntry(entry: NotebookEntry) {
  const stripHtml = (html: string) => html
    .replace(/<button[^>]*>\[(\d+)\]<\/button>/g, '[$1]')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?strong>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  try {
    await navigator.clipboard.writeText(`${entry.title}\n\n${stripHtml(entry.content)}`);
  } catch { /* fallback not needed */ }
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

const viewModes: { value: ViewMode; label: string }[] = [
  { value: 'timeline', label: 'Dòng thời gian' },
  { value: 'category', label: 'Danh mục' },
  { value: 'tag', label: 'Tag' },
  { value: 'topic', label: 'Thớt' },
];

// Per-entry confirm before unsaving (destructive: manual/Q&A notes are not
// recoverable from the global store). No window.confirm — blocked in sidepanel.
const confirmUnsaveId = ref<string | null>(null);

async function handleUnsave(entry: NotebookEntry) {
  await unsaveEntry(entry);
  confirmUnsaveId.value = null;
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
      <p class="text-xs text-(--color-text-secondary)">
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
        <p class="text-xs text-(--color-text-secondary)">
          Ghi chú đã lưu từ các thớt. Nhấn ⭐ trong tab Kiến thức của bất kỳ thớt nào để lưu.
        </p>
        <!-- Search -->
        <SearchInput v-model="filters.search" placeholder="Tìm kiếm ghi chú..." />

        <!-- Stats + create -->
        <div class="flex items-center gap-2">
          <p class="text-xs text-(--color-text-secondary) flex-1">
            {{ filteredEntries.length }}/{{ stats.totalEntries }} ghi chú
          </p>
          <button type="button" class="btn btn-ghost btn-sm text-xs shrink-0" @click="startCreateEntry">
            + Ghi chú thủ công
          </button>
        </div>

        <!-- Group-by buttons -->
        <div class="flex items-center gap-2 text-xs flex-wrap">
          <span class="text-(--color-text-secondary)">Nhóm theo:</span>
          <button v-for="vm in viewModes" :key="vm.value" class="badge capitalize transition-colors" :class="viewMode === vm.value
            ? 'badge-accent'
            : 'badge-neutral'" @click="viewMode = vm.value">
            {{ vm.label }}
          </button>
        </div>

        <!-- Loading -->
        <LoadingSpinner v-if="isLoading" text="Đang tải ghi chú..." />

        <!-- Error -->
        <div v-if="error" class="alert alert-error text-xs">{{ error }}</div>

        <!-- Empty state -->
        <EmptyState v-if="!isLoading && entries.length === 0" icon="📝" title="Chưa có ghi chú nào">
          <template #description>
            <p class="text-xs text-(--color-text-secondary)">
              Nhấn ⭐ trong tab <strong>Kiến thức</strong> của thớt để lưu, hoặc dùng tab
              <strong>Hỏi đáp</strong> để tổng hợp câu trả lời và lưu thành ghi chú mới.
            </p>
          </template>
          <template #action>
            <button type="button" class="btn btn-sm btn-primary" @click="notebookSubTab = 'qa'">
              Đến Hỏi đáp
            </button>
          </template>
        </EmptyState>

        <!-- Create manual entry form -->
        <div v-if="showCreateForm && newEntryDraft" class="card">
          <p class="text-xs text-(--color-text-secondary) font-medium mb-1">Tạo ghi chú mới</p>
          <NotebookEntryEditor :entry="newEntryDraft" :all-categories="stats.categories" @save="handleCreateEntry"
            @cancel="showCreateForm = false; newEntryDraft = null" />
        </div>

        <!-- Entry groups -->
        <div v-if="filteredEntries.length > 0" class="space-y-4">
          <div v-for="group in groupedEntries" :key="group.key">
            <div class="flex items-end gap-2 mb-1">
              <h4 class="section-heading flex-1 mb-1">
                {{ group.key ?? 'Khác' }}
                <span class="font-normal normal-case ml-1">({{ group.entries.length }})</span>
              </h4>
              <button type="button" class="btn btn-ghost btn-sm shrink-0" title="Xuất nhóm này ra file JSON" aria-label="Xuất nhóm này ra file JSON" @click="handleExportGroup(group)">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            </div>
            <div class="space-y-2">
              <div v-for="entry in group.entries" :key="entry.id" class="card transition-colors duration-500"
                :class="{ 'ring-2 ring-(--color-secondary)': focusEntryId === entry.id }">
                <!-- Header -->
                <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions,vuejs-accessibility/click-events-have-key-events -- intentional interactive container -->
                <div class="flex items-center gap-2 cursor-pointer"
                  @click="editingId !== entry.id && toggleExpand(entry.id)">
                  <svg class="w-3.5 h-3.5 mt-0.5 shrink-0 transition-transform duration-200 text-(--color-text-secondary)"
                    :class="expandedIds.has(entry.id) ? 'rotate-90' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-(--color-text-primary) leading-snug">{{ entry.title }}</p>
                    <!-- Edited badge -->
                    <span v-if="entry.editedAt" class="text-xs text-(--color-text-secondary) italic"
                      :title="`Đã sửa: ${new Date(entry.editedAt).toLocaleDateString('vi-VN')}`">đã sửa</span>
                  </div>
                  <!-- Entry type badge -->
                  <span v-if="isQAEntry(entry)" class="badge badge-accent shrink-0">💬 Hỏi đáp</span>
                  <span v-else-if="entry.manual" class="badge badge-neutral shrink-0">✍ Tự tạo</span>
                  <!-- Edit button (hidden for Q&A entries — content is HTML with citations) -->
                  <IconButton v-if="editingId !== entry.id && !isQAEntry(entry)" label="Sửa" @click.stop="startEdit(entry)">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </IconButton>
                  <IconButton v-if="editingId !== entry.id" label="Copy nội dung" @click.stop="handleCopyEntry(entry)">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </IconButton>
                  <!-- Export button -->
                  <IconButton v-if="editingId !== entry.id" label="Xuất JSON" @click.stop="handleExportEntry(entry)">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </IconButton>
                  <!-- Unsave button (filled star → confirm) -->
                  <IconButton v-if="editingId !== entry.id" label="Bỏ lưu" variant="saved" @click.stop="confirmUnsaveId = confirmUnsaveId === entry.id ? null : entry.id">
                    <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </IconButton>
                </div>

                <!-- Unsave confirm -->
                <div v-if="confirmUnsaveId === entry.id" class="mt-2 bg-(--color-error-bg) rounded-lg p-2">
                  <ConfirmInline message="Bỏ lưu ghi chú này khỏi Sổ tay?" confirm-label="Bỏ lưu" cancel-label="Huỷ" variant="danger" @confirm="handleUnsave(entry)" @cancel="confirmUnsaveId = null" />
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
                      <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions,vuejs-accessibility/click-events-have-key-events -- intentional interactive container -->
                      <p v-if="isQAEntry(entry)" class="text-sm text-(--color-text-secondary) leading-relaxed" v-html="entry.content" @click="handleQACitationClick"></p>
                      <p v-else class="text-xs text-(--color-text-secondary) leading-relaxed">{{ entry.content }}</p>
                      <!-- Cited entries for Q&A notes -->
                      <div v-if="isQAEntry(entry) && entry.userNote" class="space-y-0.5">
                        <p class="text-xs text-(--color-text-secondary) font-medium">Nguồn:</p>
                        <div class="flex flex-wrap gap-1">
                          <button v-for="item in parseQACitedEntries(entry.userNote)" :key="item.id" type="button"
                            class="badge badge-accent text-xs hover:underline transition-colors"
                            @click="handleCitationClick(item.id)">
                            {{ item.title }}
                          </button>
                        </div>
                      </div>
                      <!-- User note -->
                      <p v-if="entry.userNote && !isQAEntry(entry)" class="text-xs text-(--color-text-secondary) italic border-l-2 border-(--color-border) pl-2">{{ entry.userNote }}</p>
                      <!-- Tags -->
                      <div v-if="entry.tags.length > 0" class="flex flex-wrap gap-1">
                        <span v-for="tag in entry.tags" :key="tag" class="badge text-xs capitalize" :class="getTagClass(tag)">
                          {{ tag }}
                        </span>
                      </div>
                      <!-- Source info -->
                      <p class="text-xs text-(--color-text-secondary)">
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
      <p class="text-xs text-(--color-text-secondary)">
        Kho kiến thức tổng hợp từ tất cả thớt đã trích xuất. Tab <strong>Hỏi đáp</strong> tra cứu trực tiếp trên kho này.
      </p>

      <!-- Knowledge entry list -->
      <div class="space-y-2">
        <SearchInput v-model="knowledgeSearchInput" placeholder="Tìm kiếm trong kho..." />
        <p class="text-xs text-(--color-text-secondary)">
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

      <EmptyState v-else-if="knowledgeFiltered.length === 0"
        :icon="knowledgeEntries.length === 0 ? '🧠' : '🔍'"
        :title="knowledgeEntries.length === 0 ? 'Chưa có kiến thức nào' : 'Không tìm thấy kết quả'"
        :description="knowledgeEntries.length === 0 ? 'Hãy trích xuất kiến thức từ một thớt.' : 'Không có mục nào khớp với tìm kiếm.'" />

      <div v-else class="space-y-4">
        <template v-for="group in knowledgeGrouped" :key="group.key">
          <div>
            <h4 class="section-heading mb-1">
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
                :show-delete="true"
                :show-category="true"
                :show-merged-info="true"
                :show-post-link="true"
                @toggle-expand="id => knowledgeExpandedIds.has(id) ? knowledgeExpandedIds.delete(id) : knowledgeExpandedIds.add(id)"
                @toggle-pin="id => { const e = findKnowledgeEntry(id); if (e) pinToNotebook(e); }"
                @delete="handleDeleteGlobal"
              />
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>