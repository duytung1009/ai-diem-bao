<script setup lang="ts">
defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    class="inline-flex items-center gap-1 text-xs text-(--color-text-secondary) hover:text-(--color-text-primary) transition-colors py-0.5 px-1.5 rounded-md hover:bg-(--color-bg-muted)"
    @click="$emit('click')"
  >
    <slot />
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
    </svg>
  </button>
</template>
