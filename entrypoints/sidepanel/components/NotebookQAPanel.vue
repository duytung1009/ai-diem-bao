<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import type { NotebookEntry } from '@/lib/types';
import type { QAMessage, QAPendingConfirm } from '../composables/useNotebookQA';
import { parseAnswerHtml, citedEntries } from '@/lib/qa-parser';
import CostConfirmModal from './CostConfirmModal.vue';

const props = defineProps<{
  entries: NotebookEntry[];
  history: QAMessage[];
  isLoading: boolean;
  progressMessage: string;
  error: string;
  pendingConfirm: QAPendingConfirm | null;
}>();

const emit = defineEmits<{
  ask: [question: string];
  confirmAsk: [];
  cancelConfirm: [];
  cancelQA: [];
  citationClick: [entryId: string];
  saveAsNote: [question: string, answer: string, selectedEntryIds: string[], citedEntryIds?: string[]];
  clearHistory: [];
}>();

const questionInput = ref('');
const messagesEnd = ref<HTMLElement | null>(null);
const savedIds = ref<Set<string>>(new Set());

const isEmpty = computed(() => props.entries.length === 0);
const canAsk = computed(() => questionInput.value.trim().length > 0 && !isEmpty.value && !props.isLoading);

const entryMap = computed(() => {
  const m = new Map<string, NotebookEntry>();
  for (const e of props.entries) m.set(e.id, e);
  return m;
});

// Derive each assistant message's HTML + cited entries once here, instead of
// calling parseAnswerHtml/citedEntries inside the template v-for — those re-ran
// the regex + entry lookups on every render (e.g. each keystroke in the textarea),
// and citedEntries was invoked twice per message.
const renderedHistory = computed(() =>
  props.history.map((msg) => {
    if (msg.role !== 'assistant') return { msg, html: '', cited: [] as NotebookEntry[] };
    const ids = msg.selectedEntryIds ?? [];
    return { msg, html: parseAnswerHtml(msg.text, ids), cited: citedEntries(msg.text, ids, entryMap.value) };
  }),
);

async function submit() {
  if (!canAsk.value) return;
  emit('ask', questionInput.value.trim());
  questionInput.value = '';
  await nextTick();
  messagesEnd.value?.scrollIntoView({ behavior: 'smooth' });
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit();
}

function handleAnswerClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('[data-entry-id]') as HTMLElement | null;
  if (btn?.dataset.entryId) emit('citationClick', btn.dataset.entryId);
}

// Find the user question immediately preceding the assistant message at `assistantIdx`
function getPairedQuestion(assistantIdx: number): string {
  for (let i = assistantIdx - 1; i >= 0; i--) {
    if (props.history[i].role === 'user') return props.history[i].text;
  }
  return '';
}

function saveAsNote(msg: QAMessage, idx: number) {
  savedIds.value = new Set([...savedIds.value, msg.id]);
  emit('saveAsNote', getPairedQuestion(idx), msg.text, msg.selectedEntryIds ?? [], msg.usedEntryIds);
}
</script>

<template>
  <div class="flex flex-col gap-3 flex-1 min-h-0">
    <!-- Header: Clear history -->
    <div v-if="history.length > 0" class="flex justify-end">
      <button class="btn btn-ghost btn-sm text-xs" @click="emit('clearHistory')">
        Xóa lịch sử
      </button>
    </div>

    <!-- Conversation area — flex-1 fills available height -->
    <div class="flex-1 min-h-0 flex flex-col gap-3">
      <!-- Empty state -->
      <div v-if="isEmpty" class="text-center py-6 text-xs text-(--color-text-muted)">
        <p>Kho kiến thức trống. Hãy trích xuất kiến thức từ ít nhất một thớt.</p>
      </div>

      <!-- Conversation history (chronological: oldest first → newest at bottom) -->
      <div
        v-for="(item, idx) in renderedHistory"
        :key="item.msg.id"
      >
        <!-- User message -->
        <div v-if="item.msg.role === 'user'" class="flex justify-end">
          <div class="bg-(--color-bg-muted) rounded-lg px-3 py-2 max-w-[85%] text-sm text-(--color-text-primary)">
            {{ item.msg.text }}
          </div>
        </div>

        <!-- Assistant message -->
        <div v-else class="space-y-2">
          <div
            class="text-sm text-(--color-text-secondary) leading-relaxed"
            v-html="item.html"
            @click="handleAnswerClick"
          ></div>

          <!-- Cited entries (derived from [n] in text) -->
          <div v-if="item.cited.length > 0" class="space-y-0.5">
            <p class="text-xs text-(--color-text-muted) font-medium">Nguồn:</p>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="entry in item.cited"
                :key="entry.id"
                class="badge badge-neutral text-xs hover:badge-accent transition-colors"
                @click="emit('citationClick', entry.id)"
              >
                {{ entry.title }}
              </button>
            </div>
          </div>

          <div>
            <!-- Save as note -->
            <button
              class="btn btn-ghost btn-sm text-xs"
              :disabled="savedIds.has(item.msg.id)"
              @click="saveAsNote(item.msg, idx)"
            >
              {{ savedIds.has(item.msg.id) ? '✓ Đã lưu' : 'Lưu thành ghi chú' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Progress (inline, after last message) -->
      <div v-if="isLoading" class="text-xs text-(--color-text-muted) italic">
        {{ progressMessage || 'Đang tra cứu...' }}
      </div>

      <!-- Error -->
      <div v-if="error" class="alert alert-error text-xs">{{ error }}</div>

      <!-- Scroll anchor -->
      <div ref="messagesEnd" />
    </div>

    <!-- Input area — always at bottom -->
    <div class="space-y-2 pt-1">
      <textarea
        v-model="questionInput"
        class="input text-xs w-full resize-none"
        rows="3"
        placeholder="Đặt câu hỏi về kho kiến thức... (Ctrl+Enter để gửi)"
        :disabled="isEmpty || isLoading"
        @keydown="handleKeydown"
      ></textarea>
      <template v-if="!isLoading">
        <button class="btn-llm" :disabled="!canAsk" @click="submit">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
          </svg>
          Hỏi đáp
        </button>
      </template>
      <template v-else>
        <button
          class="w-full btn btn-sm btn-secondary text-xs"
          @click="emit('cancelQA')"
        >
          Hủy
        </button>
      </template>
    </div>
  </div>

  <CostConfirmModal
    v-if="pendingConfirm"
    title="Xác nhận tra cứu"
    :message="`Sổ tay có nhiều ghi chú. Câu hỏi này sẽ dùng ${pendingConfirm.callEstimate} API call để tìm kiếm và trả lời.`"
    @confirm="emit('confirmAsk')"
    @cancel="emit('cancelConfirm')"
  />
</template>
