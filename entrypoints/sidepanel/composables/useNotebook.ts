import { ref, computed } from 'vue';
import { sendMessage } from '@/lib/messaging';
import type { NotebookEntry } from '@/lib/types';
import type { NotebookStats } from '@/lib/notebook-db';

export interface NotebookFilters {
  search: string;
  category: string | null;
  tag: string | null;
  topicUrl: string | null;
  orphanOnly: boolean;
  pinnedOnly: boolean;
}

export type ViewMode = 'topic' | 'category' | 'tag' | 'timeline';

export function useNotebook() {
  const entries = ref<NotebookEntry[]>([]);
  const stats = ref<NotebookStats>({ totalEntries: 0, topicCount: 0, orphanCount: 0, categories: [] });
  const isLoading = ref(false);
  const error = ref('');
  const filters = ref<NotebookFilters>({ search: '', category: null, tag: null, topicUrl: null, orphanOnly: false, pinnedOnly: false });
  const viewMode = ref<ViewMode>('timeline');

  const allTags = computed(() => {
    const seen = new Map<string, string>();
    entries.value.forEach(e => e.tags.forEach(t => {
      const key = t.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, t.trim());
    }));
    return [...seen.values()].sort().slice(0, 6);
  });

  const allTopicUrls = computed(() => {
    const urls = new Set<string>();
    entries.value.forEach(e => urls.add(e.sourceTopicUrl));
    return [...urls].sort().slice(0, 6); // limit to 6 topic URLs for UI simplicity
  });

  const filteredEntries = computed(() => {
    let result = entries.value;
    const f = filters.value;
    if (f.search) {
      const q = f.search.toLowerCase();
      result = result.filter(e => e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
    }
    if (f.category) result = result.filter(e => e.category === f.category);
    if (f.tag) result = result.filter(e => e.tags.includes(f.tag!));
    if (f.topicUrl) result = result.filter(e => e.sourceTopicUrl === f.topicUrl);
    if (f.orphanOnly) result = result.filter(e => e.orphaned);
    if (f.pinnedOnly) result = result.filter(e => e.pinned);
    return result;
  });

  function sortPinnedFirst(arr: NotebookEntry[]): NotebookEntry[] {
    return [...arr].sort((a, b) => (b.pinned ?? 0) - (a.pinned ?? 0));
  }

  const groupedEntries = computed(() => {
    const items = filteredEntries.value;
    switch (viewMode.value) {
      case 'topic': {
        const groups: Record<string, NotebookEntry[]> = {};
        for (const e of items) {
          const key = e.sourceTopicTitle || e.sourceTopicUrl;
          if (!groups[key]) groups[key] = [];
          groups[key].push(e);
        }
        return Object.entries(groups).map(([key, entries]) => ({ key, entries: sortPinnedFirst(entries) }));
      }
      case 'category': {
        const groups: Record<string, NotebookEntry[]> = {};
        for (const e of items) {
          const key = e.category || 'Khác';
          if (!groups[key]) groups[key] = [];
          groups[key].push(e);
        }
        return Object.entries(groups)
          .sort(([a], [b]) => a === 'Khác' ? 1 : b === 'Khác' ? -1 : a.localeCompare(b, 'vi'))
          .map(([key, entries]) => ({ key, entries: sortPinnedFirst(entries) }));
      }
      case 'tag': {
        const groups: Record<string, NotebookEntry[]> = {};
        for (const e of items) {
          const tags = e.tags.length > 0 ? e.tags : ['(no tag)'];
          for (const tag of tags) {
            if (!groups[tag]) groups[tag] = [];
            groups[tag].push(e);
          }
        }
        return Object.entries(groups)
          .sort(([a], [b]) => a.localeCompare(b, 'vi'))
          .map(([key, entries]) => ({ key, entries: sortPinnedFirst(entries) }));
      }
      case 'timeline': {
        const groups: Record<string, NotebookEntry[]> = {};
        const today = new Date();
        const todayStr = today.toLocaleDateString('vi-VN');
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toLocaleDateString('vi-VN');
        const sorted = [...items].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
        for (const e of sorted) {
          const date = new Date(e.savedAt ?? 0);
          const dateStr = date.toLocaleDateString('vi-VN');
          let key: string;
          if (dateStr === todayStr) key = 'Hôm nay';
          else if (dateStr === yesterdayStr) key = 'Hôm qua';
          else key = dateStr;
          if (!groups[key]) groups[key] = [];
          groups[key].push(e);
        }
        const order = ['Hôm nay', 'Hôm qua'];
        return Object.entries(groups)
          .sort(([a], [b]) => {
            const ai = order.indexOf(a);
            const bi = order.indexOf(b);
            if (ai !== -1 && bi !== -1) return ai - bi;
            if (ai !== -1) return -1;
            if (bi !== -1) return 1;
            return b.localeCompare(a, 'vi');
          })
          .map(([key, entries]) => ({ key, entries: sortPinnedFirst(entries) }));
      }
      default:
        return [];
    }
  });

  async function loadEntries() {
    isLoading.value = true;
    error.value = '';
    try {
      entries.value = await sendMessage<NotebookEntry[]>('GET_NOTEBOOK_ENTRIES') ?? [];
    } catch (err) {
      error.value = String(err);
      entries.value = [];
    } finally {
      isLoading.value = false;
    }
  }

  async function loadStats() {
    try {
      stats.value = await sendMessage<NotebookStats>('GET_NOTEBOOK_STATS') ?? { totalEntries: 0, topicCount: 0, orphanCount: 0, categories: [] };
    } catch {
      stats.value = { totalEntries: 0, topicCount: 0, orphanCount: 0, categories: [] };
    }
  }

  async function unsaveEntry(entry: NotebookEntry) {
    try {
      await sendMessage('DELETE_NOTEBOOK_ENTRY', { id: entry.id });
      entries.value = entries.value.filter(e => e.id !== entry.id);
      // Sync topic cache: remove entry from saved list
      const cached = await sendMessage<import('@/lib/types').CachedTopic | null>('GET_CACHED_TOPIC', entry.sourceTopicUrl);
      if (cached?.knowledgeEntries?.some(e => e.id === entry.id)) {
        const updated = cached.knowledgeEntries.filter(e => e.id !== entry.id);
        await sendMessage('SAVE_CACHED_TOPIC', { url: entry.sourceTopicUrl, knowledgeEntries: updated }).catch(() => {});
      }
    } catch (err) { console.warn('[useNotebook] unsave failed', err); }
  }

  return {
    entries,
    stats,
    isLoading,
    error,
    filters,
    viewMode,
    allTags,
    allTopicUrls,
    filteredEntries,
    groupedEntries,
    loadEntries,
    loadStats,
    unsaveEntry,
  };
}
