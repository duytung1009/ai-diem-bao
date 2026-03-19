<script setup lang="ts">
import type { DetectResult } from '@/lib/types';

defineProps<{
  info: DetectResult;
}>();
</script>

<template>
  <div class="card">
    <h2 class="font-semibold text-sm text-[var(--color-text-primary)] leading-snug">{{ info.title }}</h2>
    <div class="flex gap-3 mt-2 text-xs text-[var(--color-text-secondary)]">
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
  </div>
</template>
