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
  opinions?: { title: string; body: string }[];
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
          return {
            title: opTitle.trim(),
            body: opRest.join('\n').trim(),
          };
        });
        return { title, body: '', opinions };
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
        class="text-sm font-semibold text-gray-900 mb-2"
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
          :title="opinion.title"
        >
          <MarkdownContent :content="opinion.body" />
        </AccordionItem>
      </div>
    </div>
  </div>
</template>
