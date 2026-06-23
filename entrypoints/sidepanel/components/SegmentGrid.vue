<script setup lang="ts">
import { computed, useSlots } from 'vue';
import IconButton from './IconButton.vue';
import type { SegmentStatus } from '@/lib/segment-grid-status';

export type { SegmentStatus };

export interface SegmentGridItem {
  index: number;
  label: string;
  meta?: string;
  status: SegmentStatus;
}

const props = withDefaults(defineProps<{
  /** Đoạn đã chuẩn hoá — view tự map từ domain (knowledgeSegments / segmentSummaries). */
  items: SegmentGridItem[];
  /** Text đếm ở header, vd "3 / 8 đoạn đã tóm tắt". View tự build vì wording khác nhau. */
  headerLabel: string;
  /** % progress bar (0–100). */
  progressPercent: number;
  /** Đóng/mở toàn lưới (v-model). */
  expanded?: boolean;
  /** Đoạn đang mở preview (v-model:expandedIndex). Chỉ dùng khi có slot #preview. */
  expandedIndex?: number | null;
  /** Mỗi row có click mở preview không. False → row không tương tác (vd SummaryView). */
  expandable?: boolean;
}>(), {
  expanded: false,
  expandedIndex: null,
  expandable: true,
});

const emit = defineEmits<{
  'update:expanded': [value: boolean];
  'update:expandedIndex': [value: number | null];
}>();

const slots = useSlots();

// Row chỉ tương tác khi cho phép expand VÀ có nội dung preview để hiện.
const interactive = computed(() => props.expandable && !!slots.preview);

function toggleExpanded() {
  emit('update:expanded', !props.expanded);
}

function onRowClick(item: SegmentGridItem) {
  if (!interactive.value) return;
  emit('update:expandedIndex', props.expandedIndex === item.index ? null : item.index);
}
</script>

<template>
  <div class="card space-y-2">
    <!-- Header: count + batch actions + toggle -->
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold text-(--color-text-secondary)">
        {{ headerLabel }}
      </span>
      <div class="flex items-center gap-3">
        <slot name="header-actions" />
        <IconButton :label="expanded ? 'Thu gọn' : 'Mở rộng'" @click="toggleExpanded">
          <svg class="w-4 h-4 text-(--color-text-secondary) transition-transform duration-200" :class="{ 'rotate-180': expanded }"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </IconButton>
      </div>
    </div>

    <!-- Progress bar -->
    <div class="h-1.5 rounded-full bg-(--color-bg-muted) overflow-hidden">
      <div class="h-full rounded-full bg-(--color-accent) transition-all duration-300" :style="{ width: progressPercent + '%' }" />
    </div>

    <!-- Rows -->
    <div v-if="expanded" class="space-y-1">
      <template v-for="item in items" :key="item.index">
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions,vuejs-accessibility/click-events-have-key-events -- intentional interactive container; keyboard reaches the row actions/button inside -->
        <div class="flex items-center gap-2 py-1.5 px-2 rounded-lg transition-colors"
          :class="[
            interactive ? 'cursor-pointer hover:bg-(--color-bg-muted)' : '',
            expandedIndex === item.index ? 'bg-(--color-accent-soft)' : '',
          ]"
          @click="onRowClick(item)">
          <!-- Status icon -->
          <div class="shrink-0 w-4 flex justify-center text-sm leading-none">
            <svg v-if="item.status === 'done'" class="w-3.5 h-3.5 text-(--color-success-text)" fill="none" viewBox="0 0 24 24" stroke="currentColor"
              stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <svg v-else-if="item.status === 'running'" class="w-3.5 h-3.5 animate-spin text-(--color-accent)" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <svg v-else-if="item.status === 'error'" class="w-3.5 h-3.5 text-(--color-error-text)" fill="none" viewBox="0 0 24 24" stroke="currentColor"
              stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <template v-else-if="item.status === 'partial'">⚠️</template>
            <template v-else>○</template>
          </div>

          <!-- Label + meta -->
          <span class="flex-1 text-xs text-(--color-text-primary)">
            {{ item.label }}
            <span v-if="item.meta" class="text-(--color-text-muted)">{{ item.meta }}</span>
          </span>

          <!-- Per-row actions (parent uses @click.stop so row toggle isn't triggered) -->
          <slot name="row-actions" :item="item" />
        </div>

        <!-- Expanded preview -->
        <div v-if="expandedIndex === item.index && slots.preview" class="ml-6 mb-1 space-y-1">
          <slot name="preview" :item="item" />
        </div>
      </template>
    </div>
  </div>
</template>
