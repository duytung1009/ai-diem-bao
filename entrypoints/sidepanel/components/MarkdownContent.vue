<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const props = defineProps<{
  content: string;
}>();

marked.setOptions({
  breaks: true,
  gfm: true,
});

const html = computed(() => DOMPurify.sanitize(marked.parse(props.content) as string));
</script>

<template>
  <div class="space-y-3">
    <div class="prose prose-sm max-w-none dark:prose-invert" v-html="html" />
  </div>
</template>
