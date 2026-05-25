<script setup lang="ts">
import { onActivated, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTopicStore } from '../composables/useTopicStore';
import { useThreadAnalysis } from '../composables/useThreadAnalysis';
import ErrorDisplay from '../components/ErrorDisplay.vue';
import ThreadAnalysisContent from '../components/ThreadAnalysisContent.vue';

const router = useRouter();
const store = useTopicStore();
const { threadAnalysis, isAnalyzing, error, hasSummary, generateAnalysis } = useThreadAnalysis(store);

const cachedTopic = computed(() => store.selectedTopic.value);

onActivated(() => {
  // view activation: ensure store is current
});
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- No topic selected -->
    <div v-if="!cachedTopic" class="text-center py-8">
      <p class="text-sm text-(--color-text-secondary)">Chưa chọn thớt.</p>
      <button class="mt-3 text-sm text-blue-600 hover:text-blue-700" @click="router.push('/')">
        ← Quay lại danh sách
      </button>
    </div>

    <template v-else>
      <!-- Back button -->
      <div class="flex items-center justify-between">
        <button class="text-xs text-blue-600 hover:text-blue-700" @click="router.push('/')">
          ← Quay lại danh sách
        </button>
      </div>

      <h2 class="font-semibold text-sm text-(--color-text-primary)">Phân tích thớt</h2>

      <!-- No summary available -->
      <div v-if="!hasSummary" class="alert alert-warning">
        Chưa có kết quả tóm tắt. Vui lòng tóm tắt thớt ở tab "Tóm tắt" trước khi phân tích.
      </div>

      <template v-else>
        <!-- Error -->
        <ErrorDisplay v-if="error" :message="error" />

        <!-- Analysis content -->
        <ThreadAnalysisContent
          v-if="threadAnalysis"
          :analysis="threadAnalysis"
          :thread-title="cachedTopic.title"
          :total-pages="cachedTopic.totalPages"
        >
          <template #actions>
            <button
              class="btn text-xs flex items-center gap-1"
              :disabled="isAnalyzing"
              @click="generateAnalysis"
            >
              {{ isAnalyzing ? 'Đang phân tích...' : 'Phân tích lại' }}
            </button>
          </template>
        </ThreadAnalysisContent>

        <!-- Empty state: no analysis yet -->
        <div v-else class="flex flex-col items-center gap-3 py-8">
          <p class="text-sm text-(--color-text-secondary)">Chưa có phân tích cho thớt này.</p>
          <button
            class="btn btn-primary"
            :disabled="isAnalyzing"
            @click="generateAnalysis"
          >
            {{ isAnalyzing ? 'Đang phân tích...' : 'Phân tích thớt' }}
          </button>
        </div>
      </template>
    </template>
  </div>
</template>
