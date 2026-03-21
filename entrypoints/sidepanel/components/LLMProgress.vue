<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { useLLM } from '../composables/useLLM';

const props = defineProps<{
  taskId: string;
  fallbackMessage?: string;
}>();

const { getTaskState } = useLLM();

const task = computed(() => getTaskState(props.taskId));

// Tick every second to update elapsed/ETA display
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

watchEffect((onCleanup) => {
  if (task.value?.status === 'running') {
    timer = setInterval(() => { now.value = Date.now(); }, 1000);
    onCleanup(() => { if (timer) clearInterval(timer); });
  }
});

const progressPercent = computed(() => {
  const p = task.value?.progress;
  if (!p || p.totalSteps < 2) return null;
  return Math.min(100, Math.round((p.step / p.totalSteps) * 100));
});

const etaDisplay = computed(() => {
  const t = task.value;
  if (!t || !t.estimatedTotalMs) return null;
  const elapsed = t.elapsedMs > 0 ? t.elapsedMs : 0;
  const remaining = Math.max(0, t.estimatedTotalMs - elapsed);
  if (remaining < 5000) return 'Sắp xong...';
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return mins > 0 ? `~${mins} phút ${secs}s` : `~${secs}s`;
});

const displayMessage = computed(() =>
  task.value?.progress?.message || props.fallbackMessage || 'Đang xử lý...',
);
</script>

<template>
  <div class="space-y-2">
    <!-- Spinner + message -->
    <div class="flex items-center gap-2">
      <svg class="animate-spin h-4 w-4 text-(--color-primary) shrink-0" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <p class="text-sm text-(--color-text-secondary)">{{ displayMessage }}</p>
    </div>

    <!-- Progress bar — only shown during map-reduce (multiple steps) -->
    <div v-if="progressPercent !== null" class="w-full bg-(--color-bg-tertiary) rounded-full h-1.5">
      <div
        class="bg-(--color-primary) h-1.5 rounded-full transition-all duration-500"
        :style="{ width: progressPercent + '%' }"
      />
    </div>

    <!-- ETA -->
    <p v-if="etaDisplay" class="text-xs text-(--color-text-muted)">Ước tính còn {{ etaDisplay }}</p>
  </div>
</template>
