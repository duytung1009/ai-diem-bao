<script setup lang="ts">
import type { CachedTopic } from '@/lib/types';
import CopyButton from './CopyButton.vue';
import ExportButton from './ExportButton.vue';
import ReloadButton from './ReloadButton.vue';

withDefaults(defineProps<{
  modelLabel?: string;
  copyContent?: string;
  exportTopic?: CachedTopic | null;
  jsonData?: unknown;
  jsonFilename?: string;
  reloadLabel?: string;
  reloadDisabled?: boolean;
  onReload?: () => void;
}>(), {
  reloadLabel: 'Tải lại',
});
</script>

<template>
  <div class="flex items-center justify-between gap-2">
    <div class="min-w-0">
      <span v-if="modelLabel" class="text-xs text-(--color-text-muted) italic truncate">{{ modelLabel }}</span>
    </div>
    <div class="flex items-center gap-1 shrink-0">
      <CopyButton
        v-if="copyContent"
        :content="copyContent"
      />
      <ExportButton
        v-if="exportTopic"
        :topic="exportTopic"
        :json-data="jsonData"
        :json-filename="jsonFilename"
      />
      <ReloadButton
        v-if="onReload || $slots['reload-actions']"
        :label="reloadLabel"
        :disabled="reloadDisabled"
        :on-reload="onReload"
      >
        <template v-if="$slots['reload-actions']" #actions>
          <slot name="reload-actions" />
        </template>
      </ReloadButton>
    </div>
  </div>
</template>
