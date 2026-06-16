<script setup lang="ts">
import { ref } from 'vue';
import type { CachedTopic } from '@/lib/types';
import { buildSummaryExport, downloadJson, safeFilename } from '@/lib/exporter';
import IconButton from './IconButton.vue';

const props = defineProps<{
  topic: CachedTopic;
  jsonData?: unknown;
  jsonFilename?: string;
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
    `> **Tổng số trang:** ${t.totalPages}`,
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

function downloadJsonExport() {
  const payload = props.jsonData ?? buildSummaryExport(props.topic);
  const filename = props.jsonFilename ?? `${safeFilename(props.topic.title)}_summary.json`;
  downloadJson(payload, filename);
  showToast('Đã tải file JSON!');
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
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions,vue/valid-v-on -- intentional interactive container -->
  <div class="relative" @keydown.escape.window="showDropdown = false">
    <IconButton label="Xuất kết quả" @click="showDropdown = !showDropdown">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    </IconButton>

    <div
      v-if="showDropdown"
      class="absolute right-0 top-full mt-1 bg-(--color-bg-surface) border border-(--color-border) rounded-xl shadow-dropdown z-10 min-w-max p-1"
    >
      <button
        class="w-full text-left px-3 py-2 text-sm text-(--color-text-primary) hover:bg-(--color-accent-soft) rounded-lg flex items-center gap-2 transition-colors"
        @click="downloadMd"
      >
        <svg class="w-4 h-4 text-(--color-text-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Tải file .md
      </button>
      <button
        class="w-full text-left px-3 py-2 text-sm text-(--color-text-primary) hover:bg-(--color-accent-soft) rounded-lg flex items-center gap-2 transition-colors"
        @click="downloadJsonExport"
      >
        <svg class="w-4 h-4 text-(--color-text-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Tải JSON tóm tắt
      </button>
    </div>

    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions,vuejs-accessibility/click-events-have-key-events -- intentional interactive container -->
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
        class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-(--color-text-primary) text-(--color-bg-base) text-sm px-4 py-2 rounded-lg shadow-elevated z-50"
      >
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>
