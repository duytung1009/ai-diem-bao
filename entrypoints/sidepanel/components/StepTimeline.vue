<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { PipelineDefinition, PipelineStep } from '@/lib/types';

const props = defineProps<{
  pipeline: PipelineDefinition;
  showCancel?: boolean;
}>();

defineEmits<{ cancel: [] }>();

const MAX_VISIBLE_DONE_BEFORE_RUNNING = 3;

type TimelineRow =
  | {
    kind: 'step';
    key: string;
    step: PipelineStep;
  }
  | {
    kind: 'ellipsis';
    key: string;
    hiddenCount: number;
  };

// Local ETA map: stepId → remaining ms (used for countdown display)
const localEta = ref<Map<string, number>>(new Map());

// Sync localEta when a step's etaMs or status changes
watch(
  () => props.pipeline.steps,
  (steps) => {
    for (const step of steps) {
      if (step.status === 'running' && step.etaMs != null) {
        // Only reset if the incoming value is larger (fresh ETA from background)
        const current = localEta.value.get(step.id);
        if (current == null || step.etaMs > current) {
          localEta.value.set(step.id, step.etaMs);
        }
      } else if (step.status !== 'running') {
        localEta.value.delete(step.id);
      }
    }
  },
  { deep: true, immediate: true },
);

// Countdown tick: decrement every 5s for all running steps
const timer = setInterval(() => {
  for (const [id, eta] of localEta.value.entries()) {
    const next = eta - 5000;
    if (next <= 0) {
      localEta.value.set(id, 0);
    } else {
      localEta.value.set(id, next);
    }
  }
}, 5000);

onUnmounted(() => clearInterval(timer));

function formatETA(ms: number): string {
  if (!ms || ms < 0) return '';
  if (ms < 5000) return 'Sắp xong...';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return mins > 0 ? `~${mins} phút ${secs}s` : `~${secs}s`;
}

const timelineRows = computed<TimelineRow[]>(() => {
  const steps = props.pipeline.steps;
  const runningIndex = steps.findIndex((step) => step.status === 'running');

  // Collapse only when all steps before running are done and count exceeds threshold.
  if (runningIndex <= 0) {
    return steps.map((step) => ({ kind: 'step', key: step.id, step }));
  }

  const stepsBeforeRunning = steps.slice(0, runningIndex);
  const allDoneBeforeRunning = stepsBeforeRunning.every((step) => step.status === 'done');

  if (!allDoneBeforeRunning || stepsBeforeRunning.length <= MAX_VISIBLE_DONE_BEFORE_RUNNING) {
    return steps.map((step) => ({ kind: 'step', key: step.id, step }));
  }

  const firstDone = stepsBeforeRunning[0]!;
  const lastDone = stepsBeforeRunning[stepsBeforeRunning.length - 1]!;
  const runningStep = steps[runningIndex]!;
  const hiddenCount = stepsBeforeRunning.length - 2;
  const rows: TimelineRow[] = [
    { kind: 'step', key: firstDone.id, step: firstDone },
    { kind: 'ellipsis', key: `ellipsis-${firstDone.id}-${lastDone.id}`, hiddenCount },
    { kind: 'step', key: lastDone.id, step: lastDone },
    { kind: 'step', key: runningStep.id, step: runningStep },
  ];

  for (const step of steps.slice(runningIndex + 1)) {
    rows.push({ kind: 'step', key: step.id, step });
  }

  return rows;
});
</script>

<template>
  <div class="space-y-0">
    <div class="relative">
      <!-- Vertical line -->
      <div class="absolute left-2.75 top-3 bottom-3 w-0.5 bg-(--color-border) z-0" />

      <div
        v-for="row in timelineRows"
        :key="row.key"
        class="relative flex items-start gap-3 py-2 pl-0"
      >
        <template v-if="row.kind === 'ellipsis'">
          <div class="relative z-10 shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-(--color-bg-surface)">
            <svg
              class="w-5 h-5 text-(--color-text-muted)"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="1.75" />
              <circle cx="12" cy="12" r="1.75" />
              <circle cx="19" cy="12" r="1.75" />
            </svg>
          </div>

          <div class="flex-1 min-w-0 pt-0.5">
            <span class="text-sm font-medium text-(--color-text-muted)">
              Ẩn {{ row.hiddenCount }} bước đã hoàn thành
            </span>
          </div>
        </template>

        <template v-else>
          <!-- Icon column -->
          <div class="relative z-10 shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-(--color-bg-surface)">
            <!-- Done -->
            <svg
              v-if="row.step.status === 'done'"
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
              v-else-if="row.step.status === 'running'"
              class="w-5 h-5 text-(--color-accent) animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>

            <!-- Error -->
            <svg
              v-else-if="row.step.status === 'error'"
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
                  'text-(--color-success-text)': row.step.status === 'done',
                  'text-(--color-accent)': row.step.status === 'running',
                  'text-(--color-error-text)': row.step.status === 'error',
                  'text-(--color-text-muted)': row.step.status === 'pending',
                  'animate-pulse': row.step.status === 'running',
                }"
              >
                {{ row.step.label }}
              </span>

              <span
                v-if="row.step.status === 'running' && localEta.has(row.step.id) && formatETA(localEta.get(row.step.id)!)"
                class="text-xs text-(--color-accent) bg-(--color-accent-soft) px-1.5 py-0.5 rounded"
              >
                {{ formatETA(localEta.get(row.step.id)!) }}
              </span>
            </div>

            <p
              v-if="row.step.status === 'error' && row.step.error"
              class="text-xs text-(--color-error-text) mt-0.5"
            >
              {{ row.step.error }}
            </p>
          </div>
        </template>
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
