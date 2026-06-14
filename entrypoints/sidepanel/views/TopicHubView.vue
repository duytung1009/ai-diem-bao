<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage } from '@/lib/messaging';
import { isSameTopicUrl, normalizeUrl } from '@/lib/cache-manager';
import { topicSummaryStatus, formatTopicDate } from '@/lib/topic-utils';
import { formatNumber } from '@/lib/format';
import type { CachedTopic, TopicSegment, KnowledgeEntry, NotebookEntry } from '@/lib/types';
import { useTopicStore } from '../composables/useTopicStore';
import { useOptimisticUpdate } from '../composables/useOptimisticUpdate';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import SummaryStatus from '../components/SummaryStatus.vue';
import CostConfirmModal from '../components/CostConfirmModal.vue';
import { useForumManager } from '../composables/useForumManager';

const router = useRouter();
const store = useTopicStore();
const { optimisticUpdate } = useOptimisticUpdate(store);
const { userForums, loadForums, addForumByHostname } = useForumManager();
const allTopics = ref<CachedTopic[]>([]);
const isLoading = ref(true);
const showDeleteModal = ref(false);
const deleteTopicUrl = ref<string | null>(null);
const deleteNotebookCount = ref(0);
const searchQuery = ref('');
const sortBy = ref<'recent' | 'posts' | 'title'>('recent');
const showBookmarkedOnly = ref(false);
const filterDomain = ref<string | null>(null);

const bookmarkCount = computed(() => allTopics.value.filter(t => t.bookmarked).length);

// Top domains sorted by topic count, max 6
const allDomains = computed(() => {
  const counts: Record<string, number> = {};
  for (const topic of allTopics.value) {
    try {
      const h = new URL(topic.url).hostname;
      counts[h] = (counts[h] ?? 0) + 1;
    } catch { /* skip */ }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([host]) => host);
});

// Temp topic: injected into domain groups while summarizing a topic not yet in cache
const summarizingTempTopic = computed(() => {
  const url = store.summarizingUrl.value;
  if (!url) return null;
  const alreadyInList = allTopics.value.some(t => normalizeUrl(t.url) === normalizeUrl(url));
  if (alreadyInList) return null;
  const selected = store.selectedTopic.value;
  return selected?.url === url ? selected : null;
});

// Filter + sort topics (excludes temp topic — added separately in groupedTopics)
const filteredTopics = computed(() => {
  let topics = [...allTopics.value];

  // Domain filter
  if (filterDomain.value) {
    topics = topics.filter(t => { try { return new URL(t.url).hostname === filterDomain.value; } catch { return false; } });
  }

  // Bookmark filter
  if (showBookmarkedOnly.value) {
    topics = topics.filter(t => t.bookmarked);
  }

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
  return allTopics.value.some(t => normalizeUrl(t.url) === normalizeUrl(store.activeTabUrl.value!));
});

// Cached topic matching the active tab URL (if any)
const activeTabCachedTopic = computed<CachedTopic | null>(() => {
  if (!store.activeTabUrl.value) return null;
  return allTopics.value.find(t => normalizeUrl(t.url) === normalizeUrl(store.activeTabUrl.value!)) || null;
});

// Summary status for active tab topic
const activeTabStatus = computed(() => {
  if (!store.activeTabDetect.value) return 'none' as const;
  const isSummarizing = store.summarizingUrl.value && store.activeTabUrl.value
    && isSameTopicUrl(store.summarizingUrl.value, store.activeTabUrl.value);
  if (isSummarizing) return 'in-progress' as const;
  const cached = activeTabCachedTopic.value;
  if (cached) return topicSummaryStatus(cached, false);
  return 'none' as const;
});

// Track unsummarized posts count per topic
const newPostsMap = computed<Record<string, number>>(() => {
  const result: Record<string, number> = {};
  for (const topic of allTopics.value) {
    const totalRef = topic.forumPostCount ?? topic.totalPosts ?? 0;
    const summarized = topic.summarizedPostCount ?? topic.totalPosts ?? 0;
    const delta = totalRef - summarized;
    if (delta > 0) result[topic.url] = delta;
  }
  return result;
});

async function refreshTopicList(showLoading = false) {
  if (showLoading) isLoading.value = true;
  try {
    const topics = await sendMessage<CachedTopic[]>('GET_ALL_CACHED_TOPICS');
    allTopics.value = topics || [];
  } catch { /* keep existing data */ }
  finally { if (showLoading) isLoading.value = false; }
}

onMounted(() => { refreshTopicList(true); loadForums(); });

onActivated(() => { refreshTopicList(); });

// Sync selected topic changes into allTopics list
watch(() => store.selectedTopic.value, (updated) => {
  if (!updated?.url) return;
  const idx = allTopics.value.findIndex(t => isSameTopicUrl(t.url, updated.url));
  if (idx >= 0) {
    allTopics.value[idx] = {
      ...allTopics.value[idx],
      ...updated,
      posts: updated.posts ? [...updated.posts] : allTopics.value[idx].posts,
      researchHistory: updated.researchHistory ? [...updated.researchHistory] : allTopics.value[idx].researchHistory,
      segments: updated.segments ? [...updated.segments] as TopicSegment[] : allTopics.value[idx].segments,
      knowledgeEntries: updated.knowledgeEntries ? [...updated.knowledgeEntries] as KnowledgeEntry[] : allTopics.value[idx].knowledgeEntries,
    } as CachedTopic;
  } else if (updated.summary || updated.posts?.length) {
    const topic: CachedTopic = {
      ...updated,
      posts: updated.posts ? [...updated.posts] : [],
      researchHistory: updated.researchHistory ? [...updated.researchHistory] : [],
      segments: updated.segments ? [...updated.segments] as TopicSegment[] : undefined,
    } as CachedTopic;
    allTopics.value = [...allTopics.value, topic];
  }
});

function selectTopic(topic: CachedTopic) {
  store.selectTopic(topic);
  router.push('/summary');
}

async function confirmDelete(topic: CachedTopic) {
  deleteTopicUrl.value = topic.url;
  const entries = await sendMessage<NotebookEntry[]>('GET_NOTEBOOK_ENTRIES', { topicUrl: topic.url });
  deleteNotebookCount.value = entries.length;
  showDeleteModal.value = true;
}

function cancelDelete() {
  showDeleteModal.value = false;
  deleteTopicUrl.value = null;
  deleteNotebookCount.value = 0;
}

async function executeDelete() {
  const url = deleteTopicUrl.value;
  if (!url) return;
  try {
    await deleteCachedTopic(url);
  } finally {
    cancelDelete();
  }
}

async function executeDeleteOrphan() {
  const url = deleteTopicUrl.value;
  if (!url) return;
  try {
    await sendMessage('ORPHAN_NOTEBOOK_BY_TOPIC', { topicUrl: url });
    await deleteCachedTopic(url);
  } finally {
    cancelDelete();
  }
}

async function deleteCachedTopic(url: string) {
  await sendMessage('DELETE_CACHED_TOPIC', url);
  allTopics.value = allTopics.value.filter(t => t.url !== url);
  if (store.selectedTopic.value?.url === url) {
    store.clearSelection();
  }
}

function handleActiveTabTopic() {
  // Navigate to summary view — SummaryView will detect the active tab topic
  if (store.activeTabDetect.value && store.activeTabUrl.value) {
    if (activeTabCachedTopic.value) {
      // Nếu đã có cached topic khớp active tab, dùng luôn
      store.selectTopic(activeTabCachedTopic.value);
      router.push('/summary');
      return;
    }
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

async function toggleBookmark(topic: CachedTopic) {
  const updated = { ...topic, bookmarked: !topic.bookmarked };
  const idx = allTopics.value.findIndex(t => t.url === topic.url);
  if (idx !== -1) allTopics.value[idx] = updated;
  if (store.selectedTopic.value?.url === topic.url) {
    await optimisticUpdate({ bookmarked: updated.bookmarked });
  } else {
    await sendMessage('SAVE_CACHED_TOPIC', { url: topic.url, bookmarked: updated.bookmarked }).catch(() => {});
  }
}
</script>

<template>
  <div class="p-3 space-y-2">
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
            placeholder="Tìm kiếm thớt..."
            class="input pl-8 pr-8 text-xs w-full"
          />
          <!-- Bookmark filter toggle -->
          <button
            class="absolute right-2 top-1/2 -translate-y-1/2 transition-colors"
            :class="showBookmarkedOnly ? 'text-yellow-500' : 'text-(--color-text-muted) hover:text-(--color-text-secondary)'"
            :title="showBookmarkedOnly ? 'Xem tất cả' : `Chỉ hiện đã đánh dấu${bookmarkCount > 0 ? ` (${bookmarkCount})` : ''}`"
            @click="showBookmarkedOnly = !showBookmarkedOnly"
          >
            <svg v-if="showBookmarkedOnly" class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z" />
            </svg>
            <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z" />
            </svg>
          </button>
        </div>
        <!-- Domain filter pills -->
        <div v-if="allDomains.length > 1" class="flex flex-wrap gap-1.5">
          <button
            v-if="filterDomain"
            class="badge badge-neutral"
            @click="filterDomain = null"
          >
            Tất cả diễn đàn
          </button>
          <button
            v-for="domain in allDomains"
            :key="domain"
            class="badge transition-colors"
            :class="filterDomain === domain
              ? 'badge-accent'
              : 'badge-neutral'"
            @click="filterDomain = filterDomain === domain ? null : domain"
          >
            {{ domain }}
          </button>
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
            class="badge capitalize transition-colors"
            :class="sortBy === option.value
              ? 'badge-accent'
              : 'badge-neutral'"
            @click="sortBy = option.value as typeof sortBy"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <!-- Active tab topic -->
      <button
        v-if="store.activeTabDetect.value"
        class="w-full text-left card border-(--color-accent) border-2 bg-(--color-accent-soft) hover:bg-(--color-accent-soft) transition-colors space-y-1.5"
        @click="handleActiveTabTopic"
      >
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-(--color-accent-text)">Tab hiện tại</span>
        </div>
        <p class="text-sm font-medium text-(--color-text-primary) line-clamp-2">
          {{ store.activeTabDetect.value.title }}
          <!-- News badge -->
          <span v-if="activeTabCachedTopic?.topicType === 'news'"
            class="text-(--color-accent-text) font-regular text-xs ml-1"
          >
            Tin tức
          </span>
        </p>
        <div class="flex items-center gap-2 justify-between">
          <div class="flex items-center gap-2 flex-wrap">
            <SummaryStatus :status="activeTabStatus" />
          </div>
        </div>
      </button>

      <!-- Topic list grouped by domain -->
      <div v-if="domainNames.length > 0" class="space-y-4">
        <div v-for="domain in domainNames" :key="domain">
          <!-- Domain header -->
          <h4 class="section-heading flex-1 mb-1">
            {{ domain }}
          </h4>

          <!-- Topic cards -->
          <div class="space-y-2">
            <div
              v-for="topic in groupedTopics[domain]"
              :key="topic.url"
            >
              <div
                class="relative card-interactive transition-colors"
                :class="store.summarizingUrl.value === topic.url
                  ? 'border-(--color-secondary) bg-(--color-secondary-soft) animate-pulse-soft'
                  : ''"
              >
                <button
                  class="w-full text-left space-y-1.5"
                  :title="topic.title"
                  @click="selectTopic(topic)"
                >
                  <p class="text-sm font-medium text-(--color-text-primary) line-clamp-2 pr-16">{{ topic.title }}
                    <!-- News badge -->
                    <span v-if="topic.topicType === 'news'"
                      class="text-(--color-accent-text) font-regular text-xs ml-1"
                    >
                      Tin tức
                    </span>
                  </p>
                  <div class="flex flex-col items-start gap-2">
                    <div class="flex items-center gap-2 flex-wrap">
                      <!-- Status badge -->
                      <SummaryStatus :status="isSameTopicUrl(store.summarizingUrl.value, topic.url) ? 'in-progress' : topicSummaryStatus(topic, false)" />
                    </div>

                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--color-text-secondary)">
                      <span>
                        <template v-if="topic.forumPostCount && topic.forumPostCount > topic.totalPosts">
                          {{ formatNumber(topic.summarizedPostCount ?? topic.totalPosts) }}/{{ formatNumber(topic.forumPostCount) }} bài
                        </template>
                        <template v-else-if="topicSummaryStatus(topic, false) === 'partial'">
                          {{ formatNumber(topic.summarizedPostCount ?? topic.totalPosts) }}/{{ formatNumber(topic.totalPosts) }} bài
                        </template>
                        <template v-else>{{ formatNumber(topic.summarizedPostCount ?? topic.totalPosts) }} bài</template>
                        <span
                          v-if="newPostsMap[topic.url]"
                          class="text-(--color-accent-text) ml-0.5"
                        >(+{{ formatNumber(newPostsMap[topic.url]) }} mới)</span>
                      </span>
                      <span class="text-(--color-border-strong)">|</span>
                      <span>{{ formatNumber(topic.totalPages) }} trang</span>
                      <span v-if="topic.cachedAt" class="text-(--color-border-strong)">|</span>
                      <span v-if="topic.cachedAt">{{ formatTopicDate(topic.cachedAt) }}</span>
                      <span v-if="topic.llmConfig?.model && (topic.summary || topic.segments?.some(s => s?.summary))" class="text-(--color-border-strong)">|</span>
                      <span v-if="topic.llmConfig?.model && (topic.summary || topic.segments?.some(s => s?.summary))" class="italic truncate max-w-24" :title="`${topic.llmConfig.model}`">{{ topic.llmConfig.model }}</span>
                    </div>
                  </div>
                </button>
                <!-- Action buttons — top-right corner -->
                <div
                  v-if="!isSameTopicUrl(store.summarizingUrl.value, topic.url)"
                  class="absolute top-2 right-2 flex items-center gap-0.5"
                >
                  <button
                    class="p-1 transition-colors rounded"
                    :class="topic.bookmarked
                      ? 'text-yellow-500'
                      : 'text-(--color-text-muted) hover:text-yellow-500'"
                    title="Đánh dấu"
                    @click.stop="toggleBookmark(topic)"
                  >
                    <svg v-if="topic.bookmarked" class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z" />
                    </svg>
                    <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z" />
                    </svg>
                  </button>
                  <button
                    class="p-1 text-(--color-text-muted) hover:text-(--color-error-text) transition-colors rounded"
                    title="Xoá thớt"
                    @click.stop="confirmDelete(topic)"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Delete confirmation modal -->
      <CostConfirmModal
        v-if="showDeleteModal"
        title="Xoá thớt"
        message="Hành động này không thể hoàn tác."
        :warning="deleteNotebookCount > 0 ? `Thớt này có ${deleteNotebookCount} kiến thức đã lưu.` : undefined"
        :danger-confirm-text="deleteNotebookCount > 0 ? 'Chỉ xoá thớt' : 'Xóa'"
        @dangerConfirm="deleteNotebookCount > 0 ? executeDeleteOrphan() : executeDelete()"
        @cancel="cancelDelete"
      />

      <!-- No search results -->
      <div
        v-if="searchQuery && filteredTopics.length === 0"
        class="text-center py-6"
      >
        <p class="text-xs text-(--color-text-muted)">
          Không tìm thấy thớt nào khớp "{{ searchQuery }}"
        </p>
      </div>

      <!-- Empty state: onboarding for first-time users -->
      <div
        v-if="allTopics.length === 0 && userForums.length === 0"
        class="text-center py-12 space-y-4 px-6"
      >
        <div class="text-4xl">🏘️</div>
        <p class="text-sm font-medium text-(--color-text-primary)">
          Chưa có forum nào được thêm
        </p>
        <p class="text-xs text-(--color-text-secondary)">
          Extension cần quyền truy cập forum trước khi hoạt động.
          Thêm forum bên dưới hoặc vào <strong>Cài đặt → Forum hỗ trợ</strong> để quản lý.
        </p>
        <div class="flex gap-2 justify-center">
          <button
            class="btn btn-sm btn-primary"
            @click="addForumByHostname('voz.vn')"
          >
            Thêm voz.vn
          </button>
          <button
            class="btn btn-sm btn-secondary"
            @click="addForumByHostname('www.otofun.net')"
          >
            Thêm www.otofun.net
          </button>
        </div>
        <p class="text-xs text-(--color-text-muted)">
          Forum khác? Vào <strong>Cài đặt → Forum hỗ trợ</strong> để thêm thủ công.
        </p>
      </div>

      <!-- Empty state: have forums but no cached topics yet -->
      <div
        v-if="allTopics.length === 0 && userForums.length > 0 && !store.activeTabDetect.value"
        class="text-center py-12 space-y-3"
      >
        <div class="text-3xl">📰</div>
        <p class="text-sm text-(--color-text-secondary)">
          Chưa tìm thấy thớt nào.
        </p>
      </div>
    </template>
  </div>
</template>
