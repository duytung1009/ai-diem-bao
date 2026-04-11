<script setup lang="ts">
import { ref, computed, onMounted, onActivated } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage } from '@/lib/messaging';
import { isSameTopicUrl } from '@/lib/cache-manager';
import type { LLMConfig } from '@/lib/types';
import { useTopicStore } from '../composables/useTopicStore';
import { useSummarize } from '../composables/useSummarize';
import ProgressIndicator from '../components/ProgressIndicator.vue';
import SummaryContent from '../components/SummaryContent.vue';
import CacheIndicator from '../components/CacheIndicator.vue';
import ErrorDisplay from '../components/ErrorDisplay.vue';

const router = useRouter();
const store = useTopicStore();
const {
  summary, summaryJson, error, scrapeProgress, simpleLoadingText, llmTaskId,
  isScraping, scrapingWarnings, scrapingInfo,
  currentConfig,
  cachedTopic, cacheFreshness,
  segmentSize, segmentSummaries, activeSegmentIndex,
  loadedTopicUrl, dynamicSegmentBoundaries,
  topicInfo, isProcessing, livePostCount,
  isSegmentMode, segments,
  summarizedCount, progressPercent, nextPendingSegmentIndex,
  loadTopicData, handleCancel,
  handleSummarizeSegment, generateOverallSummary, handleSegmentUpdate, handleAutoSummarizeAll,
} = useSummarize(store);

const segmentGridExpanded = ref(false);
const confirmingAutoSummarize = ref(false);

const newPostCount = computed(() => livePostCount.value - (cachedTopic?.value?.totalPosts ?? 0));

// postNumber → page mapping, built from all cached posts (top-level + segments)
const postPageMap = computed<Record<number, number>>(() => {
  const topic = cachedTopic?.value;
  if (!topic) return {};
  const map: Record<number, number> = {};
  const addPosts = (posts: typeof topic.posts) => {
    for (const p of posts) {
      if (p.page !== undefined) map[p.postNumber] = p.page;
    }
  };
  addPosts(topic.posts);
  for (const seg of topic.segments ?? []) addPosts(seg.posts);
  return map;
});

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

      <!-- Error -->
      <ErrorDisplay
        v-if="error"
        :message="error"
        action="none"
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

      <!-- SEGMENT MODE (always) -->
      <template v-if="isSegmentMode && !isProcessing">
        <!-- Info banner: chỉ hiển thị khi > 1 segment -->
        <div v-if="segments.length > 1" class="alert alert-info text-xs">
          <p class="font-medium">Chủ đề dài ({{ topicInfo!.pageCount }} trang)</p>
          <p v-if="currentConfig?.dynamicSegments" class="mt-0.5">Chia thành {{ segments.length }} phần theo độ dài nội dung. Tóm tắt từng phần rồi tạo tổng quan.</p>
          <p v-else class="mt-0.5">Chia thành {{ segments.length }} phần, mỗi phần ~{{ segmentSize }} trang. Tóm tắt từng phần rồi tạo tổng quan.</p>
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
            <template v-if="segments.length > 1">
              <button
                v-if="!confirmingAutoSummarize"
                class="px-3 py-1.5 text-xs rounded-full font-medium transition-colors bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                @click="confirmingAutoSummarize = true"
              >
                ⚡ Tóm tắt toàn bộ<template v-if="!currentConfig?.dynamicSegments || dynamicSegmentBoundaries.length > 0"> ({{ segments.length }} phần)</template>
              </button>
              <span v-else class="flex items-center gap-1.5 flex-wrap">
                <span class="text-xs text-(--color-text-secondary)">Tóm tắt {{ segments.length }} phần, không thể hủy. Tiếp tục?</span>
                <button
                  class="px-2.5 py-1 text-xs rounded-full font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  @click="confirmingAutoSummarize = false; handleAutoSummarizeAll()"
                >
                  Xác nhận
                </button>
                <button
                  class="px-2.5 py-1 text-xs rounded-full font-medium bg-(--color-bg-muted) text-(--color-text-secondary) hover:text-(--color-text-primary) transition-colors"
                  @click="confirmingAutoSummarize = false"
                >
                  Hủy
                </button>
              </span>
            </template>
            <button
              v-if="nextPendingSegmentIndex !== null"
              class="px-3 py-1.5 text-xs rounded-full font-medium transition-colors bg-(--color-bg-muted) text-(--color-text-secondary) hover:text-(--color-text-primary) flex items-center gap-1"
              @click="activeSegmentIndex = nextPendingSegmentIndex"
            >
              Tiếp theo: {{ segments[nextPendingSegmentIndex!].label }}
              <span class="text-(--color-text-muted)">→</span>
            </button>
            <button
              v-if="cacheFreshness && cacheFreshness !== 'fresh'"
              class="px-3 py-1.5 text-xs rounded-full font-medium transition-colors bg-(--color-bg-muted) text-(--color-text-secondary) hover:text-(--color-text-primary) flex items-center gap-1"
              @click="handleSegmentUpdate"
            >
              Cập nhật
              <template v-if="newPostCount > 0">(+{{ newPostCount }})</template>
            </button>
          </div>

          <!-- Row 2+3: Progress bar + pill grid (chỉ hiển thị khi > 1 segment) -->
          <template v-if="segments.length > 1">
            <div class="space-y-1">
              <div class="flex items-center justify-between text-xs text-(--color-text-secondary)">
                <span>{{ summarizedCount }} / {{ segments.length }} phần đã tóm tắt</span>
                <button
                  class="btn"
                  @click="segmentGridExpanded = !segmentGridExpanded"
                >
                  <svg
                    class="w-4 h-4 text-(--color-text-secondary) transition-transform duration-200 shrink-0"
                    :class="{ 'rotate-180': segmentGridExpanded }"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              <div class="h-1.5 rounded-full bg-(--color-bg-muted) overflow-hidden">
                <div
                  class="h-full rounded-full bg-blue-500 transition-all duration-300"
                  :style="{ width: progressPercent + '%' }"
                />
              </div>
            </div>
            <div
              v-if="segmentGridExpanded"
              class="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto scrollbar-thumb-rounded-full scrollbar-track-rounded-full scrollbar scrollbar-thumb-slate-700 scrollbar-track-slate-300"
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
                  v-if="segmentSummaries[i]?.summary && segmentSummaries[i]?.complete !== false"
                  class="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"
                  title="Đã tóm tắt"
                />
                <span
                  v-else-if="segmentSummaries[i]?.summary && segmentSummaries[i]?.complete === false"
                  class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                  title="Đã tóm tắt — có thể có bài viết mới"
                />
                <span
                  v-else-if="segmentSummaries[i]?.posts?.length"
                  class="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0"
                  title="Đã scrape, chưa tóm tắt"
                />
              </button>
            </div>
          </template>

          <!-- Row 4: Prev/Next khi đang ở 1 segment cụ thể -->
          <div
            v-if="activeSegmentIndex !== null"
            class="flex items-center justify-between text-xs text-(--color-text-secondary)"
          >
            <button
              v-if="activeSegmentIndex > 0"
              class="flex items-center gap-1 text-blue-600 hover:text-blue-700 transition-colors"
              @click="activeSegmentIndex--"
            >
              ← {{ segments[activeSegmentIndex - 1].label }}
            </button>
            <span v-else />
            <button
              v-if="activeSegmentIndex < segments.length - 1"
              class="flex items-center gap-1 text-blue-600 hover:text-blue-700"
              @click="activeSegmentIndex++"
            >
              {{ segments[activeSegmentIndex + 1].label }} →
            </button>
            <span v-else />
          </div>
        </div>

        <!-- Overall summary view -->
        <template v-if="activeSegmentIndex === null">
          <!-- Single segment: hiển thị summary trực tiếp -->
          <template v-if="segments.length === 1">
            <div v-if="segmentSummaries[0]?.summary" class="space-y-3">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center justify-start gap-2">
                  <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span class="text-xs text-(--color-text-secondary)">{{ segmentSummaries[0].postCount }} bài viết</span>
                </div>
                <CacheIndicator
                  v-if="cacheFreshness && cachedTopic"
                  :freshness="cacheFreshness"
                  :cached-at="cachedTopic.cachedAt"
                  :cached-posts="cachedTopic.totalPosts"
                  :current-posts="livePostCount"
                  @update="handleSegmentUpdate"
                />
              </div>
              <div class="card p-4">
                <SummaryContent :content="segmentSummaries[0].summary" :json="segmentSummaries[0].summaryJson ?? undefined" :topic-url="cachedTopic?.url" :post-page-map="postPageMap" />
              </div>
              <button
                class="w-full btn btn-secondary text-sm"
                :disabled="isProcessing"
                @click="handleSummarizeSegment(0)"
              >
                Tóm tắt lại
              </button>
            </div>
            <div v-else class="text-center py-4">
              <button
                class="btn btn-primary"
                :disabled="isProcessing"
                @click="handleSummarizeSegment(0)"
              >
                Tóm tắt
              </button>
            </div>
          </template>

          <!-- Multi-segment: overall summary flow -->
          <template v-else>
            <div v-if="summary" class="space-y-3">
              <div class="flex items-center justify-between gap-2">
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
              </div>
              <div class="card p-4">
                <SummaryContent :content="summary" :json="summaryJson ?? undefined" :topic-url="cachedTopic?.url" :post-page-map="postPageMap" />
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
                :topic-url="cachedTopic?.url" :post-page-map="postPageMap"
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

    </template>
  </div>
</template>