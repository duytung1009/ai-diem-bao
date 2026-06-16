<script setup lang="ts">
import { computed, useId } from 'vue';

export interface RadioOption {
  value: string;
  label: string;
}

const props = withDefaults(defineProps<{
  modelValue?: string;
  label?: string;
  options?: RadioOption[];
  disabled?: boolean;
  name?: string;
}>(), {
  disabled: false,
  options: () => [],
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const uid = useId();
const groupName = computed(() => props.name || `radio-${uid}`);

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value);
}
</script>

<template>
  <fieldset class="border-none p-0 m-0">
    <legend
      v-if="label"
      class="label"
    >
      {{ label }}
    </legend>
    <div class="flex flex-col gap-2 mt-1">
      <label
        v-for="opt in options"
        :key="opt.value"
        :for="`radio-${uid}-${opt.value}`"
        class="inline-flex items-center gap-2 cursor-pointer"
        :class="{ 'opacity-40 cursor-not-allowed': disabled }"
      >
        <input
          :id="`radio-${uid}-${opt.value}`"
          type="radio"
          :name="groupName"
          :value="opt.value"
          class="radio"
          :checked="modelValue === opt.value"
          :disabled="disabled"
          @input="onInput"
        >
        <span class="text-xs text-(--color-text-primary)">{{ opt.label }}</span>
      </label>
    </div>
  </fieldset>
</template>
