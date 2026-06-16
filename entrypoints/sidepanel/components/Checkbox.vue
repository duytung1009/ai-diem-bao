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
const cbId = `cb-${uid}`;

function onChange(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).checked);
}
</script>

<template>
  <label
    :for="cbId"
    class="inline-flex items-center gap-2 cursor-pointer"
    :class="{ 'opacity-40 cursor-not-allowed': disabled }"
  >
    <input
      :id="cbId"
      type="checkbox"
      class="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="onChange"
    >
    <span
      v-if="label"
      class="text-xs text-(--color-text-primary)"
    >
      {{ label }}
    </span>
  </label>
</template>
