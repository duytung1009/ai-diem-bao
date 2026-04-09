<script setup lang="ts">
import { ref, onActivated, computed } from 'vue';
import type { CachedTopic, KnowledgeEntry, DetectResult } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import ProgressIndicator from '../components/ProgressIndicator.vue';
import { useLLM } from '../composables/useLLM';
import { useTopicStore } from '../composables/useTopicStore';
import TopicMeta from '../components/TopicMeta.vue';

const { extractKnowledge: runExtract } = useLLM();
const store = useTopicStore();

const entries = ref<KnowledgeEntry[]>([]);
const cachedTopic = ref<CachedTopic | null>(null);
const loadedTopicUrl = ref<string | null>(null);
const isLoading = ref(false);
const error = ref('');
const llmTaskId = ref<string | null>(null);
const searchQuery = ref('');
const selectedTags = ref<string[]>([]);
const expandedIds = ref<Set<string>>(new Set());
const showSavedOnly = ref(false);

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
  return result;
});

async function loadTopicData() {
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

async function handleExtract() {
  if (!allPosts.value.length) return;

  const lastPostNum = cachedTopic.value?.lastKnowledgePostNumber ?? -1;
  const excludedNums = new Set(cachedTopic.value?.excludedKnowledgePostNumbers ?? []);
  const postsToExtract = allPosts.value.filter(p =>
    p.postNumber > lastPostNum && !excludedNums.has(p.postNumber)
  );

  if (!postsToExtract.length) {
    if (entries.value.length > 0) {
      error.value = 'Không có bài viết mới để trích xuất kiến thức.';
    }
    return;
  }

  isLoading.value = true;
  error.value = '';
  llmTaskId.value = null;
  if (lastPostNum < 0) {
    searchQuery.value = '';
    selectedTags.value = [];
  }

  try {
    const { taskId, result } = runExtract(postsToExtract, cachedTopic.value!.title);
    llmTaskId.value = taskId;
    const llmResult = await result;
    const newEntries: KnowledgeEntry[] = ((llmResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [];

    // Enrich with timestamp from allPosts
    const enriched = newEntries.map(e => {
      const post = allPosts.value.find(p => p.postNumber === e.source.postNumber);
      return post?.timestamp ? { ...e, source: { ...e.source, timestamp: post.timestamp } } : e;
    });

    // Merge strategy (QD3, QD4, QD5)
    let merged: KnowledgeEntry[];
    if (lastPostNum > 0) {
      // Incremental: keep all existing + append new
      merged = [...entries.value, ...enriched];
    } else if (lastPostNum === 0) {
      // After clear tracking: keep saved + new (avoid duplicates by postNumber)
      const savedEntries = entries.value.filter(e => e.saved);
      merged = [...savedEntries, ...enriched.filter(e =>
        !savedEntries.some(s => s.source.postNumber === e.source.postNumber)
      )];
    } else {
      // First extract (lastPostNum === -1)
      merged = enriched;
    }

    const newLastPostNum = Math.max(...allPosts.value.map(p => p.postNumber));

    entries.value = merged;
    expandedIds.value = new Set();
    store.updateSelectedTopic({ knowledgeEntries: merged });
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: cachedTopic.value!.url,
      knowledgeEntries: merged,
      lastKnowledgePostNumber: newLastPostNum,
    }).catch(() => {});

    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', cachedTopic.value!.url).catch(() => null);
    if (fresh) cachedTopic.value = fresh;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    isLoading.value = false;
    llmTaskId.value = null;
  }
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
  }).catch(() => {});
  const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', cachedTopic.value!.url).catch(() => null);
  if (fresh) cachedTopic.value = fresh;
}
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- No topic selected -->
    <div v-if="!cachedTopic" class="text-center py-8">
      <p class="text-sm text-(--color-text-secondary)">Chưa chọn chủ đề.</p>
      <button class="mt-3 text-sm text-blue-600 hover:text-blue-700" @click="$router.push('/')">
        ← Quay lại danh sách
      </button>
    </div>

    <template v-else>
      <!-- Back button -->
      <div class="flex items-center justify-between">
        <button class="text-xs text-blue-600 hover:text-blue-700" @click="$router.push('/')">
          ← Quay lại danh sách
        </button>
      </div>

      <TopicMeta v-if="topicInfo" :info="topicInfo" :url="store.selectedTopic.value?.url" />

      <h2 class="font-semibold text-sm text-(--color-text-primary)">Kiến thức từ Topic</h2>

      <!-- No posts warning -->
      <div v-if="!allPosts.length" class="alert alert-warning">
        Chưa có dữ liệu bài viết. Vui lòng tóm tắt topic ở tab "Tóm tắt" trước.
      </div>

      <!-- Extract button (no entries yet) -->
      <button
        v-if="allPosts.length && !entries.length && !isLoading"
        class="w-full btn btn-primary"
        @click="handleExtract"
      >
        Trích xuất Kiến thức
      </button>

      <!-- Progress -->
      <ProgressIndicator v-if="isLoading" :task-id="llmTaskId" fallback-message="Đang trích xuất kiến thức..." />

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
        </div>

        <!-- Stats + re-extract -->
        <div class="flex items-center justify-between text-xs text-(--color-text-muted)">
          <span>{{ filteredEntries.length }}/{{ entries.length }} kiến thức</span>
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

        <!-- Entry cards -->
        <div class="space-y-2">
          <div
            v-for="entry in filteredEntries"
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
                    — {{ entry.source.author }}<span v-if="entry.source.postNumber">, bài #{{ entry.source.postNumber }}</span><span v-if="entry.source.timestamp"> · {{ formatTimestamp(entry.source.timestamp) }}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Empty state (has posts but no entries extracted) -->
      <div v-if="!isLoading && !entries.length && allPosts.length" class="text-center py-6">
        <p class="text-xs text-(--color-text-muted)">Bấm nút phía trên để trích xuất kiến thức từ topic.</p>
      </div>
    </template>
  </div>
</template>
