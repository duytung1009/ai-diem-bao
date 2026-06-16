<script setup lang="ts">
withDefaults(defineProps<{
  label?: string;
  align?: 'left' | 'right';
}>(), {
  label: 'Tuỳ chọn',
  align: 'right',
});

const emit = defineEmits<{
  close: [];
}>();

const open = ref(false);
const panel = ref<HTMLElement | null>(null);

function onTriggerClick() {
  open.value = !open.value;
  if (open.value) {
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
  }
}

function handleClickOutside(e: MouseEvent) {
  if (panel.value && !panel.value.contains(e.target as Node)) {
    open.value = false;
    emit('close');
    cleanup();
  }
}

function cleanup() {
  document.removeEventListener('mousedown', handleClickOutside);
}

onUnmounted(cleanup);
</script>

<template>
  <div class="relative inline-block">
    <button
      type="button"
      :aria-label="label"
      :title="label"
      class="inline-flex items-center justify-center p-1.5 rounded-lg text-(--color-text-secondary) hover:text-(--color-text-primary) hover:bg-(--color-bg-muted) transition-all duration-150"
      @click="onTriggerClick"
    >
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="5" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="12" cy="19" r="2" />
      </svg>
    </button>
    <div
      v-if="open"
      ref="panel"
      class="absolute top-full mt-1 z-50 min-w-[160px] bg-(--color-bg-surface) border border-(--color-border) rounded-lg shadow-dropdown py-1 overflow-hidden"
      :class="align === 'right' ? 'right-0' : 'left-0'"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
