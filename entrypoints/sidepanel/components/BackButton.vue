<script setup lang="ts">
import { useRouter } from 'vue-router';

withDefaults(defineProps<{
  to?: string;
}>(), {
  to: '/',
});

const router = useRouter();
</script>

<template>
  <button
    class="btn-ghost inline-flex items-center gap-1 text-xs"
    @click="router.push(to)"
  >
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
    </svg>
    <span>Danh sách</span>
  </button>
</template>
