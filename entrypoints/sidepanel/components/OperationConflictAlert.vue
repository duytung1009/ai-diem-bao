<script setup lang="ts">
defineProps<{
  operation: string;
  oldTopicTitle: string;
  newTopicTitle: string;
}>();

defineEmits<{
  cancel: [];
  goBack: [];
}>();
</script>

<template>
  <div class="alert alert-warning space-y-3">
    <p class="text-xs">
      Đang {{ operation }} cho thớt <strong>{{ oldTopicTitle }}</strong>.
      Chọn <strong>"Hủy task"</strong> để chuyển sang thớt <strong>{{ newTopicTitle }}</strong>,
      hoặc <strong>"Quay lại thớt cũ"</strong> để tiếp tục theo dõi.
    </p>
    <div class="flex gap-2">
      <button class="flex-1 btn btn-danger btn-sm text-xs" @click="$emit('cancel')">Hủy task</button>
      <button class="flex-1 btn btn-secondary btn-sm text-xs" @click="$emit('goBack')">Quay lại thớt cũ</button>
    </div>
  </div>
</template>
