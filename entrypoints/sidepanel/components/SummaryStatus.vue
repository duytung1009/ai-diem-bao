<script setup lang="ts">
import type { TopicSummaryStatus } from '@/lib/topic-utils';

defineProps<{
  status: TopicSummaryStatus;
}>();
</script>

<template>
  <span v-if="status === 'none'" class="badge badge-neutral">
    <span class="w-1.5 h-1.5 rounded-full bg-(--color-text-muted) inline-block shrink-0"></span>
    Chưa tóm tắt
  </span>
  <span v-else-if="status === 'in-progress'" class="badge badge-accent">
    <span class="w-1.5 h-1.5 rounded-full bg-(--color-accent) inline-block shrink-0 animate-pulse-soft"></span>
    Đang tóm tắt
  </span>
  <span v-else-if="status === 'partial'" class="badge badge-warning">
    <span class="w-1.5 h-1.5 rounded-full bg-(--color-warning-text) inline-block shrink-0"></span>
    Một phần
  </span>
  <span v-else-if="status === 'locked'" class="badge badge-info">
    <span class="w-1.5 h-1.5 rounded-full bg-(--color-info-text) inline-block shrink-0"></span>
    Đã khóa
  </span>
  <span v-else-if="status === 'deleted'" class="badge badge-neutral line-through">
    <span class="w-1.5 h-1.5 rounded-full bg-(--color-text-muted) inline-block shrink-0"></span>
    Đã ốp
  </span>
  <span v-else class="badge badge-success">
    <span class="w-1.5 h-1.5 rounded-full bg-(--color-success-text) inline-block shrink-0"></span>
    Đã tóm tắt
  </span>
</template>
