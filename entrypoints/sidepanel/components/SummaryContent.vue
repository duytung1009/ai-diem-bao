<script setup lang="ts">
import { ref, computed } from 'vue';
import MarkdownContent from './MarkdownContent.vue';
import AccordionItem from './AccordionItem.vue';
import type { SummaryJSON } from '@/lib/types';

const props = defineProps<{
  content: string;
  json?: SummaryJSON;
  topicUrl?: string;
  postPageMap?: Record<number, number>;
}>();

function openPostLink(postNumber: number) {
  if (!props.topicUrl) return;
  const page = props.postPageMap?.[postNumber];
  const base = props.topicUrl.replace(/\/$/, '');
  const pageSegment = page && page > 1 ? `/page-${page}` : '';
  browser.tabs.create({ url: `${base}${pageSegment}#post-${postNumber}` });
}

// --- Markdown fallback parse (backward compat for old cache entries) ---

interface Opinion { title: string; body: string; supporterCount: number | null }
interface Section { title: string; body: string; opinions?: Opinion[]; totalSupporters?: number; }

const sections = computed<Section[]>(() => {
  const raw = props.content;
  const parts = raw.split(/^## /m).filter((s) => s.trim());

  if (parts.length === 0) {
    return [{ title: '', body: raw }];
  }

  return parts.map((part) => {
    const [firstLine, ...rest] = part.split('\n');
    const title = firstLine.trim();
    const body = rest.join('\n').trim();

    const isOpinions = /quan\s*điểm/i.test(title);
    if (isOpinions) {
      const opinionParts = body.split(/^### /m).filter((s) => s.trim());
      if (opinionParts.length > 0) {
        const opinions = opinionParts.map((op) => {
          const [opTitle, ...opRest] = op.split('\n');
          const rawTitle = opTitle.trim();
          const countMatch = rawTitle.match(/\((\d+)\s*người[^)]*\)[.,:]?\s*$/);
          const supporterCount = countMatch ? parseInt(countMatch[1], 10) : null;
          const cleanTitle = countMatch
            ? rawTitle.replace(/\s*\(\d+\s*người[^)]*\)[.,:]?\s*$/, '').trim()
            : rawTitle;
          return { title: cleanTitle, body: opRest.join('\n').trim(), supporterCount };
        });
        const totalSupporters = opinions.reduce((sum, op) => sum + (op.supporterCount ?? 0), 0);
        return { title, body: '', opinions, totalSupporters };
      }
    }

    return { title, body };
  });
});

const isStructured = computed(() =>
  sections.value.length > 1 || sections.value[0]?.title !== '',
);

// Total supporters for JSON mode progress bars
const totalJsonSupporters = computed(() =>
  props.json?.opinions.reduce((s, o) => s + (o.supporters?.length ?? 0), 0) ?? 0,
);

// Copy
const copied = ref(false);

function formatSummaryAsText(): string {
  if (props.json) {
    const lines: string[] = [];
    lines.push('## Tóm tắt');
    lines.push(props.json.summary);
    lines.push('');
    if (props.json.opinions?.length) {
      lines.push('## Quan điểm nổi bật');
      for (const op of props.json.opinions) {
        lines.push(`### ${op.title}`);
        if (op.supporters?.length) lines.push(`Ủng hộ: ${op.supporters.join(', ')}`);
        lines.push(op.description);
        if (op.quotes?.length) {
          for (const q of op.quotes) {
            lines.push(`  > '${q.text}' — ${q.author} (#${q.postNumber})`);
          }
        }
        lines.push('');
      }
    }
    if (props.json.conclusion) {
      lines.push('## Kết luận');
      lines.push(props.json.conclusion);
    }
    return lines.join('\n');
  }
  return props.content;
}

async function handleCopy() {
  const text = formatSummaryAsText();
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    prompt('Copy nội dung bên dưới:', text);
  }
}
</script>

<template>
  <div class="space-y-5 text-sm">
    <!-- Actions row: slot bên trái, Copy bên phải -->
    <div class="flex items-center justify-between">
      <slot name="actions" />
      <button
        class="btn text-xs flex items-center gap-1.5"
        @click="handleCopy"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        {{ copied ? 'Đã copy!' : 'Copy' }}
      </button>
    </div>
    
    <div class="card p-4 space-y-4">
      <!-- JSON mode: render structured data directly (Feature 15) -->
      <div v-if="json" class="space-y-4">
        <div>
          <h3 class="text-sm font-semibold text-(--color-text-primary) mb-2">Tóm tắt</h3>
          <MarkdownContent :content="json.summary" />
        </div>

        <div v-if="json.opinions?.length">
          <h3 class="text-sm font-semibold text-(--color-text-primary) mb-2">Quan điểm nổi bật</h3>
          <div class="space-y-2">
            <AccordionItem v-for="(op, i) in json.opinions" :key="i">
              <template #title>
                <div class="w-full min-w-0">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-medium text-sm">{{ op.title }}</span>
                    <span
                      v-if="op.supporters?.length"
                      class="text-xs text-(--color-text-secondary) ml-2 shrink-0"
                    >
                      {{ op.supporters.length }} người
                    </span>
                  </div>
                  <div
                    v-if="op.supporters?.length && totalJsonSupporters > 0"
                    class="w-full h-1.5 bg-(--color-bg-muted) rounded-full overflow-hidden"
                  >
                    <div
                      class="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all duration-300"
                      :style="{ width: Math.round((op.supporters.length / totalJsonSupporters) * 100) + '%' }"
                    />
                  </div>
                </div>
              </template>
              <div class="space-y-3">
                <MarkdownContent :content="op.description" />
                <div v-if="op.quotes?.length" class="space-y-2 mt-1">
                  <blockquote
                    v-for="(q, qi) in op.quotes"
                    :key="qi"
                    class="border-l-2 border-(--color-border) pl-3 text-xs text-(--color-text-secondary)"
                  >
                    <p class="italic leading-relaxed">{{ q.text }}</p>
                    <cite class="not-italic text-xs text-(--color-text-muted) mt-0.5 block">
                      — {{ q.author }}
                      <button
                        v-if="topicUrl"
                        class="font-mono opacity-70 hover:opacity-100 hover:underline cursor-pointer"
                        @click="openPostLink(q.postNumber)"
                      >#{{ q.postNumber }}</button>
                      <span v-else class="font-mono opacity-70">#{{ q.postNumber }}</span>
                    </cite>
                  </blockquote>
                </div>
              </div>
            </AccordionItem>
          </div>
        </div>

        <div v-if="json.conclusion">
          <h3 class="text-sm font-semibold text-(--color-text-primary) mb-2">Kết luận</h3>
          <MarkdownContent :content="json.conclusion" />
        </div>
      </div>

      <!-- Markdown fallback mode (backward compat for old cache / custom prompts) -->
      <template v-else>
        <MarkdownContent v-if="!isStructured" :content="content" />

        <div v-else class="space-y-4">
          <div v-for="(section, i) in sections" :key="i">
            <h3
              v-if="section.title"
              class="text-sm font-semibold text-(--color-text-primary) mb-2"
            >
              {{ section.title }}
            </h3>

            <MarkdownContent
              v-if="!section.opinions && section.body"
              :content="section.body"
            />

            <div v-if="section.opinions" class="space-y-2">
              <AccordionItem
                v-for="(opinion, j) in section.opinions"
                :key="j"
              >
                <template #title>
                  <div class="w-full min-w-0">
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-medium text-sm">{{ opinion.title }}</span>
                      <span
                        v-if="opinion.supporterCount !== null"
                        class="text-xs text-(--color-text-secondary) ml-2 shrink-0"
                      >
                        {{ opinion.supporterCount }} người
                      </span>
                    </div>
                    <div
                      v-if="opinion.supporterCount !== null && section.totalSupporters"
                      class="w-full h-1.5 bg-(--color-bg-muted) rounded-full overflow-hidden"
                    >
                      <div
                        class="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all duration-300"
                        :style="{ width: Math.round((opinion.supporterCount / section.totalSupporters!) * 100) + '%' }"
                      />
                    </div>
                  </div>
                </template>
                <MarkdownContent :content="opinion.body" />
              </AccordionItem>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
