<script setup lang="ts">
import { ref, onActivated, computed } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage } from '@/lib/messaging';
import { formatTopicDate } from '@/lib/topic-utils';
import type { NotebookEntry } from '@/lib/types';
import type { NotebookStats } from '@/lib/notebook-db';
import { useNotebook, type ViewMode } from '../composables/useNotebook';
import { useTopicStore } from '../composables/useTopicStore';

const router = useRouter();
const store = useTopicStore();
const { entries, stats, isLoading, error, filters, viewMode, allTags, allTopicUrls, filteredEntries, groupedEntries, loadEntries, loadStats, unsaveEntry } = useNotebook();

const expandedIds = ref<Set<string>>(new Set());

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
  if (entry.orphaned) return;
  const cached = await sendMessage<import('@/lib/types').CachedTopic | null>('GET_CACHED_TOPIC', entry.sourceTopicUrl);
  if (cached) {
    store.selectTopic(cached);
    router.push(`/knowledge?focus=${entry.id}`);
  } else {
    // Topic was deleted outside the normal flow — fall back to opening post
    openPostLink(entry);
  }
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
  { value: 'topic', label: 'Theo thớt' },
  { value: 'category', label: 'Theo danh mục' },
  { value: 'tag', label: 'Theo thẻ' },
  { value: 'timeline', label: 'Dòng thời gian' },
];

async function handleUnsave(entry: NotebookEntry) {
  await unsaveEntry(entry);
}

onActivated(async () => {
  await Promise.all([loadEntries(), loadStats()]);
});
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- Header -->
    <div class="space-y-2">
      <!-- Search -->
      <div class="relative">
        <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-(--color-text-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          v-model="filters.search"
          type="text"
          placeholder="Tìm kiếm kiến thức..."
          class="input pl-8 pr-8 text-xs w-full"
        />
      </div>
      <!-- Stats -->
      <p class="text-xs text-(--color-text-muted)">
        {{ stats.totalEntries }} kiến thức từ {{ stats.topicCount }} thớt
        <span v-if="stats.orphanCount > 0"> · {{ stats.orphanCount }} mồ côi</span>
      </p>
    </div>

    <!-- Filter bar -->
    <div class="space-y-2">
      <!-- Topic dropdown -->
      <div v-if="allTopicUrls.length > 0" class="flex flex-wrap gap-1.5">
        <button
          v-if="filters.topicUrl"
          class="px-2 py-0.5 rounded-full text-xs bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft)"
          @click="filters.topicUrl = null"
        >
          Tất cả thớt
        </button>
        <button
          v-for="url in allTopicUrls"
          :key="url"
          class="px-2 py-0.5 rounded-full text-xs transition-colors truncate max-w-40"
          :class="filters.topicUrl === url
            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
            : 'bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft)'"
          @click="filters.topicUrl = filters.topicUrl === url ? null : url"
        >
          {{ entries.find(e => e.sourceTopicUrl === url)?.sourceTopicTitle || url }}
        </button>
      </div>
      <!-- Category pills -->
      <div v-if="stats.categories.length > 0" class="flex flex-wrap gap-1.5">
        <button
          v-if="filters.category"
          class="px-2 py-0.5 rounded-full text-xs bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft)"
          @click="filters.category = null"
        >
          Tất cả danh mục
        </button>
        <button
          v-for="cat in stats.categories"
          :key="cat"
          class="px-2 py-0.5 rounded-full text-xs transition-colors"
          :class="filters.category === cat
            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
            : 'bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft)'"
          @click="filters.category = filters.category === cat ? null : cat"
        >
          {{ cat }}
        </button>
      </div>
      <!-- Tag pills -->
      <div v-if="allTags.length > 0" class="flex flex-wrap gap-1.5">
        <button
          v-if="filters.tag"
          class="px-2 py-0.5 rounded-full text-xs bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft)"
          @click="filters.tag = null"
        >
          Tất cả thẻ
        </button>
        <button
          v-for="tag in allTags"
          :key="tag"
          class="px-2 py-0.5 rounded-full text-xs transition-colors"
          :class="filters.tag === tag
            ? getTagClass(tag)
            : 'bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-accent-soft)'"
          @click="filters.tag = filters.tag === tag ? null : tag"
        >
          {{ tag }}
        </button>
      </div>
      <!-- Orphan toggle -->
      <label class="flex items-center gap-2 text-xs text-(--color-text-secondary) cursor-pointer">
        <input
          type="checkbox"
          v-model="filters.orphanOnly"
          class="rounded"
        />
        Chỉ mồ côi
      </label>
    </div>

    <!-- View mode buttons -->
    <div class="flex gap-1 bg-(--color-bg-muted) rounded-lg p-0.5">
      <button
        v-for="vm in viewModes"
        :key="vm.value"
        class="flex-1 text-center py-1 text-xs font-medium rounded-md transition-colors"
        :class="viewMode === vm.value
          ? 'bg-white dark:bg-(--color-bg-surface) text-(--color-text-primary) shadow-sm'
          : 'text-(--color-text-secondary) hover:text-(--color-text-primary)'"
        @click="viewMode = vm.value"
      >
        {{ vm.label }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="text-center py-6">
      <p class="text-xs text-(--color-text-muted)">Đang tải...</p>
    </div>

    <!-- Error -->
    <div v-if="error" class="alert alert-error text-xs">{{ error }}</div>

    <!-- Empty state -->
    <div v-if="!isLoading && entries.length === 0" class="text-center py-12 space-y-3">
      <p class="text-xs text-(--color-text-muted)">Chưa có kiến thức nào được lưu.</p>
    </div>

    <!-- Entry groups -->
    <div v-if="filteredEntries.length > 0" class="space-y-4">
      <div v-for="group in groupedEntries" :key="group.key">
        <h4 class="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide mb-2">
          {{ group.key }}
          <span class="font-normal normal-case ml-1">({{ group.entries.length }})</span>
        </h4>
        <div class="space-y-2">
          <div
            v-for="entry in group.entries"
            :key="entry.id"
            class="card"
          >
            <!-- Header -->
            <div class="flex items-start gap-2 cursor-pointer" @click="toggleExpand(entry.id)">
              <svg
                class="w-3.5 h-3.5 mt-0.5 shrink-0 transition-transform duration-200 text-(--color-text-muted)"
                :class="expandedIds.has(entry.id) ? 'rotate-90' : ''"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
              <p class="text-sm font-semibold text-(--color-text-primary) flex-1 leading-snug">{{ entry.title }}</p>
              <!-- Orphan badge -->
              <span v-if="entry.orphaned" class="px-1.5 py-0.5 rounded text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 shrink-0">Mồ côi</span>
              <!-- Unsave button -->
              <button
                class="p-0.5 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded shrink-0"
                title="Bỏ lưu"
                @click.stop="handleUnsave(entry)"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              <!-- Open source button -->
              <button
                class="p-0.5 text-gray-300 dark:text-gray-600 hover:text-blue-500 dark:hover:text-blue-400 transition-colors rounded shrink-0"
                title="Mở bài viết gốc"
                @click.stop="openPostLink(entry)"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
            </div>

            <!-- Body -->
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
                  <!-- Source info -->
                  <p class="text-xs text-(--color-text-muted)">
                    — {{ entry.source.author }}<template v-if="entry.source.postNumber">, bài #{{ entry.source.postNumber }}</template>
                    <span v-if="entry.source.timestamp">{{ formatTimestamp(entry.source.timestamp) }}</span>
                  </p>
                  <!-- Source topic link -->
                  <p class="text-xs">
                    <button
                      :class="entry.orphaned
                        ? 'text-(--color-text-muted) cursor-not-allowed'
                        : 'text-blue-600 hover:text-blue-700'"
                      :title="entry.orphaned ? 'Thớt gốc đã xoá khỏi bộ nhớ đệm' : 'Mở trong extension'"
                      @click="entry.orphaned ? undefined : openInExtension(entry)"
                    >
                      {{ entry.sourceTopicTitle }}
                    </button>
                    <span v-if="entry.orphaned" class="text-(--color-text-muted) italic">(đã xoá)</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
