<script setup lang="ts">
withDefaults(defineProps<{
  modelValue?: string;
  placeholder?: string;
  label?: string;
}>(), {
  placeholder: 'Tìm kiếm...',
  label: 'Tìm kiếm',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="relative">
    <svg
      class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-(--color-text-muted)"
      fill="none" stroke="currentColor" viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
    <input
      :value="modelValue"
      :placeholder="placeholder"
      :aria-label="label"
      type="text"
      class="input pl-8 pr-8 text-xs w-full"
      @input="onInput"
    >
    <div v-if="$slots.actions" class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
      <slot name="actions" />
    </div>
  </div>
</template>
