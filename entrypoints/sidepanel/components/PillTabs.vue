<script setup lang="ts" generic="T extends string">
defineProps<{
  tabs: { value: T; label: string }[];
  modelValue: T;
  loadingTabs?: Set<T>;
  dotTabs?: Set<T>;
}>();

defineEmits<{
  'update:modelValue': [value: T];
}>();
</script>

<template>
  <div class="flex gap-1 bg-(--color-bg-muted) rounded-lg p-0.5">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      class="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-all duration-150"
      :class="modelValue === tab.value
        ? 'bg-(--color-bg-surface) text-(--color-text-primary) shadow-sm'
        : 'text-(--color-text-secondary) hover:text-(--color-accent-text)'"
      @click="$emit('update:modelValue', tab.value)"
    >
      <svg v-if="loadingTabs?.has(tab.value)" class="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span v-else-if="dotTabs?.has(tab.value)" class="w-1.5 h-1.5 rounded-full bg-(--color-accent) shrink-0" />
      {{ tab.label }}
    </button>
  </div>
</template>
