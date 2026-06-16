<script setup lang="ts">
import { computed, useId } from 'vue';

const props = withDefaults(defineProps<{
  modelValue?: boolean;
  label?: string;
  disabled?: boolean;
}>(), {
  modelValue: false,
  disabled: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const uid = useId();
const switchId = `toggle-${uid}`;

function onChange(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).checked);
}
</script>

<template>
  <label
    :for="switchId"
    class="relative inline-flex items-center cursor-pointer gap-3"
    :class="{ 'opacity-40 cursor-not-allowed': disabled }"
  >
    <input
      :id="switchId"
      type="checkbox"
      class="sr-only peer"
      :checked="modelValue"
      :disabled="disabled"
      @change="onChange"
    >
    <div
      class="w-9 h-5 bg-(--color-bg-muted) peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-(--color-border-strong) after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-(--color-accent)"
    />
    <span
      v-if="label"
      class="text-xs text-(--color-text-primary)"
    >
      {{ label }}
    </span>
  </label>
</template>
