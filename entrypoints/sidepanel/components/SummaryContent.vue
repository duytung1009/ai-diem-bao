<script setup lang="ts">
import { computed } from 'vue';
import MarkdownContent from './MarkdownContent.vue';
import AccordionItem from './AccordionItem.vue';

const props = defineProps<{
  content: string;
}>();

interface Section {
  title: string;
  body: string;
  opinions?: { title: string; body: string; supporterCount: number | null }[];
  totalSupporters?: number;
}

const sections = computed<Section[]>(() => {
  const raw = props.content;
  // Split by ## headers
  const parts = raw.split(/^## /m).filter((s) => s.trim());

  if (parts.length === 0) {
    // No structured headers — fallback to single section
    return [{ title: '', body: raw }];
  }

  return parts.map((part) => {
    const [firstLine, ...rest] = part.split('\n');
    const title = firstLine.trim();
    const body = rest.join('\n').trim();

    // Check if this is the opinions section
    const isOpinions = /quan\s*điểm/i.test(title);
    if (isOpinions) {
      const opinionParts = body.split(/^### /m).filter((s) => s.trim());
      if (opinionParts.length > 0) {
        const opinions = opinionParts.map((op) => {
          const [opTitle, ...opRest] = op.split('\n');
          const rawTitle = opTitle.trim();
          // Parse "(N người)" or "(N người ủng hộ)" from title
          const countMatch = rawTitle.match(/\((\d+)\s*người[^)]*\)[.,:]?\s*$/);
          const supporterCount = countMatch ? parseInt(countMatch[1], 10) : null;
          const cleanTitle = countMatch
            ? rawTitle.replace(/\s*\(\d+\s*người[^)]*\)[.,:]?\s*$/, '').trim()
            : rawTitle;
          return {
            title: cleanTitle,
            body: opRest.join('\n').trim(),
            supporterCount,
          };
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
</script>

<template>
  <!-- Fallback: unstructured content -->
  <MarkdownContent v-if="!isStructured" :content="content" />

  <!-- Structured sections -->
  <div v-else class="space-y-4">
    <div v-for="(section, i) in sections" :key="i">
      <h3
        v-if="section.title"
        class="text-sm font-semibold text-(--color-text-primary) mb-2"
      >
        {{ section.title }}
      </h3>

      <!-- Regular section -->
      <MarkdownContent
        v-if="!section.opinions && section.body"
        :content="section.body"
      />

      <!-- Opinions accordion -->
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
