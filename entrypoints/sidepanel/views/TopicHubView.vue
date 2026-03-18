<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage } from '@/lib/messaging';
import type { CachedTopic, DetectResult } from '@/lib/types';
import { useTopicStore } from '../composables/useTopicStore';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const router = useRouter();
const store = useTopicStore();
const allTopics = ref<CachedTopic[]>([]);
const isLoading = ref(true);

// Group topics by domain
const groupedTopics = computed(() => {
  const groups: Record<string, CachedTopic[]> = {};
  for (const topic of allTopics.value) {
    try {
      const hostname = new URL(topic.url).hostname;
      if (!groups[hostname]) groups[hostname] = [];
      groups[hostname].push(topic);
    } catch {
      if (!groups['Khác']) groups['Khác'] = [];
      groups['Khác'].push(topic);
    }
  }
  // Sort topics within each group by cachedAt descending
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0));
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

function selectTopic(topic: CachedTopic) {
  store.selectTopic(topic);
  router.push('/summary');
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
      <!-- Active tab topic (if not in cached list) -->
      <button
        v-if="store.activeTabDetect.value && !activeTabInList"
        class="w-full text-left border-2 border-blue-200 bg-blue-50 rounded-lg p-3 hover:border-blue-400 transition-colors space-y-1.5"
        @click="handleActiveTabTopic"
      >
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">Tab hiện tại</span>
        </div>
        <p class="text-sm font-medium text-gray-900 line-clamp-2">
          {{ store.activeTabDetect.value.title }}
        </p>
        <div class="flex items-center gap-3 text-xs text-gray-500">
          <span>{{ store.activeTabDetect.value.postCount }} bài viết</span>
          <span>{{ store.activeTabDetect.value.pageCount }} trang</span>
          <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">○ Chưa tóm tắt</span>
        </div>
      </button>

      <!-- Topic list grouped by domain -->
      <div v-if="domainNames.length > 0" class="space-y-4">
        <div v-for="domain in domainNames" :key="domain">
          <!-- Domain header -->
          <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {{ domain }}
          </h3>

          <!-- Topic cards -->
          <div class="space-y-2">
            <button
              v-for="topic in groupedTopics[domain]"
              :key="topic.url"
              class="w-full text-left border border-gray-200 rounded-lg p-3 hover:border-blue-300 hover:bg-blue-50/50 transition-colors space-y-1.5"
              @click="selectTopic(topic)"
            >
              <p class="text-sm font-medium text-gray-900 line-clamp-2">{{ topic.title }}</p>
              <div class="flex items-center gap-2 flex-wrap">
                <!-- Status badge -->
                <span
                  v-if="topic.summary"
                  class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium"
                >
                  ✓ Đã tóm tắt
                </span>
                <span
                  v-else
                  class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"
                >
                  ○ Chưa tóm tắt
                </span>
                <!-- Post count -->
                <span class="text-xs text-gray-400">{{ topic.totalPosts }} bài</span>
                <!-- Time -->
                <span v-if="topic.cachedAt" class="text-xs text-gray-400">
                  {{ formatRelativeTime(topic.cachedAt) }}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-if="domainNames.length === 0 && !store.activeTabDetect.value"
        class="text-center py-12 space-y-3"
      >
        <div class="text-3xl">📰</div>
        <p class="text-sm text-gray-500">
          Chưa có chủ đề nào. Mở một topic XenForo để bắt đầu.
        </p>
      </div>
    </template>
  </div>
</template>
