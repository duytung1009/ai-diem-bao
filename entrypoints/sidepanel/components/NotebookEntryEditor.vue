<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NotebookEntry } from '@/lib/types';

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
    <div>
      <label class="text-xs text-(--color-text-muted) mb-0.5 block">Tiêu đề</label>
      <input
        v-model="editTitle"
        type="text"
        class="input text-xs w-full"
        placeholder="Tiêu đề..."
      />
    </div>

    <!-- Content -->
    <div>
      <label class="text-xs text-(--color-text-muted) mb-0.5 block">Nội dung</label>
      <textarea
        v-model="editContent"
        class="input text-xs w-full resize-none"
        rows="4"
        placeholder="Nội dung kiến thức..."
      />
    </div>

    <!-- Category -->
    <div>
      <label class="text-xs text-(--color-text-muted) mb-0.5 block">Danh mục</label>
      <input
        v-model="editCategory"
        type="text"
        :list="datalistId"
        class="input text-xs w-full"
        placeholder="Chọn hoặc nhập danh mục..."
      />
      <datalist :id="datalistId">
        <option v-for="cat in allCategories" :key="cat" :value="cat" />
      </datalist>
    </div>

    <!-- Tags -->
    <div>
      <label class="text-xs text-(--color-text-muted) mb-0.5 block">Tags</label>
      <div class="flex flex-wrap gap-1 mb-1">
        <span
          v-for="tag in editTags"
          :key="tag"
          class="badge badge-neutral flex items-center gap-0.5"
        >
          {{ tag }}
          <button
            class="ml-0.5 text-(--color-text-muted) hover:text-(--color-error-text)"
            @click="removeTag(tag)"
          >✕</button>
        </span>
      </div>
      <input
        v-model="tagInput"
        type="text"
        class="input text-xs w-full"
        placeholder="Nhập tag + Enter để thêm..."
        @keydown="handleTagKeydown"
        @blur="addTag"
      />
    </div>

    <!-- User note -->
    <div>
      <label class="text-xs text-(--color-text-muted) mb-0.5 block">Ghi chú của bạn</label>
      <textarea
        v-model="editUserNote"
        class="input text-xs w-full resize-none"
        rows="2"
        placeholder="Ghi chú cá nhân (không ảnh hưởng đến tìm kiếm)..."
      />
    </div>

    <!-- Actions -->
    <div class="flex gap-2 justify-end pt-1">
      <button class="btn btn-ghost btn-sm text-xs" @click="emit('cancel')">Huỷ</button>
      <button
        class="btn btn-primary btn-sm text-xs"
        :disabled="!editTitle.trim() || !editContent.trim()"
        @click="handleSave"
      >
        Lưu
      </button>
    </div>
  </div>
</template>
