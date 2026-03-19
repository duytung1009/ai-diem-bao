<script setup lang="ts">
defineProps<{
  text?: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-8 gap-3">
    <div
      class="w-8 h-8 border-3 border-[var(--color-bg-muted)] border-t-[var(--color-accent)] rounded-full animate-spin"
    ></div>
    <p v-if="text" class="text-sm text-[var(--color-text-secondary)]">{{ text }}</p>
  </div>
</template>
