<script setup lang="ts">
import type { TopicSummaryStatus } from '@/lib/topic-utils';

defineProps<{
  status: TopicSummaryStatus;
}>();
</script>

<template>
  <span v-if="status === 'none'" class="text-(--color-text-muted) font-medium">○ Chưa tóm tắt</span>
  <span v-else-if="status === 'in-progress'" class="text-blue-700 dark:text-blue-400 animate-pulse font-medium">✨ Đang tóm tắt...</span>
  <span v-else-if="status === 'partial'" class="text-yellow-700 dark:text-yellow-400 font-medium">~ Một phần</span>
  <span v-else-if="status === 'locked'" class="text-red-700 dark:text-red-400 font-medium">🔒 Đã khóa</span>
  <span v-else-if="status === 'deleted'" class="text-gray-700 dark:text-gray-400 font-medium">❌ Đã ốp</span>
  <span v-else class="text-(--color-success-text) font-medium">✓ Đã tóm tắt</span>
</template>
