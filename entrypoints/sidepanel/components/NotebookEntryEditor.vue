<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NotebookEntry } from '@/lib/types';
import FormField from './FormField.vue';
import IconButton from './IconButton.vue';

const props = defineProps<{
  entry: NotebookEntry;
  allCategories: string[];
}>();

const emit = defineEmits<{
  save: [updated: NotebookEntry];
  cancel: [];
}>();

const editTitle = ref(props.entry.title);
const editContent = ref(props.entry.content);
const editCategory = ref(props.entry.category ?? '');
const editUserNote = ref(props.entry.userNote ?? '');
const editTags = ref<string[]>([...props.entry.tags]);
const tagInput = ref('');

const datalistId = computed(() => `categories-${props.entry.id}`);

function addTag() {
  const raw = tagInput.value.trim().toLowerCase();
  if (raw && !editTags.value.includes(raw)) {
    editTags.value = [...editTags.value, raw];
  }
  tagInput.value = '';
}

function removeTag(tag: string) {
  editTags.value = editTags.value.filter(t => t !== tag);
}

function handleTagKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag();
  }
}

function handleSave() {
  if (!editTitle.value.trim() || !editContent.value.trim()) return;
  const updated: NotebookEntry = {
    ...props.entry,
    title: editTitle.value.trim(),
    content: editContent.value.trim(),
    category: editCategory.value.trim() || undefined,
    tags: editTags.value,
    userNote: editUserNote.value.trim() || undefined,
    editedAt: Date.now(),
  };
  emit('save', updated);
}
</script>

<template>
  <div class="space-y-2 pt-2" @click.stop>
    <!-- Title -->
    <FormField label="Tiêu đề">
      <template #default="{ fieldId }">
        <input
          :id="fieldId"
          v-model="editTitle"
          type="text"
          class="input text-xs w-full"
          placeholder="Tiêu đề..."
        />
      </template>
    </FormField>

    <!-- Content -->
    <FormField label="Nội dung">
      <template #default="{ fieldId }">
        <textarea
          :id="fieldId"
          v-model="editContent"
          class="input text-xs w-full resize-none"
          rows="4"
          placeholder="Nội dung kiến thức..."
        />
      </template>
    </FormField>

    <!-- Category -->
    <FormField label="Danh mục">
      <template #default="{ fieldId }">
        <input
          :id="fieldId"
          v-model="editCategory"
          type="text"
          :list="datalistId"
          class="input text-xs w-full"
          placeholder="Chọn hoặc nhập danh mục..."
        />
        <datalist :id="datalistId">
          <option v-for="cat in allCategories" :key="cat" :value="cat" />
        </datalist>
      </template>
    </FormField>

    <!-- Tags -->
    <FormField label="Tags">
      <template #default="{ fieldId }">
        <div class="flex flex-wrap gap-1 mb-1">
          <span
            v-for="tag in editTags"
            :key="tag"
            class="badge badge-neutral flex items-center gap-0.5"
          >
            {{ tag }}
            <IconButton label="Xoá tag" variant="danger" @click="removeTag(tag)">
              ✕
            </IconButton>
          </span>
        </div>
        <input
          :id="fieldId"
          v-model="tagInput"
          type="text"
          class="input text-xs w-full"
          placeholder="Nhập tag + Enter để thêm..."
          @keydown="handleTagKeydown"
          @blur="addTag"
        />
      </template>
    </FormField>

    <!-- User note -->
    <FormField label="Ghi chú của bạn">
      <template #default="{ fieldId }">
        <textarea
          :id="fieldId"
          v-model="editUserNote"
          class="input text-xs w-full resize-none"
          rows="2"
          placeholder="Ghi chú cá nhân (không ảnh hưởng đến tìm kiếm)..."
        />
      </template>
    </FormField>

    <!-- Actions -->
    <div class="flex gap-2 justify-end pt-1">
      <button type="button" class="btn btn-ghost btn-sm text-xs" @click="emit('cancel')">Hủy</button>
      <button
        type="button"
        class="btn btn-primary btn-sm text-xs"
        :disabled="!editTitle.trim() || !editContent.trim()"
        @click="handleSave"
      >
        Lưu
      </button>
    </div>
  </div>
</template>
