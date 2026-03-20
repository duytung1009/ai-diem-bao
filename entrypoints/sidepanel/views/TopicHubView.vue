<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage } from '@/lib/messaging';
import type { CachedTopic, TopicSegment } from '@/lib/types';
import { useTopicStore } from '../composables/useTopicStore';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const router = useRouter();
const store = useTopicStore();
const allTopics = ref<CachedTopic[]>([]);
const isLoading = ref(true);
const pendingDeleteUrl = ref<string | null>(null);
const searchQuery = ref('');
const sortBy = ref<'recent' | 'posts' | 'title'>('recent');

// Temp topic: injected into domain groups while summarizing a topic not yet in cache
const summarizingTempTopic = computed(() => {
  const url = store.summarizingUrl.value;
  if (!url) return null;
  const alreadyInList = allTopics.value.some(t => t.url === url);
  if (alreadyInList) return null;
  const selected = store.selectedTopic.value;
  return selected?.url === url ? selected : null;
});

// Filter + sort topics (excludes temp topic — added separately in groupedTopics)
const filteredTopics = computed(() => {
  let topics = [...allTopics.value];
  const query = searchQuery.value.trim().toLowerCase();
  if (query) {
    topics = topics.filter(t =>
      t.title.toLowerCase().includes(query) ||
      t.url.toLowerCase().includes(query)
    );
  }
  switch (sortBy.value) {
    case 'recent':
      topics.sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0));
      break;
    case 'posts':
      topics.sort((a, b) => b.totalPosts - a.totalPosts);
      break;
    case 'title':
      topics.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
      break;
  }
  return topics;
});

// Group topics by domain (includes temp topic if summarizing a new topic)
const groupedTopics = computed(() => {
  const groups: Record<string, CachedTopic[]> = {};
  const topics = summarizingTempTopic.value
    ? [...filteredTopics.value, summarizingTempTopic.value as CachedTopic]
    : filteredTopics.value;
  for (const topic of topics) {
    try {
      const hostname = new URL(topic.url).hostname;
      if (!groups[hostname]) groups[hostname] = [];
      groups[hostname].push(topic);
    } catch {
      if (!groups['Khác']) groups['Khác'] = [];
      groups['Khác'].push(topic);
    }
  }
  return groups;
});

const domainNames = computed(() => Object.keys(groupedTopics.value).sort());

// Check if active tab topic is already in cached list
const activeTabInList = computed(() => {
  if (!store.activeTabUrl.value) return true;
  return allTopics.value.some(t => normalizeForCompare(t.url) === normalizeForCompare(store.activeTabUrl.value!));
});

function normalizeForCompare(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/page-\d+\/?$/, '');
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch { return url; }
}

onMounted(async () => {
  try {
    const topics = await sendMessage<CachedTopic[]>('GET_ALL_CACHED_TOPICS');
    allTopics.value = topics || [];
  } catch {
    allTopics.value = [];
  } finally {
    isLoading.value = false;
  }
});

onActivated(async () => {
  // Quietly refresh topic list each time user returns to this tab (keep-alive re-activate)
  try {
    const topics = await sendMessage<CachedTopic[]>('GET_ALL_CACHED_TOPICS');
    allTopics.value = topics || [];
  } catch {
    // Keep existing data on error
  }
});

// Watch store.selectedTopic for updates (sync when summary is completed)
watch(
  () => store.selectedTopic.value,
  (updated) => {
    if (!updated?.url) return;
    const idx = allTopics.value.findIndex(t => t.url === updated.url);
    if (idx >= 0) {
      // Update topic in list without reloading from background
      const topic: CachedTopic = {
        ...allTopics.value[idx],
        ...updated,
        posts: updated.posts ? [...updated.posts] : allTopics.value[idx].posts,
        researchHistory: updated.researchHistory ? [...updated.researchHistory] : allTopics.value[idx].researchHistory,
        segments: updated.segments ? [...updated.segments] as TopicSegment[] : allTopics.value[idx].segments,
      };
      allTopics.value[idx] = topic;
    } else if (updated.summary || updated.posts?.length) {
      // New topic is cached — add to list
      const topic: CachedTopic = {
        ...updated,
        posts: updated.posts ? [...updated.posts] : [],
        researchHistory: updated.researchHistory ? [...updated.researchHistory] : [],
        segments: updated.segments ? [...updated.segments] as TopicSegment[] : undefined,
      } as CachedTopic;
      allTopics.value = [...allTopics.value, topic];
    }
  },
  { deep: true }
);

function selectTopic(topic: CachedTopic) {
  store.selectTopic(topic);
  router.push('/summary');
}

function confirmDelete(topic: CachedTopic) {
  pendingDeleteUrl.value = topic.url;
}

function cancelDelete() {
  pendingDeleteUrl.value = null;
}

async function executeDelete() {
  if (!pendingDeleteUrl.value) return;
  try {
    await sendMessage('DELETE_CACHED_TOPIC', pendingDeleteUrl.value);
    allTopics.value = allTopics.value.filter(
      t => t.url !== pendingDeleteUrl.value
    );
    // Nếu topic đang selected trong store, clear selection
    if (store.selectedTopic.value?.url === pendingDeleteUrl.value) {
      store.clearSelection();
    }
  } catch {
    // Silently fail — topic list sẽ refresh khi onActivated
  } finally {
    pendingDeleteUrl.value = null;
  }
}

function handleActiveTabTopic() {
  // Navigate to summary view — SummaryView will detect the active tab topic
  if (store.activeTabDetect.value && store.activeTabUrl.value) {
    // Create a minimal CachedTopic-like object from the detected topic
    const detect = store.activeTabDetect.value;
    const minimalTopic: CachedTopic = {
      url: store.activeTabUrl.value,
      title: detect.title,
      version: detect.version,
      posts: [],
      summary: '',
      llmConfig: { provider: '', model: '' },
      cachedAt: 0,
      lastPostNumber: 0,
      totalPosts: detect.postCount,
      totalPages: detect.pageCount,
    };
    store.selectTopic(minimalTopic);
    router.push('/summary');
  }
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(timestamp).toLocaleDateString('vi-VN');
}
</script>

<template>
  <div class="p-4 space-y-4">
    <LoadingSpinner v-if="isLoading" text="Đang tải danh sách..." />

    <template v-else>
      <!-- Search + Sort controls (only show when there are topics) -->
      <div v-if="allTopics.length > 0" class="space-y-2">
        <!-- Search input -->
        <div class="relative">
          <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-(--color-text-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Tìm kiếm topic..."
            class="input pl-8 text-xs w-full"
          />
        </div>
        <!-- Sort selector -->
        <div class="flex items-center gap-2 text-xs">
          <span class="text-(--color-text-secondary)">Sắp xếp:</span>
          <button
            v-for="option in [
              { value: 'recent', label: 'Mới nhất' },
              { value: 'posts', label: 'Nhiều bài' },
              { value: 'title', label: 'Tên A-Z' },
            ]"
            :key="option.value"
            class="px-2 py-0.5 rounded-full transition-colors"
            :class="sortBy === option.value
              ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-medium'
              : 'text-(--color-text-secondary) hover:text-(--color-text-primary) hover:bg-(--color-bg-muted)'"
            @click="sortBy = option.value as typeof sortBy"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <!-- Active tab topic (if not in cached list) -->
      <button
        v-if="store.activeTabDetect.value && !activeTabInList"
        class="w-full text-left border-2 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/30 rounded-lg p-3 hover:border-blue-400 dark:hover:border-blue-600 transition-colors space-y-1.5"
        @click="handleActiveTabTopic"
      >
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 rounded-full">Tab hiện tại</span>
        </div>
        <p class="text-sm font-medium text-(--color-text-primary) line-clamp-2">
          {{ store.activeTabDetect.value.title }}
        </p>
        <div class="flex items-center gap-3 text-xs text-(--color-text-secondary)">
          <span
            v-if="store.summarizingUrl.value && store.activeTabUrl.value && store.summarizingUrl.value === store.activeTabUrl.value"
            class="badge bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 animate-pulse"
          >
            ⟳ Đang tóm tắt...
          </span>
          <span v-else class="badge badge-neutral">
            ○ Chưa tóm tắt
          </span>
          <span>{{ store.activeTabDetect.value.postCount }} bài viết</span>
          <span>{{ store.activeTabDetect.value.pageCount }} trang</span>
        </div>
      </button>

      <!-- Topic list grouped by domain -->
      <div v-if="domainNames.length > 0" class="space-y-4">
        <div v-for="domain in domainNames" :key="domain">
          <!-- Domain header -->
          <h3 class="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide mb-2">
            {{ domain }}
          </h3>

          <!-- Topic cards -->
          <div class="space-y-2">
            <div
              v-for="topic in groupedTopics[domain]"
              :key="topic.url"
            >
              <div
                class="relative border rounded-lg transition-colors"
                :class="store.summarizingUrl.value === topic.url
                  ? 'border-blue-300 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-900/20 animate-pulse'
                  : 'border-(--color-border) hover:border-blue-300 dark:hover:border-blue-600 hover:bg-(--color-accent-soft)'"
              >
                <button
                  class="w-full text-left p-3 space-y-1.5"
                  @click="selectTopic(topic)"
                >
                  <p class="text-sm font-medium text-(--color-text-primary) line-clamp-2 pr-12">{{ topic.title }}</p>
                  <div class="flex items-center gap-2 flex-wrap">
                    <!-- Status badge -->
                    <span
                      v-if="store.summarizingUrl.value === topic.url"
                      class="badge bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 animate-pulse"
                    >
                      ⟳ Đang tóm tắt...
                    </span>
                    <span
                      v-else-if="topic.summary"
                      class="badge badge-success"
                    >
                      ✓ Đã tóm tắt
                    </span>
                    <span
                      v-else
                      class="badge badge-neutral"
                    >
                      ○ Chưa tóm tắt
                    </span>
                    <!-- Post count -->
                    <span class="text-xs text-(--color-text-muted)">{{ topic.totalPosts }} bài</span>
                    <!-- Time -->
                    <span v-if="topic.cachedAt" class="text-xs text-(--color-text-muted)">
                      {{ formatRelativeTime(topic.cachedAt) }}
                    </span>
                  </div>
                </button>
                <!-- Action buttons — top-right corner -->
                <div
                  v-if="store.summarizingUrl.value !== topic.url"
                  class="absolute top-2 right-2 flex items-center gap-0.5"
                >
                  <button
                    class="p-1 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded"
                    title="Xóa topic"
                    @click.stop="confirmDelete(topic)"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- Inline confirmation -->
              <div
                v-if="pendingDeleteUrl === topic.url"
                class="alert alert-error flex items-center justify-between mt-1"
              >
                <span class="text-xs">Xóa topic này?</span>
                <div class="flex gap-2">
                  <button
                    class="btn btn-danger"
                    @click.stop="executeDelete"
                  >
                    Xóa
                  </button>
                  <button
                    class="btn btn-sm btn-secondary"
                    @click.stop="cancelDelete"
                  >
                    Hủy
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- No search results -->
      <div
        v-if="searchQuery && filteredTopics.length === 0"
        class="text-center py-6"
      >
        <p class="text-xs text-(--color-text-muted)">
          Không tìm thấy topic nào khớp "{{ searchQuery }}"
        </p>
      </div>

      <!-- Empty state -->
      <div
        v-if="allTopics.length === 0 && !store.activeTabDetect.value"
        class="text-center py-12 space-y-3"
      >
        <div class="text-3xl">📰</div>
        <p class="text-sm text-(--color-text-secondary)">
          Chưa có chủ đề nào. Mở một topic XenForo để bắt đầu.
        </p>
      </div>
    </template>
  </div>
</template>
