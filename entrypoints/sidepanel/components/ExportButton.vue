<script setup lang="ts">
import { ref } from 'vue';
import type { CachedTopic } from '@/lib/types';

const props = defineProps<{
  topic: CachedTopic;
}>();

const showDropdown = ref(false);
const toast = ref<string | null>(null);

function showToast(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = null), 2000);
}

function buildMarkdown(): string {
  const t = props.topic;
  const date = new Date(t.cachedAt).toLocaleString('vi-VN');
  const lines: string[] = [
    `# ${t.title}`,
    ``,
    `> **URL:** ${t.url}`,
    `> **Ngày lưu:** ${date}`,
    `> **Model:** ${t.llmConfig.provider} / ${t.llmConfig.model}`,
    `> **Tổng bài viết:** ${t.totalPosts}`,
    ``,
    `---`,
    ``,
  ];
  if (t.summary) {
    lines.push(t.summary, ``);
  }
  if (t.opinions) {
    lines.push(`---`, ``, `## Phân tích Ý kiến`, ``, t.opinions, ``);
  }
  return lines.join('\n');
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

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(buildMarkdown());
    showToast('Đã sao chép Markdown!');
  } catch {
    showToast('Không thể sao chép. Thử lại sau.');
  }
  showDropdown.value = false;
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(stripMarkdown(buildMarkdown()));
    showToast('Đã sao chép văn bản!');
  } catch {
    showToast('Không thể sao chép. Thử lại sau.');
  }
  showDropdown.value = false;
}

function downloadMd() {
  const content = buildMarkdown();
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  // Sanitize filename — keep Unicode letters, digits, and whitespace
  const safeName = props.topic.title.replace(/[^\p{L}\p{N}\s]/gu, '').trim().slice(0, 60) || 'topic';
  a.href = url;
  a.download = `${safeName}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
  showToast('Đã tải file!');
  showDropdown.value = false;
}
</script>

<template>
  <div class="relative" @keydown.escape.window="showDropdown = false">
    <!-- Trigger button -->
    <button
      class="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
      title="Xuất kết quả"
      @click="showDropdown = !showDropdown"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
      Xuất
    </button>

    <!-- Dropdown -->
    <div
      v-if="showDropdown"
      class="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-max"
    >
      <button
        class="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
        @click="copyMarkdown"
      >
        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        Sao chép Markdown
      </button>
      <button
        class="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
        @click="copyText"
      >
        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Sao chép văn bản
      </button>
      <button
        class="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
        @click="downloadMd"
      >
        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Tải file .md
      </button>
    </div>

    <!-- Click-outside overlay -->
    <div
      v-if="showDropdown"
      class="fixed inset-0 z-0"
      @click="showDropdown = false"
    />

    <!-- Toast notification -->
    <Transition
      enter-active-class="transition-all duration-200"
      enter-from-class="opacity-0 translate-y-1"
      leave-active-class="transition-all duration-200"
      leave-to-class="opacity-0 translate-y-1"
    >
      <div
        v-if="toast"
        class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50"
      >
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>
