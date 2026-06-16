<script setup lang="ts">
withDefaults(defineProps<{
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
}>(), {
  message: 'Bạn chắc chắn muốn thực hiện hành động này?',
  confirmLabel: 'Xác nhận',
  cancelLabel: 'Huỷ',
  variant: 'danger',
});

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <div class="inline-flex items-center gap-2">
    <span class="text-xs text-(--color-text-secondary)">{{ message }}</span>
    <button
      type="button"
      class="btn btn-sm"
      :class="variant === 'danger' ? 'btn-danger' : 'btn-primary'"
      @click="emit('confirm')"
    >
      {{ confirmLabel }}
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      @click="emit('cancel')"
    >
      {{ cancelLabel }}
    </button>
  </div>
</template>
