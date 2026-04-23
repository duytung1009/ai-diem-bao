<script setup lang="ts">
import { computed } from 'vue';
import type { CachedTopic } from '@/lib/types';
import { formatTopicDate } from '@/lib/topic-utils';
import { formatNumber } from '@/lib/format';

const props = defineProps<{
  topic: CachedTopic;
  livePostCount?: number;
  isSummarizing?: boolean;
}>();

const isNews = computed(() => props.topic.topicType === 'news');

const summarizedPostCount = computed(() =>
  props.topic.summarizedPostCount ?? props.topic.totalPosts ?? 0,
);

const hasSummary = computed(() =>
  !!(props.topic.summary || props.topic.segments?.some(s => s?.summary)),
);

const isPartial = computed(() =>
  hasSummary.value && summarizedPostCount.value < (props.topic.totalPosts ?? 0),
);

const summaryStatus = computed(() => {
  if (props.isSummarizing) return 'in-progress';
  if (!hasSummary.value) return 'none';
  if (isPartial.value) return 'partial';
  return 'done';
});

const summaryDateLabel = computed(() => {
  if (!hasSummary.value || !props.topic.cachedAt) return null;
  return formatTopicDate(props.topic.cachedAt);
});

const newPostCount = computed(() =>
  props.livePostCount != null
    ? props.livePostCount - (props.topic.totalPosts ?? 0)
    : 0,
);

async function navigateToTopic() {
  if (!props.topic.url) return;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.update(tab.id, { url: props.topic.url });
    }
  } catch {
    await browser.tabs.create({ url: props.topic.url });
  }
}
</script>

<template>
  <div class="card">
    <!-- Row 1: Title + badge -->
    <div class="flex items-start justify-between gap-2">
      <h2 class="font-semibold text-sm text-(--color-text-primary) leading-snug">
        {{ topic.title }}
      </h2>
    </div>

    <!-- Row 2: Summary status -->
    <div class="flex items-center gap-2 mt-2 text-xs">
      <span v-if="summaryStatus === 'none'" class="badge badge-neutral">
        ○ Chưa tóm tắt
      </span>
      <span v-else-if="summaryStatus === 'in-progress'" class="badge bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 animate-pulse">
        ⟳ Đang tóm tắt...
      </span>
      <span v-else-if="summaryStatus === 'partial'" class="badge bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
        ~ Một phần
      </span>
      <span v-else class="badge badge-success">
        ✓ Đã tóm tắt {{ formatNumber(summarizedPostCount) }} bài
      </span>
      <!-- News badge -->
      <span v-if="topic.topicType === 'news'"
        class="badge bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-400"
      >
        Tin tức
      </span>
    </div>

    <!-- Row 3: Metadata -->
    <div class="flex flex-wrap gap-3 mt-2 text-xs text-(--color-text-secondary)">
      <span>
        {{ formatNumber(topic.totalPosts) }} bài
        <span v-if="newPostCount > 0" class="text-(--color-accent-text)">(+{{ formatNumber(newPostCount) }} mới)</span>
      </span>
      <span>{{ formatNumber(topic.totalPages) }} trang</span>
      <span v-if="summaryDateLabel" class="text-(--color-text-secondary) ml-1">{{ summaryDateLabel }}</span>
    </div>
    
    <!-- Row 4: URL -->
    <button
      v-if="topic.url"
      class="mt-1.5 text-xs text-(--color-accent-text) hover:text-(--color-accent-hover) truncate max-w-full text-left"
      :title="topic.url"
      @click="navigateToTopic"
    >
      {{ topic.url }}
    </button>
  </div>
</template>
