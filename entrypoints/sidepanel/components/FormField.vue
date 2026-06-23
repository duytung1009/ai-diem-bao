<script setup lang="ts">
import { computed, useId } from 'vue';

const props = defineProps<{
  label?: string;
  hint?: string;
  error?: string;
  forId?: string;
}>();

const emit = defineEmits<{
  'update:error': [value: string | undefined];
}>();

const uid = useId();
const fieldId = computed(() => props.forId || `field-${uid}`);
const hintId = computed(() => props.hint ? `hint-${uid}` : undefined);
const errorId = computed(() => props.error ? `error-${uid}` : undefined);
const describedBy = computed(() => [hintId.value, errorId.value].filter(Boolean).join(' ') || undefined);
</script>

<template>
  <div class="flex flex-col gap-1">
    <label
      v-if="label"
      :for="fieldId"
      class="label"
    >
      {{ label }}
    </label>
    <slot
      :fieldId="fieldId"
      :describedBy="describedBy"
    />
    <p
      v-if="hint"
      :id="hintId"
      class="text-xs text-(--color-text-muted)"
    >
      {{ hint }}
    </p>
    <p
      v-if="error"
      :id="errorId"
      class="text-xs text-(--color-error-text)"
    >
      {{ error }}
    </p>
  </div>
</template>
