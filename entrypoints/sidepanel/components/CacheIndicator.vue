<script setup lang="ts">
import { computed } from 'vue';
import type { CacheFreshness } from '@/lib/types';

const props = defineProps<{
  freshness: CacheFreshness;
  cachedAt: number;
  cachedPosts: number;
  currentPosts: number;
}>();

const emit = defineEmits<{
  update: [];
}>();

const badgeClass = computed(() => {
  switch (props.freshness) {
    case 'fresh':
      return 'bg-(--color-success-bg) text-(--color-success-text)';
    case 'stale':
      return 'bg-(--color-warning-bg) text-(--color-warning-text)';
    case 'outdated':
      return 'bg-(--color-error-bg) text-(--color-error-text)';
  }
});

const label = computed(() => {
  switch (props.freshness) {
    case 'fresh':
      return 'Cache mới';
    case 'stale':
      return 'Có bài mới';
    case 'outdated':
      return 'Cache cũ';
  }
});
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium" :class="badgeClass">
      <span class="w-1.5 h-1.5 rounded-full" :class="{
        'bg-green-500': freshness === 'fresh',
        'bg-yellow-500': freshness === 'stale',
        'bg-red-500': freshness === 'outdated',
      }" />
      {{ label }}
    </span>
  </div>
</template>
