<script setup lang="ts">
import { computed } from 'vue';
import MarkdownContent from './MarkdownContent.vue';
import AccordionItem from './AccordionItem.vue';
import type { SummaryJSON } from '@/lib/types';

const props = defineProps<{
  content: string;
  json?: SummaryJSON;
}>();

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
</script>

<template>
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
                  — {{ q.author }} <span class="font-mono opacity-70">#{{ q.postNumber }}</span>
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
</template>
