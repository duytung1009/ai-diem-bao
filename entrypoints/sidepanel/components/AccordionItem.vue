<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  title: string;
}>();

const isOpen = ref(false);
</script>

<template>
  <div class="border border-(--color-border) rounded-lg overflow-hidden">
    <button
      class="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-(--color-text-primary) bg-(--color-bg-base) hover:bg-(--color-bg-muted) transition-colors text-left"
      @click="isOpen = !isOpen"
    >
      <span>{{ title }}</span>
      <svg
        class="w-4 h-4 text-(--color-text-secondary) transition-transform duration-200 shrink-0 ml-2"
        :class="{ 'rotate-180': isOpen }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
    <div
      class="grid transition-[grid-template-rows] duration-200 ease-in-out"
      :class="isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
    >
      <div class="overflow-hidden">
        <div class="px-3 py-2.5">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>
