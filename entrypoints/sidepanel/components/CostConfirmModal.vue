<script setup lang="ts">
import type { CostEstimate } from '@/lib/types';
import { formatNumber } from '@/lib/format';
import { formatEstimatedTime } from '@/lib/format';

const props = withDefaults(defineProps<{
  title: string;
  estimate?: CostEstimate;
  message?: string;
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
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions,vuejs-accessibility/click-events-have-key-events -- intentional interactive container -->
  <div
    class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
    @click="emit('cancel')"
  />
  <div class="fixed bottom-0 left-0 right-0 z-50 bg-(--color-bg-surface) rounded-t-xl shadow-elevated p-5 space-y-5 animate-slide-up">
    <div class="flex items-center justify-between">
      <h3 class="font-heading text-sm font-semibold text-(--color-text-primary)">{{ title }}</h3>
      <button class="btn btn-ghost btn-sm" @click="emit('cancel')">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div v-if="message" class="py-1">
      <p class="text-sm text-(--color-text-secondary)">{{ message }}</p>
    </div>
    <div v-else-if="estimate" class="card-flat space-y-2">
      <p class="section-heading">Ước tính thao tác</p>
      <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <span class="text-(--color-text-secondary)">API calls</span>
        <span class="text-(--color-text-primary) font-mono font-medium">~{{ formatNumber(estimate.apiCalls) }}</span>

        <span class="text-(--color-text-secondary)">Token input</span>
        <span class="text-(--color-text-primary) font-mono font-medium">~{{ formatNumber(estimate.inputTokens) }}</span>

        <span class="text-(--color-text-secondary)">Token output</span>
        <span class="text-(--color-text-primary) font-mono font-medium">~{{ formatNumber(estimate.outputTokens) }}</span>

        <span class="text-(--color-text-secondary)">Thời gian</span>
        <span class="text-(--color-text-primary) font-mono font-medium">{{ formatEstimatedTime(estimate.estimatedMs) }}</span>

        <template v-if="estimate.costUsd !== null">
          <span class="text-(--color-text-secondary)">Chi phí</span>
          <span class="text-(--color-text-primary) font-mono font-medium">
            {{ estimate.costUsd === 0 ? 'Miễn phí' : `~$${estimate.costUsd.toFixed(4)}` }}
          </span>
        </template>
      </div>
    </div>

    <div v-if="warning" class="alert-warning alert flex items-start gap-2">
      <svg class="w-4 h-4 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
      </svg>
      <span>{{ warning }}</span>
    </div>

    <div class="flex gap-2">
      <button class="btn btn-sm btn-secondary flex-1" @click="emit('cancel')">
        {{ cancelText }}
      </button>
      <button v-if="dangerConfirmText" class="btn btn-sm btn-danger flex-1" @click="emit('dangerConfirm')">
        {{ dangerConfirmText }}
      </button>
      <button v-else class="btn btn-sm btn-primary flex-1" @click="emit('confirm')">
        {{ confirmText }}
      </button>
    </div>
  </div>
</template>
