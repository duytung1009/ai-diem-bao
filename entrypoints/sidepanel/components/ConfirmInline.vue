<script setup lang="ts">
defineProps<{
  message: string;
  warning?: string;
  confirmText?: string;
  cancelText?: string;
}>();

defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <div class="space-y-2">
    <p class="text-xs text-(--color-text-secondary)">{{ message }}</p>
    <p v-if="warning" class="text-xs text-amber-600 dark:text-amber-400">{{ warning }}</p>
    <div class="flex gap-2">
      <button class="flex-1 btn btn-primary text-xs" @click="$emit('confirm')">
        {{ confirmText ?? 'Xác nhận' }}
      </button>
      <button class="flex-1 btn btn-secondary text-xs" @click="$emit('cancel')">
        {{ cancelText ?? 'Hủy' }}
      </button>
    </div>
  </div>
</template>
