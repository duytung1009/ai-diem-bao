<script setup lang="ts">
import { ref, onActivated, computed } from 'vue';
import type { CachedTopic, KnowledgeEntry, DetectResult } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import ProgressIndicator from '../components/ProgressIndicator.vue';
import ErrorDisplay from '../components/ErrorDisplay.vue';
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

const allTags = computed(() => {
  const tags = new Set<string>();
  entries.value.forEach(e => e.tags.forEach(t => tags.add(t)));
  return [...tags].sort();
});

const filteredEntries = computed(() => {
  let result = entries.value;
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
  cachedTopic.value = topic as CachedTopic;
  if (topic.knowledgeEntries?.length) entries.value = topic.knowledgeEntries;

  try {
    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', url);
    if (loadedTopicUrl.value !== url) return; // topic switched during await — discard stale result
    if (fresh) {
      cachedTopic.value = fresh;
      if (fresh.knowledgeEntries?.length) entries.value = fresh.knowledgeEntries;
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
        if (fresh.knowledgeEntries?.length) entries.value = fresh.knowledgeEntries;
      }
    } catch { /* ignore */ }
  }
});

async function handleExtract() {
  if (!cachedTopic.value?.posts?.length) return;
  isLoading.value = true;
  error.value = '';
  llmTaskId.value = null;
  searchQuery.value = '';
  selectedTags.value = [];

  try {
    const { taskId, result } = runExtract(cachedTopic.value.posts, cachedTopic.value.title);
    llmTaskId.value = taskId;
    const llmResult = await result;
    const newEntries = ((llmResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [];
    entries.value = newEntries;
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: cachedTopic.value.url,
      knowledgeEntries: newEntries,
    }).catch(() => {});
    store.updateSelectedTopic({ knowledgeEntries: newEntries });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    isLoading.value = false;
    llmTaskId.value = null;
  }
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
      <div v-if="!cachedTopic?.posts?.length" class="alert alert-warning">
        Chưa có dữ liệu bài viết. Vui lòng tóm tắt topic ở tab "Tóm tắt" trước.
      </div>

      <!-- Extract button (no entries yet) -->
      <button
        v-if="cachedTopic?.posts?.length && !entries.length && !isLoading"
        class="w-full btn btn-primary"
        @click="handleExtract"
      >
        Trích xuất Kiến thức
      </button>

      <!-- Progress -->
      <ProgressIndicator v-if="isLoading" :task-id="llmTaskId" fallback-message="Đang trích xuất kiến thức..." />

      <!-- Error -->
      <ErrorDisplay v-if="error" :message="error" action="retry" @retry="handleExtract" />

      <!-- Entry list -->
      <template v-if="entries.length && !isLoading">
        <!-- Search + Tag filter -->
        <div class="space-y-2">
          <!-- Search -->
          <div class="relative">
            <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-(--color-text-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Tìm kiến thức..."
              class="input pl-8 text-xs w-full"
            />
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
            v-if="cachedTopic?.posts?.length"
            class="text-blue-600 hover:text-blue-700"
            @click="handleExtract"
          >
            Trích xuất lại
          </button>
        </div>

        <!-- No results after filter -->
        <div v-if="filteredEntries.length === 0" class="text-center py-6">
          <p class="text-xs text-(--color-text-muted)">Không tìm thấy kiến thức phù hợp với bộ lọc.</p>
        </div>

        <!-- Entry cards -->
        <div class="space-y-3">
          <div
            v-for="entry in filteredEntries"
            :key="entry.id"
            class="card space-y-2"
          >
            <p class="text-sm font-semibold text-(--color-text-primary)">{{ entry.title }}</p>
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
            <!-- Source citation -->
            <p class="text-xs text-(--color-text-muted)">
              — {{ entry.source.author }}<span v-if="entry.source.postNumber">, bài #{{ entry.source.postNumber }}</span>
            </p>
          </div>
        </div>
      </template>

      <!-- Empty state (has posts but no entries extracted) -->
      <div v-if="!isLoading && !entries.length && cachedTopic?.posts?.length" class="text-center py-6">
        <p class="text-xs text-(--color-text-muted)">Bấm nút phía trên để trích xuất kiến thức từ topic.</p>
      </div>
    </template>
  </div>
</template>
