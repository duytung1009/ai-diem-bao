<script setup lang="ts">
import { ref } from 'vue';

withDefaults(defineProps<{
  label?: string;
  disabled?: boolean;
  onReload?: () => void;
}>(), {
  label: 'Tải lại',
});

const open = ref(false);

function handleClick() {
  open.value = !open.value;
}

function handleAction() {
  open.value = false;
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      :aria-label="label"
      :title="label"
      :disabled="disabled"
      class="inline-flex items-center justify-center p-1.5 rounded-lg text-(--color-text-secondary) hover:text-(--color-text-primary) hover:bg-(--color-bg-muted) transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
      @click="onReload ? onReload() : handleClick()"
    >
      <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': disabled }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>

    <div
      v-if="open && $slots.actions"
      class="absolute right-0 top-full mt-1 z-50 min-w-[180px] bg-(--color-bg-surface) border border-(--color-border) rounded-lg shadow-dropdown py-1 overflow-hidden"

    >
      <slot name="actions" />
    </div>

    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions,vuejs-accessibility/click-events-have-key-events -- backdrop -->
    <div
      v-if="open"
      class="fixed inset-0 z-0"
      @click="open = false"
    />
  </div>
</template>
