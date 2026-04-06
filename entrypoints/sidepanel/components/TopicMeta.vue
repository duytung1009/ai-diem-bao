<script setup lang="ts">
import type { DetectResult } from '@/lib/types';

const props = defineProps<{
  info: DetectResult;
  url?: string;
  isNews?: boolean;
}>();

async function navigateToTopic() {
  if (!props.url) return;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.update(tab.id, { url: props.url });
    }
  } catch {
    await browser.tabs.create({ url: props.url });
  }
}
</script>

<template>
  <div class="card">
    <div class="flex items-start justify-between gap-2">
      <h2 class="font-semibold text-sm text-(--color-text-primary) leading-snug">{{ info.title }}</h2>
      <span v-if="isNews" class="badge bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-400 shrink-0">
        Tin tức
      </span>
    </div>
    <div class="flex gap-3 mt-2 text-xs text-(--color-text-secondary)">
      <span>{{ info.postCount }} bài viết</span>
      <span>{{ info.pageCount }} trang</span>
      <span
        class="uppercase font-mono px-1.5 py-0.5 rounded text-xs"
        :class="
          info.version === 'xf2'
            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
            : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
        "
      >
        {{ info.version }}
      </span>
    </div>
    <button
      v-if="url"
      class="mt-1.5 text-xs text-(--color-accent-text) hover:text-(--color-accent-hover) truncate max-w-full text-left"
      :title="url"
      @click="navigateToTopic"
    >
      {{ url }}
    </button>
  </div>
</template>
