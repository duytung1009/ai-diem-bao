<!-- @deprecated Use StepTimeline.vue instead for new pipeline-based loading display -->
<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { formatNumber } from '@/lib/format';
import { useLLM } from '../composables/useLLM';

const MSG_ALMOST_DONE = "Sắp xong...";
const props = defineProps<{
  taskId?: string | null;
  scrapeProgress?: { currentPage: number; totalPages: number; postsScraped: number } | null;
  scrapeDelayMs?: number;
  message?: string;
  fallbackMessage?: string;
  showCancel?: boolean;
}>();

defineEmits<{ cancel: [] }>();

const { getTaskState } = useLLM();

const task = computed(() => (props.taskId ? getTaskState(props.taskId) : undefined));

// Tick every second to update elapsed/ETA display
const now = ref(Date.now());
watchEffect((onCleanup) => {
  if (task.value?.status === 'running') {
    const timer = setInterval(() => { now.value = Date.now(); }, 1000);
    onCleanup(() => clearInterval(timer));
  }
});

// PAGE_LOAD_MS: estimated fetch + parse time per scraping page
const PAGE_LOAD_MS = 500;

// --- LLM mode ---
const llmProgressPercent = computed(() => {
  const p = task.value?.progress;
  if (!p) return null;
  if (p.totalSteps >= 2) {
    // Map-reduce: step-based progress
    return Math.min(100, Math.round((p.step / p.totalSteps) * 100));
  }
  // Single-pass: fake ETA-based progress, capped at 95%
  const t = task.value!;
  if (!t.estimatedTotalMs) return null;
  return Math.min(95, Math.round((t.elapsedMs / t.estimatedTotalMs) * 100));
});

const llmEta = computed(() => {
  const t = task.value;
  if (!t || !t.estimatedTotalMs) return null;
  const remaining = Math.max(0, t.estimatedTotalMs - t.elapsedMs);
  if (remaining < 5000) return MSG_ALMOST_DONE;
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return mins > 0 ? `~${mins} phút ${secs}s` : `~${secs}s`;
});

// --- Scraping mode ---
const scrapeProgressPercent = computed(() => {
  const p = props.scrapeProgress;
  if (!p || p.totalPages <= 0) return null;
  return Math.min(100, Math.round((p.currentPage / p.totalPages) * 100));
});

const scrapeEta = computed(() => {
  const p = props.scrapeProgress;
  if (!p || p.totalPages <= 1) return null;
  const remainingPages = p.totalPages - p.currentPage;
  if (remainingPages <= 0) return null;
  const msPerPage = (props.scrapeDelayMs ?? 2000) + PAGE_LOAD_MS;
  const remainingMs = remainingPages * msPerPage;
  if (remainingMs < 5000) return MSG_ALMOST_DONE;
  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  return mins > 0 ? `~${mins} phút ${secs}s` : `~${secs}s`;
});

// --- Merged outputs ---
const progressPercent = computed(() => {
  if (props.scrapeProgress) return scrapeProgressPercent.value;
  if (props.taskId) return llmProgressPercent.value;
  return null;
});

const etaDisplay = computed(() => {
  if (props.scrapeProgress) return scrapeEta.value;
  if (props.taskId) return llmEta.value;
  return null;
});

const displayMessage = computed(() => {
  // Explicit message (e.g. "Đang tóm tắt phần X...") wins over scrape default,
  // so that during the LLM phase of an overall-progress run we can keep the
  // page-progress bar while showing the current stage text.
  if (props.message) return props.message;
  if (props.scrapeProgress) {
    const p = props.scrapeProgress;
    return `Đang đọc trang ${formatNumber(p.currentPage)}/${formatNumber(p.totalPages)} (${formatNumber(p.postsScraped)} bài)...`;
  }
  return task.value?.progress?.message || props.fallbackMessage || 'Đang xử lý...';
});
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

    <!-- Progress bar -->
    <div v-if="progressPercent !== null" class="w-full bg-(--color-bg-tertiary) rounded-full h-1.5">
      <div
        class="bg-(--color-primary) h-1.5 rounded-full transition-all duration-500"
        :style="{ width: progressPercent + '%' }"
      />
    </div>

    <!-- ETA -->
    <p v-if="etaDisplay" class="text-xs text-(--color-text-muted)">{{ etaDisplay === MSG_ALMOST_DONE ? etaDisplay : `Ước tính còn ${etaDisplay}` }}</p>

    <!-- Cancel button -->
    <button
      v-if="showCancel"
      class="w-full btn btn-sm btn-secondary"
      @click="$emit('cancel')"
    >
      Huỷ
    </button>
  </div>
</template>
