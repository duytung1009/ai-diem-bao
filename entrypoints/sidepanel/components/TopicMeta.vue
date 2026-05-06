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

const totalRef = computed(() => props.topic.forumPostCount ?? props.topic.totalPosts ?? 0);

const isPartial = computed(() =>
  hasSummary.value && summarizedPostCount.value < totalRef.value,
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
    ? props.livePostCount - totalRef.value
    : 0,
);

const hasForumPostCount = computed(() =>
  !!props.topic.forumPostCount && props.topic.forumPostCount > (props.topic.totalPosts ?? 0),
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
      <span v-if="summaryStatus === 'none'" class="text-(--color-text-muted) font-medium">
        ○ Chưa tóm tắt
      </span>
      <span v-else-if="summaryStatus === 'in-progress'" class="text-blue-700 dark:text-blue-400 animate-pulse font-medium">
        ⟳ Đang tóm tắt...
      </span>
      <span v-else-if="summaryStatus === 'partial'" class="text-yellow-700 dark:text-yellow-400 font-medium">
        ~ Một phần
      </span>
      <span v-else class="text-(--color-success-text) font-medium">
        ✓ Đã tóm tắt {{ formatNumber(summarizedPostCount) }} bài
      </span>
      <!-- News badge -->
      <span v-if="topic.topicType === 'news'"
        class="text-purple-700 dark:text-purple-400 font-medium"
      >
        Tin tức
      </span>
    </div>

    <!-- Row 3: Metadata -->
    <div class="flex flex-wrap gap-3 mt-2 text-xs text-(--color-text-secondary)">
      <span>
        <template v-if="hasForumPostCount">
          {{ formatNumber(topic.totalPosts) }}/{{ formatNumber(topic.forumPostCount!) }} bài
        </template>
        <template v-else>{{ formatNumber(topic.totalPosts) }} bài</template>
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
