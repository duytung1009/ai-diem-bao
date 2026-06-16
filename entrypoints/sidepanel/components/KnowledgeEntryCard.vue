<script setup lang="ts">
import { getTagClass } from '@/lib/tag-styles';
import IconButton from './IconButton.vue';

export interface KnowledgeCardEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  category?: string;
  sourceAuthor: string;
  sourcePostNumber?: number;
  sourceTimestamp?: string;
  saved?: boolean;
  pinned?: boolean;
  mergedCount?: number;
  sourcesCount?: number;
  topicRefsCount?: number;
  postUrl?: string;
}

const props = withDefaults(defineProps<{
  entry: KnowledgeCardEntry;
  expanded: boolean;
  showSave?: boolean;
  showDelete?: boolean;
  showPin?: boolean;
  showCategory?: boolean;
  showMergedInfo?: boolean;
  showPostLink?: boolean;
}>(), {
  showSave: false,
  showDelete: false,
  showPin: false,
  showCategory: false,
  showMergedInfo: false,
  showPostLink: false,
});

const emit = defineEmits<{
  'toggle-expand': [id: string];
  'toggle-save': [id: string];
  'toggle-pin': [id: string];
  'delete': [id: string];
}>();

function formatTimestamp(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function handlePostClick(postNumber: number) {
  const base = (props.entry.postUrl ?? '').replace(/\/$/, '');
  browser.tabs.create({ url: `${base}/post-${postNumber}` });
}
</script>

<template>
  <div class="card">
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions,vuejs-accessibility/click-events-have-key-events -- intentional interactive container -->
    <div class="flex items-center gap-2 cursor-pointer" @click="emit('toggle-expand', entry.id)">
      <IconButton :label="expanded ? 'Thu gọn' : 'Mở rộng'" @click.stop="emit('toggle-expand', entry.id)">
        <svg class="w-3.5 h-3.5 mt-0.5 shrink-0 transition-transform duration-200 text-(--color-text-muted)"
          :class="expanded ? 'rotate-90' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </IconButton>
      <p class="text-sm font-semibold text-(--color-text-primary) flex-1 leading-snug">{{ entry.title }}</p>
      <IconButton v-if="showSave" :label="entry.saved ? 'Bỏ lưu' : 'Lưu'" :variant="entry.saved ? 'saved' : 'default'" @click.stop="emit('toggle-save', entry.id)">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </IconButton>
      <IconButton v-if="showPin" label="Ghim" :variant="entry.pinned ? 'saved' : 'default'" :disabled="entry.pinned" @click.stop="emit('toggle-pin', entry.id)">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </IconButton>
      <IconButton v-if="showDelete" label="Xoá" variant="danger" @click.stop="emit('delete', entry.id)">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </IconButton>
    </div>

    <div class="grid transition-[grid-template-rows] duration-200 ease-in-out"
      :class="expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
      <div class="overflow-hidden">
        <div class="pt-2 space-y-2">
          <p class="text-xs text-(--color-text-secondary) leading-relaxed">{{ entry.content }}</p>
          <div v-if="entry.tags.length > 0" class="flex flex-wrap gap-1">
            <span v-for="tag in entry.tags" :key="tag" class="badge text-xs capitalize" :class="getTagClass(tag)">
              {{ tag }}
            </span>
            <span v-if="showCategory && entry.category" class="badge badge-accent text-xs">{{ entry.category }}</span>
          </div>
          <div v-if="showMergedInfo && (entry.mergedCount || (entry.sourcesCount && entry.sourcesCount > 1))" class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-(--color-text-secondary)">
            <span v-if="entry.mergedCount">Đã gộp {{ entry.mergedCount }} lần</span>
            <span v-if="entry.sourcesCount && entry.sourcesCount > 1">{{ entry.sourcesCount }} nguồn &middot; {{ entry.topicRefsCount }} thớt</span>
          </div>
          <p v-if="entry.sourceAuthor" class="text-xs text-(--color-text-secondary)">
            {{ entry.sourceAuthor }}<template v-if="entry.sourcePostNumber"> · bài <button v-if="showPostLink" class="font-mono link"
                @click="handlePostClick(entry.sourcePostNumber)">#{{ entry.sourcePostNumber }}</button><span v-else class="font-mono">#{{ entry.sourcePostNumber }}</span></template><span
              v-if="entry.sourceTimestamp"> · {{ formatTimestamp(entry.sourceTimestamp) }}</span>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
