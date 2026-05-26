<script setup lang="ts">
import type { PipelineDefinition } from '@/lib/types';

defineProps<{
  pipeline: PipelineDefinition;
  showCancel?: boolean;
}>();

defineEmits<{ cancel: [] }>();

function formatETA(ms: number): string {
  if (!ms || ms < 0) return '';
  if (ms < 5000) return 'Sắp xong...';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return mins > 0 ? `~${mins} phút ${secs}s` : `~${secs}s`;
}
</script>

<template>
  <div class="space-y-0">
    <div class="relative">
      <!-- Vertical line -->
      <div class="absolute left-2.75 top-3 bottom-3 w-0.5 bg-(--color-border) z-0" />

      <div
        v-for="(step, idx) in pipeline.steps"
        :key="step.id"
        class="relative flex items-start gap-3 py-2 pl-0"
      >
        <!-- Icon column -->
        <div class="relative z-10 shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-(--color-bg-surface)">
          <!-- Done -->
          <svg
            v-if="step.status === 'done'"
            class="w-5 h-5 text-(--color-success-text)"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>

          <!-- Running -->
          <svg
            v-else-if="step.status === 'running'"
            class="w-5 h-5 text-(--color-accent) animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>

          <!-- Error -->
          <svg
            v-else-if="step.status === 'error'"
            class="w-5 h-5 text-(--color-error-text)"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>

          <!-- Pending -->
          <div
            v-else
            class="w-3.5 h-3.5 rounded-full border-2 border-(--color-text-muted)"
          />
        </div>

        <!-- Content column -->
        <div class="flex-1 min-w-0 pt-0.5">
          <div class="flex items-center gap-2 flex-wrap">
            <span
              class="text-sm font-medium"
              :class="{
                'text-(--color-success-text)': step.status === 'done',
                'text-(--color-accent)': step.status === 'running',
                'text-(--color-error-text)': step.status === 'error',
                'text-(--color-text-muted)': step.status === 'pending',
                'animate-pulse': step.status === 'running',
              }"
            >
              {{ step.label }}
            </span>

            <span
              v-if="step.status === 'running' && step.etaMs != null && !Number.isNaN(step.etaMs) && step.etaMs >= 0"
              class="text-xs text-(--color-accent) bg-(--color-accent-soft) px-1.5 py-0.5 rounded"
            >
              {{ formatETA(step.etaMs) }}
            </span>
          </div>

          <p
            v-if="step.status === 'error' && step.error"
            class="text-xs text-(--color-error-text) mt-0.5"
          >
            {{ step.error }}
          </p>
        </div>
      </div>
    </div>

    <!-- Cancel button -->
    <button
      v-if="showCancel"
      class="mt-3 w-full btn btn-sm btn-secondary"
      @click="$emit('cancel')"
    >
      Huỷ
    </button>
  </div>
</template>
