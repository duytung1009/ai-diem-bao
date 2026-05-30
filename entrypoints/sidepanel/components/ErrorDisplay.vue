<script setup lang="ts">
defineProps<{
  message: string;
  action?: 'retry' | 'settings' | 'none';
}>();

const emit = defineEmits<{
  retry: [];
  settings: [];
}>();
</script>

<template>
  <div class="alert alert-error space-y-3">
    <div class="flex items-start gap-2.5">
      <svg class="w-5 h-5 shrink-0 mt-0.5 text-(--color-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <p class="text-sm text-(--color-text-primary)">{{ message }}</p>
    </div>
    <div v-if="action !== 'none'" class="flex gap-2">
      <button
        v-if="!action || action === 'retry'"
        class="btn btn-sm flex-1"
        @click="emit('retry')"
      >
        Thử lại
      </button>
      <button
        v-if="!action || action === 'settings'"
        class="btn btn-sm flex-1"
        @click="emit('settings')"
      >
        Kiểm tra cài đặt
      </button>
    </div>
  </div>
</template>
