<script setup lang="ts">
import type { CostEstimate } from '@/lib/types';
import { formatNumber } from '@/lib/format';
import { formatEstimatedTime } from '@/lib/format';

const props = withDefaults(defineProps<{
  title: string;
  estimate: CostEstimate;
  warning?: string;
  confirmText?: string;
  cancelText?: string;
  dangerConfirmText?: string;
}>(), {
  confirmText: 'Tiếp tục',
  cancelText: 'Hủy',
});

const emit = defineEmits<{
  confirm: [];
  cancel: [];
  dangerConfirm: [];
}>();
</script>

<template>
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-40 bg-black/30"
    @click="emit('cancel')"
  />

  <!-- Bottom sheet -->
  <div class="fixed bottom-0 left-0 right-0 z-50 bg-(--color-bg-base) border-t border-(--color-border) rounded-t-xl shadow-xl p-4 space-y-4 animate-slide-up">
    <!-- Title -->
    <h3 class="text-sm font-semibold text-(--color-text-primary)">{{ title }}</h3>

    <!-- Estimate breakdown -->
    <div class="space-y-1.5">
      <p class="text-xs text-(--color-text-muted) font-medium uppercase tracking-wide mb-2">Ước tính cho thao tác này</p>
      <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span class="text-(--color-text-secondary)">API calls</span>
        <span class="text-(--color-text-primary) font-mono">~{{ formatNumber(estimate.apiCalls) }}</span>

        <span class="text-(--color-text-secondary)">Token input</span>
        <span class="text-(--color-text-primary) font-mono">~{{ formatNumber(estimate.inputTokens) }}</span>

        <span class="text-(--color-text-secondary)">Token output</span>
        <span class="text-(--color-text-primary) font-mono">~{{ formatNumber(estimate.outputTokens) }}</span>

        <span class="text-(--color-text-secondary)">Thời gian</span>
        <span class="text-(--color-text-primary) font-mono">{{ formatEstimatedTime(estimate.estimatedMs) }}</span>

        <template v-if="estimate.costUsd !== null">
          <span class="text-(--color-text-secondary)">Chi phí</span>
          <span class="text-(--color-text-primary) font-mono">
            {{ estimate.costUsd === 0 ? 'Miễn phí' : `~$${estimate.costUsd.toFixed(4)}` }}
          </span>
        </template>
      </div>
    </div>

    <!-- Warning line -->
    <div v-if="warning" class="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
      <svg class="w-3.5 h-3.5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
      </svg>
      <span>{{ warning }}</span>
    </div>

    <!-- Actions -->
    <div class="flex gap-2">
      <button class="btn btn-sm btn-secondary flex-1" @click="emit('cancel')">
        {{ cancelText }}
      </button>
      <button v-if="dangerConfirmText" class="btn btn-sm btn-danger flex-1" @click="emit('dangerConfirm')">
        {{ dangerConfirmText }}
      </button>
      <button class="btn btn-sm btn-primary flex-1" @click="emit('confirm')">
        {{ confirmText }}
      </button>
    </div>
  </div>
</template>

<style scoped>
@keyframes slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
.animate-slide-up {
  animation: slide-up 200ms ease-out;
}
</style>
