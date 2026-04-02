<script setup lang="ts">
import { ref, onMounted, onActivated } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage } from '@/lib/messaging';
import { isSameTopicUrl } from '@/lib/cache-manager';
import type { LLMConfig } from '@/lib/types';
import { useTopicStore } from '../composables/useTopicStore';
import { useSummarize } from '../composables/useSummarize';
import TopicMeta from '../components/TopicMeta.vue';
import ProgressIndicator from '../components/ProgressIndicator.vue';
import SummaryContent from '../components/SummaryContent.vue';
import CacheIndicator from '../components/CacheIndicator.vue';
import ErrorDisplay from '../components/ErrorDisplay.vue';

const router = useRouter();
const store = useTopicStore();
const {
  summary, summaryJson, error, scrapeProgress, simpleLoadingText, llmTaskId,
  isScraping, scrapingWarnings, scrapingInfo,
  pendingPosts, pendingIncremental, currentConfig,
  cachedTopic, cacheFreshness,
  segmentSize, segmentSummaries, activeSegmentIndex,
  loadedTopicUrl,
  topicInfo, isProcessing, summarizedPostCount, livePostCount,
  tokenEstimation, isSegmentMode, segments,
  summarizedCount, progressPercent, nextPendingSegmentIndex,
  loadTopicData, handleCancel,
  handleSummarize, confirmSummarize, cancelPendingSummarize,
  handleRetry, handleSummarizeSegment, generateOverallSummary, handleSegmentUpdate,
} = useSummarize(store);

const segmentGridExpanded = ref(false);

onMounted(() => {
  sendMessage<LLMConfig>('GET_SETTINGS').then((cfg) => {
    currentConfig.value = cfg;
    if (cfg?.segmentSize) segmentSize.value = cfg.segmentSize;
  }).catch(() => {});
});

// With <keep-alive>: onActivated fires on initial mount AND each re-activation.
onActivated(async () => {
  // Reload settings in case user changed them in SettingsView
  sendMessage<LLMConfig>('GET_SETTINGS').then((cfg) => {
    if (cfg) {
      currentConfig.value = cfg;
      if (cfg.segmentSize) segmentSize.value = cfg.segmentSize;
    }
  }).catch(() => {});

  const url = store.selectedTopic.value?.url;
  if (!url) return;

  // Check if the currently selected topic is being summarized by the LLM.
  const isSummarizingThisTopic =
    store.summarizingUrl.value !== null &&
    isSameTopicUrl(store.summarizingUrl.value, url);

  if (isSummarizingThisTopic) {
    if (!isSameTopicUrl(url, loadedTopicUrl.value ?? '')) {
      // We viewed a different topic in between — reload cached data for this topic
      // but re-apply the loading indicator since LLM is still running.
      await loadTopicData();
      simpleLoadingText.value = 'Đang tóm tắt...';
    }
    loadedTopicUrl.value = url;
    return;
  }

  if (!isSameTopicUrl(url, loadedTopicUrl.value ?? '')) await loadTopicData();
});

</script>

<template>
  <div class="p-4 space-y-4">
    <!-- No topic selected -->
    <div v-if="!topicInfo" class="text-center py-8">
      <p class="text-sm text-(--color-text-secondary)">Chưa chọn chủ đề.</p>
      <button
        class="mt-3 text-sm text-blue-600 hover:text-blue-700"
        @click="$router.push('/')"
      >
        ← Quay lại danh sách
      </button>
    </div>

    <!-- Topic loaded -->
    <template v-else>
      <!-- Back button + Refresh -->
      <div class="flex items-center justify-between">
        <button
          class="text-xs text-blue-600 hover:text-blue-700"
          @click="$router.push('/')"
        >
          ← Quay lại danh sách
        </button>
      </div>

      <TopicMeta :info="topicInfo" :url="store.selectedTopic.value?.url" />

      <button
        v-if="!isProcessing && !summary && !pendingPosts && !isSegmentMode"
        class="w-full btn btn-primary"
        @click="handleSummarize(false)"
      >
        Tóm tắt
      </button>

      <!-- Loading + Cancel -->
      <ProgressIndicator
        v-if="isProcessing"
        :task-id="llmTaskId"
        :scrape-progress="scrapeProgress"
        :scrape-delay-ms="currentConfig?.scrapeDelayMs ?? 2000"
        :message="simpleLoadingText || undefined"
        fallback-message="Đang tóm tắt..."
        :show-cancel="isScraping"
        @cancel="handleCancel"
      />

      <!-- Token estimation confirmation -->
      <div
        v-if="pendingPosts && tokenEstimation"
        class="alert alert-info space-y-3"
      >
        <p class="text-sm font-medium">Xác nhận trước khi gọi API</p>
        <div class="text-xs space-y-1">
          <p>Ước tính: <strong>{{ tokenEstimation.tokensFormatted }}</strong> (~{{ tokenEstimation.cost }})</p>
          <p v-if="tokenEstimation.exceeds" class="text-orange-700">
            Topic dài, sẽ tự động chia thành <strong>{{ tokenEstimation.chunksNeeded }} phần</strong> để tóm tắt.
          </p>
        </div>
        <div class="flex gap-2">
          <button
            class="flex-1 btn btn-sm btn-primary"
            @click="confirmSummarize"
          >
            Xác nhận tóm tắt
          </button>
          <button
            class="flex-1 btn btn-sm btn-secondary"
            @click="cancelPendingSummarize"
          >
            Huỷ
          </button>
        </div>
      </div>

      <!-- Error -->
      <ErrorDisplay
        v-if="error"
        :message="error"
        action="retry"
        @retry="handleRetry"
      />

      <!-- Page scraping warnings -->
      <div
        v-if="scrapingWarnings.length > 0"
        class="alert alert-warning text-xs space-y-1"
      >
        <p class="font-medium">Một số trang bị bỏ qua:</p>
        <ul class="list-disc list-inside space-y-0.5">
          <li v-for="(w, i) in scrapingWarnings" :key="i">{{ w }}</li>
        </ul>
        <button
          class="underline mt-1 opacity-80 hover:opacity-100"
          @click="scrapingWarnings = []"
        >
          Ẩn
        </button>
      </div>

      <!-- Info messages (e.g. articles loaded) -->
      <div
        v-if="scrapingInfo.length > 0"
        class="alert alert-info text-xs"
      >
        <ul class="list-disc list-inside space-y-0.5">
          <li v-for="(m, i) in scrapingInfo" :key="i">{{ m }}</li>
        </ul>
      </div>

      <!-- SEGMENT MODE: Topic > 100 pages -->
      <template v-if="isSegmentMode && !isProcessing && !pendingPosts">
        <!-- Segment info banner -->
        <div class="alert alert-info text-xs">
          <p class="font-medium">Chủ đề dài ({{ topicInfo!.pageCount }} trang)</p>
          <p class="mt-0.5">Chia thành {{ segments.length }} phần, mỗi phần ~{{ segmentSize }} trang. Tóm tắt từng phần rồi tạo tổng quan.</p>
        </div>

        <!-- Segment tabs -->
        <div class="space-y-2">
          <!-- Row 1: Tổng quan + Tiếp theo -->
          <div class="flex items-center gap-2 flex-wrap">
            <button
              class="px-3 py-1.5 text-xs rounded-full font-medium transition-colors"
              :class="activeSegmentIndex === null
                ? 'bg-blue-600 text-white'
                : 'bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-bg-muted)'"
              @click="activeSegmentIndex = null"
            >
              Tổng quan
            </button>
            <button
              v-if="nextPendingSegmentIndex !== null"
              class="px-3 py-1.5 text-xs rounded-full transition-colors bg-(--color-bg-muted) text-(--color-text-secondary) hover:text-(--color-text-primary) flex items-center gap-1"
              @click="activeSegmentIndex = nextPendingSegmentIndex"
            >
              Tiếp theo: {{ segments[nextPendingSegmentIndex!].label }}
              <span class="text-(--color-text-muted)">→</span>
            </button>
          </div>

          <!-- Row 2: Progress bar + expand toggle -->
          <div class="space-y-1">
            <div class="flex items-center justify-between text-xs text-(--color-text-secondary)">
              <span>{{ summarizedCount }} / {{ segments.length }} phần đã tóm tắt</span>
              <button
                class="underline hover:text-(--color-text-primary) transition-colors"
                @click="segmentGridExpanded = !segmentGridExpanded"
              >
                {{ segmentGridExpanded ? 'Thu gọn ▲' : 'Xem tất cả ▼' }}
              </button>
            </div>
            <div class="h-1.5 rounded-full bg-(--color-bg-muted) overflow-hidden">
              <div
                class="h-full rounded-full bg-blue-500 transition-all duration-300"
                :style="{ width: progressPercent + '%' }"
              />
            </div>
          </div>

          <!-- Row 3: Collapsible pill grid -->
          <div
            v-if="segmentGridExpanded"
            class="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto"
          >
            <button
              v-for="(seg, i) in segments"
              :key="i"
              class="px-2.5 py-1 text-xs rounded-full transition-colors flex items-center gap-1"
              :class="activeSegmentIndex === i
                ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-medium'
                : 'text-(--color-text-secondary) hover:bg-(--color-bg-muted)'"
              @click="activeSegmentIndex = i"
            >
              {{ seg.label }}
              <span
                v-if="segmentSummaries[i]?.summary"
                class="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"
                title="Đã tóm tắt"
              />
              <span
                v-else-if="segmentSummaries[i]?.posts?.length"
                class="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0"
                title="Đã scrape, chưa tóm tắt"
              />
            </button>
          </div>

          <!-- Row 4: Prev/Next khi đang ở 1 segment cụ thể -->
          <div
            v-if="activeSegmentIndex !== null"
            class="flex items-center justify-between text-xs text-(--color-text-secondary)"
          >
            <button
              v-if="activeSegmentIndex > 0"
              class="flex items-center gap-1 hover:text-(--color-text-primary) transition-colors"
              @click="activeSegmentIndex--"
            >
              ← {{ segments[activeSegmentIndex - 1].label }}
            </button>
            <span v-else />
            <button
              v-if="activeSegmentIndex < segments.length - 1"
              class="flex items-center gap-1 hover:text-(--color-text-primary) transition-colors"
              @click="activeSegmentIndex++"
            >
              {{ segments[activeSegmentIndex + 1].label }} →
            </button>
            <span v-else />
          </div>
        </div>

        <!-- Overall summary view -->
        <template v-if="activeSegmentIndex === null">
          <div v-if="summary" class="space-y-3">
            <div class="flex items-center justify-start gap-2">
              <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span class="text-xs text-(--color-text-secondary)">
                Tóm tắt tổng quan {{ segments.length }} phần
              </span>
            </div>
            <CacheIndicator
              v-if="cacheFreshness && cachedTopic"
              :freshness="cacheFreshness"
              :cached-at="cachedTopic.cachedAt"
              :cached-posts="cachedTopic.totalPosts"
              :current-posts="livePostCount"
              @update="handleSegmentUpdate"
            />
            <div class="card p-4">
              <SummaryContent :content="summary" :json="summaryJson ?? undefined" />
            </div>
            <button
              class="w-full btn btn-secondary text-sm"
              :disabled="isProcessing"
              @click="generateOverallSummary"
            >
              Tạo lại tóm tắt tổng quan
            </button>
          </div>
          <div v-else class="text-center py-4 space-y-2">
            <p class="text-xs text-(--color-text-muted)">
              Tóm tắt từng phần trước, sau đó tạo tóm tắt tổng quan.
            </p>
            <button
              v-if="segmentSummaries.filter(s => s?.summary).length >= 2"
              class="btn btn-primary"
              :disabled="isProcessing"
              @click="generateOverallSummary"
            >
              Tạo tóm tắt tổng quan
            </button>
            <p v-else class="text-xs text-(--color-text-muted)">(Cần ít nhất 2 phần đã tóm tắt)</p>
          </div>
        </template>

        <!-- Individual segment view -->
        <template v-if="activeSegmentIndex !== null">
          <div v-if="segmentSummaries[activeSegmentIndex]?.summary" class="space-y-3">
            <div class="flex items-center justify-start gap-2">
              <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span class="text-xs text-(--color-text-secondary)">{{ segmentSummaries[activeSegmentIndex].postCount }} bài viết</span>
            </div>
            <div class="card p-4">
              <SummaryContent
                :content="segmentSummaries[activeSegmentIndex].summary"
                :json="segmentSummaries[activeSegmentIndex].summaryJson"
              />
            </div>
            <button
              class="w-full btn btn-secondary text-xs"
              :disabled="isProcessing"
              @click="handleSummarizeSegment(activeSegmentIndex)"
            >
              Tóm tắt lại phần này
            </button>
          </div>
          <div v-else class="text-center py-4">
            <button
              class="btn btn-primary"
              :disabled="isProcessing"
              @click="handleSummarizeSegment(activeSegmentIndex)"
            >
              Tóm tắt {{ segments[activeSegmentIndex].label }}
            </button>
          </div>
        </template>
      </template>

      <!-- NORMAL MODE: Topic ≤ 100 pages -->
      <div v-if="!isSegmentMode && summary" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-y-1.5 gap-x-3">
          <div
            v-if="summarizedPostCount > 0"
            class="flex items-center justify-start gap-2"
          >
            <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span class="text-xs text-(--color-text-secondary)">Đã tóm tắt {{ summarizedPostCount }} bài viết</span>
          </div>
        </div>
        <CacheIndicator
          v-if="cacheFreshness && cachedTopic"
          :freshness="cacheFreshness"
          :cached-at="cachedTopic.cachedAt"
          :cached-posts="cachedTopic.totalPosts"
          :current-posts="livePostCount"
          @update="handleSummarize(true)"
        />
        <div class="card p-4">
          <SummaryContent :content="summary" :json="summaryJson ?? undefined" />
        </div>
        <button
          class="w-full btn btn-secondary"
          @click="handleSummarize(false)"
        >
          Tóm tắt lại
        </button>
      </div>
    </template>
  </div>
</template>