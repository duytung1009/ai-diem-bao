<script setup lang="ts">
/**
 * EmptyState — banner dùng chung cho mọi trạng thái rỗng / chưa chọn thớt.
 *
 * Dùng cho: empty list, "chưa có dữ liệu", "chưa chọn thớt", no search results.
 * Slots:
 *   - #description: nội dung mô tả tuỳ biến (cho phép HTML như <strong>); nếu không
 *     dùng slot thì rơi về prop `description` (plain text).
 *   - #action: vùng nút hành động (button, BackButton...).
 */
withDefaults(
  defineProps<{
    /** Emoji/icon hiển thị trên cùng. */
    icon?: string;
    /** Tiêu đề chính (đậm). */
    title?: string;
    /** Mô tả plain text. Bỏ qua nếu dùng slot #description. */
    description?: string;
    /** true → bọc trong `card`; false (mặc định) → text-center thuần, nhẹ nhàng hơn. */
    bordered?: boolean;
  }>(),
  { bordered: false },
);
</script>

<template>
  <div :class="bordered ? 'card text-center py-10 space-y-3' : 'text-center py-8 space-y-3'">
    <div v-if="icon" class="text-3xl">{{ icon }}</div>
    <p v-if="title" class="text-sm font-medium text-(--color-text-primary)">{{ title }}</p>
    <slot name="description">
      <p v-if="description" class="text-xs text-(--color-text-secondary)">{{ description }}</p>
    </slot>
    <div v-if="$slots.action" class="flex gap-2 justify-center">
      <slot name="action" />
    </div>
  </div>
</template>
