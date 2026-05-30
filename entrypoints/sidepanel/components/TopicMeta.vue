<script setup lang="ts">
import { computed } from 'vue';
import type { CachedTopic } from '@/lib/types';
import { topicSummaryStatus, formatTopicDate } from '@/lib/topic-utils';
import { formatNumber } from '@/lib/format';
import { isSameTopicUrl } from '@/lib/cache-manager';
import SummaryStatus from './SummaryStatus.vue';
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
  await browser.tabs.create({ url: props.topic.url });
}
</script>

<template>
  <div class="card space-y-1.5">
    <div class="flex items-start justify-between gap-2">
      <p class="text-sm font-medium text-(--color-text-primary) line-clamp-2 pr-16">
        {{ topic.title }}
        <span v-if="topic.topicType === 'news'"
          class="text-(--color-accent-text) font-regular text-xs ml-1"
        >
          Tin tức
        </span>
      </p>
    </div>

    <div class="flex items-center gap-2">
      <SummaryStatus :status="summaryStatus" />
    </div>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--color-text-secondary)">
      <span>
        <template v-if="isPartial">
          {{ formatNumber(topic.summarizedPostCount ?? topic.totalPosts) + (hasForumPostCount ? `/${formatNumber(topic.forumPostCount!)}` : '') }} bài
        </template>
        <template v-else>{{ formatNumber(topic.summarizedPostCount ?? topic.totalPosts) }} bài</template>
        <span v-if="newPostCount > 0" class="text-(--color-accent-text) font-medium">(+{{ formatNumber(newPostCount) }} mới)</span>
      </span>
      <span class="text-(--color-border-strong)">|</span>
      <span>{{ formatNumber(topic.totalPages) }} trang</span>
      <span v-if="summaryDateLabel" class="text-(--color-border-strong)">|</span>
      <span v-if="summaryDateLabel">{{ summaryDateLabel }}</span>
      <span v-if="modelLabel" class="text-(--color-border-strong)">|</span>
      <span v-if="modelLabel" class="italic">{{ modelLabel }}</span>
    </div>

    <button
      v-if="topic.url"
      class="link text-xs truncate max-w-full text-left block"
      :title="topic.url"
      @click="navigateToTopic"
    >
      {{ topic.url }}
    </button>
  </div>
</template>
