<script setup lang="ts">
import type { DetectResult } from '@/lib/types';

defineProps<{
  info: DetectResult;
}>();
</script>

<template>
  <div class="bg-white rounded-lg border border-gray-200 p-3">
    <h2 class="font-semibold text-sm text-gray-900 leading-snug">{{ info.title }}</h2>
    <div class="flex gap-3 mt-2 text-xs text-gray-500">
      <span>{{ info.postCount }} bài viết</span>
      <span>{{ info.pageCount }} trang</span>
      <span
        class="uppercase font-mono px-1.5 py-0.5 rounded text-xs"
        :class="
          info.version === 'xf2'
            ? 'bg-green-100 text-green-700'
            : 'bg-yellow-100 text-yellow-700'
        "
      >
        {{ info.version }}
      </span>
    </div>
  </div>
</template>
