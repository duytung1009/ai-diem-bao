<script setup lang="ts">
defineProps<{
  text?: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-8 gap-3">
    <div class="flex items-center gap-1">
      <span class="w-2 h-2 rounded-full bg-(--color-accent) animate-pulse-soft" style="animation-delay: 0ms"></span>
      <span class="w-2 h-2 rounded-full bg-(--color-accent) animate-pulse-soft" style="animation-delay: 200ms"></span>
      <span class="w-2 h-2 rounded-full bg-(--color-accent) animate-pulse-soft" style="animation-delay: 400ms"></span>
    </div>
    <p v-if="text" class="text-sm text-(--color-text-secondary)">{{ text }}</p>
  </div>
</template>
