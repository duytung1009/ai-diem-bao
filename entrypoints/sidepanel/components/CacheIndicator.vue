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

const timeAgo = computed(() => {
  const diff = Date.now() - props.cachedAt;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
});

const badgeClass = computed(() => {
  switch (props.freshness) {
    case 'fresh':
      return 'bg-green-100 text-green-700';
    case 'stale':
      return 'bg-yellow-100 text-yellow-700';
    case 'outdated':
      return 'bg-red-100 text-red-700';
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

const newPostCount = computed(() => props.currentPosts - props.cachedPosts);
</script>

<template>
  <div class="flex items-center gap-2">
    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium" :class="badgeClass">
      <span class="w-1.5 h-1.5 rounded-full" :class="{
        'bg-green-500': freshness === 'fresh',
        'bg-yellow-500': freshness === 'stale',
        'bg-red-500': freshness === 'outdated',
      }" />
      {{ label }}
    </span>
    <span class="text-[11px] text-gray-400">{{ timeAgo }}</span>
    <button
      v-if="freshness !== 'fresh'"
      class="text-[11px] text-blue-600 hover:text-blue-700 font-medium"
      @click="emit('update')"
    >
      Cập nhật
      <template v-if="newPostCount > 0">(+{{ newPostCount }})</template>
    </button>
  </div>
</template>
