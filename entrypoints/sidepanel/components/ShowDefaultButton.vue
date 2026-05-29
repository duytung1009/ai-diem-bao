<script setup lang="ts">
defineProps<{
  expanded: boolean;
}>();

defineEmits<{
  toggle: [];
}>();
</script>

<template>
  <button
    type="button"
    class="btn-ghost inline-flex items-center gap-1 text-xs"
    @click="$emit('toggle')"
  >
    <svg class="w-3 h-3 transition-transform duration-200" :class="{ 'rotate-90': expanded }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
    </svg>
    <span>{{ expanded ? 'Ẩn' : 'Xem' }} mặc định</span>
  </button>
</template>
