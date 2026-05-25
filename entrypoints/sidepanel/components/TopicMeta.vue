<script setup lang="ts">
import { computed } from 'vue';
import type { CachedTopic } from '@/lib/types';
import { topicSummaryStatus, formatTopicDate } from '@/lib/topic-utils';
import { formatNumber } from '@/lib/format';
import { isSameTopicUrl } from '@/lib/cache-manager';
import { useTopicStore } from '../composables/useTopicStore';

const props = defineProps<{
  topic: CachedTopic;
  isSummarizing?: boolean;
}>();

const store = useTopicStore();

const summarizedPostCount = computed(() => {
  return props.topic.summarizedPostCount ?? props.topic.totalPosts ?? 0;
});

const hasSummary = computed(() =>
  !!(props.topic.summary || props.topic.segments?.some(s => s?.summary)),
);

const totalRef = computed(() => props.topic.forumPostCount ?? props.topic.totalPosts ?? 0);

const liveCount = computed(() =>
  (store.activeTabDetect.value && store.activeTabUrl.value &&
    isSameTopicUrl(store.activeTabUrl.value, props.topic.url))
    ? store.activeTabDetect.value.postCount
    : 0,
);

const effectiveTotal = computed(() =>
  Math.max(totalRef.value, liveCount.value),
);

const isPartial = computed(() =>
  hasSummary.value && summarizedPostCount.value < effectiveTotal.value,
);

const summaryStatus = computed(() =>
  topicSummaryStatus(props.topic, props.isSummarizing ?? false),
);

const summaryDateLabel = computed(() => {
  if (!hasSummary.value || !props.topic.cachedAt) return null;
  return formatTopicDate(props.topic.cachedAt);
});

const newPostCount = computed(() =>
  Math.max(0, totalRef.value - summarizedPostCount.value),
);

const hasForumPostCount = computed(() =>
  !!props.topic.forumPostCount && props.topic.forumPostCount > (props.topic.totalPosts ?? 0),
);

const modelLabel = computed(() => {
  const cfg = props.topic.llmConfig;
  if (!cfg?.provider || !cfg?.model || !hasSummary.value) return null;
  return `${cfg.model}`;
});

async function navigateToTopic() {
  if (!props.topic.url) return;
  // Dùng tabs.create thay vì tabs.update — không cần tabs permission.
  // UX: mở tab mới thay vì navigate in-place (acceptable tradeoff để giảm permissions).
  await browser.tabs.create({ url: props.topic.url });
}
</script>

<template>
  <div class="card">
    <!-- Row 1: Title + badge -->
    <div class="flex items-start justify-between gap-2">
      <h2 class="font-semibold text-sm text-(--color-text-primary) leading-snug">
        {{ topic.title }}
        <!-- News badge -->
        <span v-if="topic.topicType === 'news'"
          class="text-purple-700 dark:text-purple-400 font-regular text-xs ml-1"
        >
          Tin tức
        </span>
      </h2>
    </div>

    <!-- Row 2: Summary status -->
    <div class="flex items-center gap-2 mt-2 text-xs">
      <span v-if="summaryStatus === 'none'" class="text-(--color-text-muted) font-medium">
        ○ Chưa tóm tắt
      </span>
      <span v-else-if="summaryStatus === 'in-progress'" class="text-blue-700 dark:text-blue-400 animate-pulse font-medium">
        ✨ Đang tóm tắt...
      </span>
      <span v-else-if="summaryStatus === 'partial'" class="text-yellow-700 dark:text-yellow-400 font-medium">
        ~ Một phần
      </span>
      <span v-else-if="summaryStatus === 'locked'" class="text-red-700 dark:text-red-400 font-medium">
        🔒 Đã khóa
      </span>
      <span v-else-if="summaryStatus === 'deleted'" class="text-gray-700 dark:text-gray-400 font-medium">
        ❌ Đã ốp
      </span>
      <span v-else class="text-(--color-success-text) font-medium">
        ✓ Đã tóm tắt
      </span>
    </div>

    <!-- Row 3: Metadata -->
    <div class="flex flex-wrap gap-3 mt-2 text-xs text-(--color-text-secondary)">
      <span>
        <template v-if="isPartial">
          {{ formatNumber(topic.summarizedPostCount ?? topic.totalPosts) + (hasForumPostCount ? `/${formatNumber(topic.forumPostCount!)}` : '') }} bài
        </template>
        <template v-else>{{ formatNumber(topic.summarizedPostCount ?? topic.totalPosts) }} bài</template>
        <span v-if="newPostCount > 0" class="text-(--color-accent-text)">(+{{ formatNumber(newPostCount) }} mới)</span>
      </span>
      <span>{{ formatNumber(topic.totalPages) }} trang</span>
      <span v-if="summaryDateLabel" class="text-(--color-text-secondary)">{{ summaryDateLabel }}</span>
      <span v-if="modelLabel" class="text-(--color-text-secondary) italic">{{ modelLabel }}</span>
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
