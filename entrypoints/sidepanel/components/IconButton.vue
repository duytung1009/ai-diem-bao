<script setup lang="ts">
withDefaults(defineProps<{
  label: string;
  variant?: 'default' | 'saved' | 'danger';
  active?: boolean;
  disabled?: boolean;
}>(), {
  variant: 'default',
  active: false,
  disabled: false,
});

const emit = defineEmits<{
  click: [e: MouseEvent];
}>();
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :title="label"
    :disabled="disabled"
    class="inline-flex items-center justify-center p-1.5 rounded-lg transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
    :class="[
      variant === 'default' && !active && 'text-(--color-text-secondary) hover:text-(--color-text-primary) hover:bg-(--color-bg-muted)',
      variant === 'default' && active && 'text-(--color-accent-text) bg-(--color-accent-soft)',
      variant === 'saved' && 'text-(--color-saved) hover:text-(--color-saved-hover) hover:bg-(--color-bg-muted)',
      variant === 'danger' && 'text-(--color-error-text) hover:bg-(--color-error-bg)',
      active && variant === 'saved' && 'text-(--color-saved)',
    ]"
    @click="emit('click', $event)"
  >
    <slot />
  </button>
</template>
