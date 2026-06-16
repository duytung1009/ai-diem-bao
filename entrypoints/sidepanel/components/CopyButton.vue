<script setup lang="ts">
import { ref } from 'vue';
import IconButton from './IconButton.vue';

const props = defineProps<{
  content?: string;
}>();

const showDropdown = ref(false);
const toast = ref<string | null>(null);

function showToast(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = null), 2000);
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Đã copy!');
  } catch {
    prompt('Copy nội dung bên dưới:', text);
  }
  showDropdown.value = false;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/>\s+/g, '')
    .replace(/---/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function copyMarkdown() {
  copy(props.content ?? '');
}

function copyPlainText() {
  copy(stripMarkdown(props.content ?? ''));
}
</script>

<template>
  <div class="relative">
    <IconButton label="Sao chép" @click="showDropdown = !showDropdown">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    </IconButton>

    <div
      v-if="showDropdown"
      class="absolute right-0 top-full mt-1 bg-(--color-bg-surface) border border-(--color-border) rounded-xl shadow-dropdown z-10 min-w-max p-1"
    >
      <button
        class="w-full text-left px-3 py-2 text-sm text-(--color-text-primary) hover:bg-(--color-accent-soft) rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap"
        @click="copyMarkdown"
      >
        <svg class="w-4 h-4 text-(--color-text-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        Sao chép Markdown
      </button>
      <button
        class="w-full text-left px-3 py-2 text-sm text-(--color-text-primary) hover:bg-(--color-accent-soft) rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap"
        @click="copyPlainText"
      >
        <svg class="w-4 h-4 text-(--color-text-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.293.707l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Sao chép văn bản
      </button>
    </div>

    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions,vuejs-accessibility/click-events-have-key-events -- backdrop -->
    <div
      v-if="showDropdown"
      class="fixed inset-0 z-0"
      @click="showDropdown = false"
    />

    <Transition
      enter-active-class="transition-all duration-200"
      enter-from-class="opacity-0 translate-y-1"
      leave-active-class="transition-all duration-200"
      leave-to-class="opacity-0 translate-y-1"
    >
      <div
        v-if="toast"
        class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-(--color-bg-elevated) border border-(--color-border) rounded-lg px-4 py-2 text-xs shadow-dropdown"
      >
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>
