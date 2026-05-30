<script setup lang="ts">
import { ref, computed, onMounted, onActivated } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage } from '@/lib/messaging';
import { isSameTopicUrl } from '@/lib/cache-manager';
import type { LLMConfig, CachedTopic } from '@/lib/types';
import { calculateSegmentBudget, estimateTokens } from '@/lib/token-estimator';
import { SUMMARY_PROMPT } from '@/lib/prompts';
import type { CostEstimate } from '@/lib/types';
import { estimateAutoSummarizeCostFromSegments } from '@/lib/llm/cost-estimator';
import { LLM_WARN_THRESHOLD_CALLS } from '@/lib/constants';
import { formatNumber } from '@/lib/format';
import { getModelMaxOutput } from '@/lib/token-estimator';
import CostConfirmModal from '../components/CostConfirmModal.vue';
import { useTopicStore } from '../composables/useTopicStore';
import { useSummarize } from '../composables/useSummarize';
import ProgressIndicator from '../components/ProgressIndicator.vue';
import StepTimeline from '../components/StepTimeline.vue';
import SummaryContent from '../components/SummaryContent.vue';
import ErrorDisplay from '../components/ErrorDisplay.vue';
import BackButton from '../components/BackButton.vue';
import ForwardLink from '../components/ForwardLink.vue';
import OperationConflictAlert from '../components/OperationConflictAlert.vue';
import ExportButton from '../components/ExportButton.vue';

import { useLLM } from '../composables/useLLM';
import { useSeederDetection } from '../composables/useSeederDetection';
import type { PipelineDefinition } from '@/lib/types';

const router = useRouter();
const store = useTopicStore();
const {
  summary, summaryJson,
  error, scrapeProgress, simpleLoadingText, llmTaskId,
  isScraping, scrapingWarnings, scrapingInfo,
  currentConfig, pipeline: summarizePipeline,
  cachedTopic, cacheFreshness,
  segmentSize, segmentSummaries, activeSegmentIndex,
  loadedTopicUrl, dynamicSegmentBoundaries,
  topicInfo, isProcessing,
  isSegmentMode, segments,
  summarizedCount, progressPercent, nextPendingSegmentIndex,
  loadTopicData, handleCancel,
  handleSummarizeSegment, generateOverallSummary, handleSegmentUpdate, handleAutoSummarizeAll,
} = useSummarize(store);
const { getTaskState } = useLLM();
const { showTrustBadges, loadSetting: loadSeederSetting } = useSeederDetection();

// Determine pipeline to display: prefer task state (auto-updated), fallback to static builder
const activePipeline = computed<PipelineDefinition | null>(() => {
  if (llmTaskId.value) {
    const task = getTaskState(llmTaskId.value);
    if (task?.pipeline) return task.pipeline;
  }
  return summarizePipeline.value;
});

const loadedTopicTitle = ref('');
const pendingConflict = ref<{ newUrl: string; newTitle: string } | null>(null);

const segmentGridExpanded = ref(false);
const showAutoSummarizeModal = ref(false);

const summaryPromptTokens = estimateTokens(SUMMARY_PROMPT);
const estimatedAutoSummarizeCost = computed<CostEstimate | null>(() => {
  if (!topicInfo.value || !currentConfig.value) return null;
  const model = currentConfig.value.model;
  const budget = calculateSegmentBudget(model, summaryPromptTokens, undefined, currentConfig.value.contextWindow);
  const maxOutput = currentConfig.value.maxTokens ?? getModelMaxOutput(model);
  // Use actual segment count (from segmentSize setting) instead of re-deriving from token budget.
  // Token budget math overestimates pages-per-segment for large-context models, leading to
  // underestimated apiCalls and the modal being incorrectly skipped.
  const segCount = segments.value.length || 1;
  return estimateAutoSummarizeCostFromSegments(segCount, budget, model, maxOutput);
});
const showAutoSummarizeWarning = computed(() =>
  (estimatedAutoSummarizeCost.value?.apiCalls ?? 0) > LLM_WARN_THRESHOLD_CALLS,
);

function onAutoSummarizeClick() {
  const est = estimatedAutoSummarizeCost.value;
  if (est && est.costUsd === 0 && est.apiCalls <= 3) {
    handleAutoSummarizeAll(false);
    return;
  }
  showAutoSummarizeModal.value = true;
}

const newPostCount = computed(() => {
  const topic = cachedTopic.value;
  if (!topic) return 0;
  const totalRef = topic.forumPostCount ?? topic.totalPosts ?? 0;
  const summarized = topic.summarizedPostCount ?? topic.totalPosts ?? 0;
  return Math.max(0, totalRef - summarized);
});

const hasSavedKnowledgeEntries = computed(() => (cachedTopic.value?.knowledgeEntries?.length ?? 0) > 0);
const hasKnowledgeChunks = computed(() => (cachedTopic.value?.knowledgeChunks?.length ?? 0) > 0);
const savedKnowledgeCount = computed(() => cachedTopic.value?.knowledgeEntries?.length ?? 0);
const allPostsForCTA = computed(() => {
  if (!cachedTopic.value) return [];
  return cachedTopic.value.posts?.length ? cachedTopic.value.posts : cachedTopic.value.segments?.flatMap(s => s?.posts ?? []) ?? [];
});

function handleKnowledgeCTA(action: 'extract' | 'view' | 'restore') {
  if (action === 'extract') {
    // Segment-mode topics: navigate to knowledge tab so user uses the segment grid.
    // Legacy (non-segment) topics: ?extract=true triggers handleExtract automatically.
    if (cachedTopic.value?.segments?.length) {
      router.push('/knowledge');
    } else {
      router.push('/knowledge?extract=true');
    }
  } else if (action === 'view') {
    router.push('/knowledge');
  } else if (action === 'restore') {
    router.push('/knowledge?restore=true');
  }
}

const modelLabel = computed(() => {
  const cfg = cachedTopic?.value?.llmConfig;
  if (!cfg?.provider || !cfg?.model) return null;
  return `${cfg.provider}: ${cfg.model}`;
});

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
  if (topic.posts) addPosts(topic.posts);
  for (const seg of topic.segments ?? []) {
    if (seg && seg.posts) addPosts(seg.posts);
  }
  return map;
});

onMounted(() => {
  loadSeederSetting().catch(() => {});
  sendMessage<LLMConfig>('GET_SETTINGS').then((cfg) => {
    currentConfig.value = cfg;
    if (cfg?.segmentSize) segmentSize.value = cfg.segmentSize;
  }).catch(() => { });
});

// With <keep-alive>: onActivated fires on initial mount AND each re-activation.
onActivated(async () => {
  // Reload settings in case user changed them in SettingsView
  sendMessage<LLMConfig>('GET_SETTINGS').then((cfg) => {
    if (cfg) {
      currentConfig.value = cfg;
      if (cfg.segmentSize) segmentSize.value = cfg.segmentSize;
    }
  }).catch(() => { });

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

  if (!isSameTopicUrl(url, loadedTopicUrl.value ?? '')) {
    // Show conflict alert if summarizing for a different topic
    if (isProcessing.value && loadedTopicUrl.value) {
      pendingConflict.value = { newUrl: url, newTitle: store.selectedTopic.value?.title ?? '...' };
      return;
    }
    await loadTopicData();
    loadedTopicTitle.value = store.selectedTopic.value?.title ?? '';
  }
});

function handleConflictCancel() {
  handleCancel();
  pendingConflict.value = null;
  const url = store.selectedTopic.value?.url;
  if (url) {
    loadTopicData();
    loadedTopicTitle.value = store.selectedTopic.value?.title ?? '';
  }
}

async function handleConflictGoBack() {
  const oldUrl = loadedTopicUrl.value;
  if (oldUrl) {
    const oldTopic = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', oldUrl);
    if (oldTopic) store.selectTopic(oldTopic);
  }
  pendingConflict.value = null;
}
</script>

<template>
  <div class="p-3 space-y-2">
    <!-- No topic selected -->
    <div v-if="!topicInfo" class="text-center py-8">
      <p class="text-sm text-(--color-text-secondary)">Chưa chọn thớt.</p>
      <BackButton class="mt-3" />
    </div>

    <!-- Topic loaded -->
    <template v-else>
      <!-- Back button + Section heading + Export -->
      <div class="flex items-center justify-between">
        <BackButton />
        <h2 class="section-heading">Tóm tắt tổng quan</h2>
      </div>

      <!-- Conflict alert: running task for old topic -->
      <OperationConflictAlert v-if="pendingConflict" operation="tóm tắt" :oldTopicTitle="loadedTopicTitle" :newTopicTitle="pendingConflict.newTitle"
        @cancel="handleConflictCancel" @goBack="handleConflictGoBack" />

      <template v-if="!pendingConflict">

        <!-- Loading + Cancel -->
        <StepTimeline v-if="isProcessing && activePipeline" :pipeline="activePipeline" :show-cancel="isProcessing" @cancel="handleCancel" />

        <ProgressIndicator v-else-if="isProcessing" :task-id="llmTaskId" :scrape-progress="scrapeProgress"
          :scrape-delay-ms="currentConfig?.scrapeDelayMs ?? 2000" :message="simpleLoadingText || undefined" fallback-message="Đang tóm tắt..."
          :show-cancel="isProcessing" @cancel="handleCancel" />

        <!-- Error -->
        <ErrorDisplay v-if="error" :message="error" action="none" />

        <!-- Page scraping warnings -->
        <div v-if="scrapingWarnings.length > 0" class="text-xs alert alert-warning space-y-1">
          <p class="font-medium">Một số trang bị bỏ qua:</p>
          <ul class="list-disc list-inside space-y-0.5">
            <li v-for="(w, i) in scrapingWarnings" :key="i">{{ w }}</li>
          </ul>
          <button class="underline mt-1 opacity-80 hover:opacity-100" @click="scrapingWarnings = []">
            Ẩn
          </button>
        </div>

        <!-- Info messages (e.g. articles loaded) -->
        <div v-if="scrapingInfo.length > 0" class="text-xs alert alert-info">
          <ul class="list-disc list-inside space-y-0.5">
            <li v-for="(m, i) in scrapingInfo" :key="i">{{ m }}</li>
          </ul>
        </div>

        <!-- SEGMENT MODE (always) -->
        <template v-if="isSegmentMode && !isProcessing">
          <!-- Info banner: chỉ hiển thị khi > 1 segment -->
          <div v-if="segments.length > 1" class="text-xs alert alert-info">
            <p class="font-medium">Thớt dài ({{ formatNumber(topicInfo!.pageCount) }} trang)</p>
            <p v-if="currentConfig?.dynamicSegments" class="mt-0.5">Chia thành {{ formatNumber(segments.length) }} phần theo độ dài nội dung. Tóm tắt từng phần
              rồi tạo tổng quan.</p>
            <p v-else class="mt-0.5">Chia thành {{ formatNumber(segments.length) }} phần, mỗi phần ~{{ formatNumber(segmentSize) }} trang. Tóm tắt từng phần rồi
              tạo tổng quan.</p>
          </div>

          <button v-if="summary && cacheFreshness && cacheFreshness !== 'fresh' && newPostCount > 0" class="btn-llm" @click="handleSegmentUpdate">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
            </svg>
            Cập nhật
            <span v-if="newPostCount > 0">(+{{ formatNumber(newPostCount) }})</span>
          </button>

          <!-- Segment tabs -->
          <div v-if="summary" class="space-y-2">
            <!-- Row 1: Tổng quan + Tiếp theo -->
            <div class="flex justify-between gap-2 flex-wrap">
              <button class="badge transition-colors" :class="activeSegmentIndex === null
                ? 'badge-accent'
                : 'badge-neutral'" @click="activeSegmentIndex = null">
                Tổng quan
              </button>
              <ExportButton v-if="cachedTopic && (summary || segmentSummaries.some(s => s?.summary))" :topic="cachedTopic as unknown as CachedTopic" />
            </div>

            <!-- Row 2+3: Progress bar + pill grid (chỉ hiển thị khi > 1 segment) -->
            <template v-if="segments.length > 1">
              <div class="card space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-semibold text-(--color-text-secondary)">
                    {{ formatNumber(summarizedCount) }} / {{ formatNumber(segments.length) }} đoạn đã tóm tắt
                  </span>
                  <button class="btn" @click="segmentGridExpanded = !segmentGridExpanded">
                    <svg class="w-4 h-4 text-(--color-text-secondary) transition-transform duration-200 shrink-0" :class="{ 'rotate-180': segmentGridExpanded }"
                      fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                <div class="h-1.5 rounded-full bg-(--color-bg-muted) overflow-hidden">
                  <div class="h-full rounded-full bg-(--color-accent) transition-all duration-300" :style="{ width: progressPercent + '%' }" />
                </div>
                <div v-if="segmentGridExpanded"
                  class="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto scrollbar-thin">
                  <button v-for="(seg, i) in segments" :key="i" class="badge transition-colors flex items-center gap-1" :class="activeSegmentIndex === i
                    ? 'badge-accent'
                    : 'badge-neutral'" @click="activeSegmentIndex = i">
                    {{ seg.label }}
                    <span v-if="segmentSummaries[i]?.summary && segmentSummaries[i]?.complete !== false" class="w-1.5 h-1.5 rounded-full bg-(--color-success-text) shrink-0"
                      title="Đã tóm tắt" />
                    <span v-else-if="segmentSummaries[i]?.summary && segmentSummaries[i]?.complete === false"
                      class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Đã tóm tắt — có thể có bài viết mới" />
                    <span v-else-if="segmentSummaries[i]?.posts?.length" class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                      title="Đã scrape, chưa tóm tắt" />
                  </button>
                </div>
              </div>
            </template>
          </div>

          <!-- Overall summary view -->
          <template v-if="activeSegmentIndex === null">
            <!-- Tóm tắt tab -->
            <!-- Single segment: hiển thị summary trực tiếp -->
            <template v-if="segments.length === 1">
              <div v-if="segmentSummaries[0]?.summary" class="space-y-3">
                <div v-if="modelLabel" class="text-xs text-(--color-text-muted) italic">
                  Tóm tắt bởi {{ modelLabel }}
                </div>
                <SummaryContent :content="segmentSummaries[0].summary" :json="segmentSummaries[0].summaryJson ?? undefined" :topic-url="cachedTopic?.url"
                  :post-page-map="postPageMap" :user-trust-scores="cachedTopic?.userTrustScores" :show-trust-badges="showTrustBadges">
                  <template #actions>
                    <button class="btn btn-ghost btn-sm flex items-center gap-1" :disabled="isProcessing" @click="handleSummarizeSegment(0)">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Tóm tắt lại
                    </button>
                  </template>
                </SummaryContent>
                <!-- Knowledge CTA -->
                <div v-if="allPostsForCTA.length > 0 && !isProcessing" class="flex justify-between">
                  <template v-if="!hasSavedKnowledgeEntries && !hasKnowledgeChunks">
                    <button class="btn-llm" @click="handleKnowledgeCTA('extract')">
                      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
                      </svg>
                      Trích xuất kiến thức
                    </button>
                  </template>
                  <template v-else-if="hasSavedKnowledgeEntries">
                    <span class="text-xs text-(--color-text-secondary)">
                      Đã lưu <strong>{{ savedKnowledgeCount }}</strong> kiến thức.
                    </span>
                    <ForwardLink @click="handleKnowledgeCTA('view')">
                      Xem trong tab Kiến thức
                    </ForwardLink>
                  </template>
                  <template v-else-if="hasKnowledgeChunks">
                    <span class="text-xs text-(--color-text-secondary)">
                      Đã có dữ liệu kiến thức nhưng chưa lưu.
                    </span>
                    <ForwardLink @click="handleKnowledgeCTA('restore')">
                      Khôi phục danh sách
                    </ForwardLink>
                  </template>
                </div>
              </div>
              <div v-else class="flex flex-col items-center space-y-2">
                <p class="text-sm text-(--color-text-secondary)">Chưa có tóm tắt cho thread này.</p>
                <button class="btn-llm" :disabled="isProcessing" @click="handleSummarizeSegment(0)">
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
                  </svg>
                  Tóm tắt
                </button>
              </div>
            </template>

            <!-- Multi-segment: overall summary flow -->
            <template v-else>
              <div v-if="summary" class="space-y-3">
                <div v-if="modelLabel" class="text-xs text-(--color-text-muted) italic">
                  Tóm tắt bởi {{ modelLabel }}
                </div>
                <SummaryContent :content="summary" :json="summaryJson ?? undefined" :topic-url="cachedTopic?.url" :post-page-map="postPageMap" :user-trust-scores="cachedTopic?.userTrustScores" :show-trust-badges="showTrustBadges">
                  <template #actions>
                    <template v-if="segments.length > 1">
                      <button class="btn btn-ghost btn-sm flex items-center gap-1" @click="onAutoSummarizeClick">
                        <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                        </svg>
                        Tóm tắt toàn bộ<template v-if="!currentConfig?.dynamicSegments || dynamicSegmentBoundaries.length > 0"> ({{
                          formatNumber(segments.length)
                        }} phần)</template>
                      </button>
                    </template>
                    <button class="btn btn-ghost btn-sm flex items-center gap-1" :disabled="isProcessing" @click="() => generateOverallSummary()">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Tạo lại tổng quan
                    </button>
                  </template>
                </SummaryContent>
                <!-- Knowledge CTA -->
                <div v-if="allPostsForCTA.length > 0 && !isProcessing" class="flex justify-between">
                  <template v-if="!hasSavedKnowledgeEntries && !hasKnowledgeChunks">
                    <button class="btn-llm" @click="handleKnowledgeCTA('extract')">
                      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
                      </svg>
                      Trích xuất kiến thức
                    </button>
                  </template>
                  <template v-else-if="hasSavedKnowledgeEntries">
                    <span class="text-xs text-(--color-text-secondary)">
                      Đã lưu <strong>{{ savedKnowledgeCount }}</strong> kiến thức.
                    </span>
                    <ForwardLink @click="handleKnowledgeCTA('view')">
                      Xem trong tab Kiến thức
                    </ForwardLink>
                  </template>
                  <template v-else-if="hasKnowledgeChunks">
                    <span class="text-xs text-(--color-text-secondary)">
                      Đã có dữ liệu kiến thức nhưng chưa lưu.
                    </span>
                    <ForwardLink @click="handleKnowledgeCTA('restore')">
                      Khôi phục danh sách
                    </ForwardLink>
                  </template>
                </div>
              </div>
              <div v-else class="flex flex-col items-center space-y-2">
                <p class="text-sm text-(--color-text-secondary)">Chưa có tóm tắt cho thread này.</p>
                <button class="btn-llm" :disabled="isProcessing" @click="handleAutoSummarizeAll()">
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
                  </svg>
                  Tóm tắt toàn bộ
                </button>
                <p class="text-xs text-(--color-text-muted)">Thớt dài, thời gian tóm tắt có thể lâu</p>
              </div>
            </template>

          </template>

          <!-- Individual segment view -->
          <template v-if="activeSegmentIndex !== null">
            <div v-if="segmentSummaries[activeSegmentIndex]?.summary" class="space-y-3">
              <div class="flex items-center justify-start gap-2">
                <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span class="text-xs text-(--color-text-secondary)">{{ formatNumber(segmentSummaries[activeSegmentIndex].postCount) }} bài viết</span>
              </div>
              <SummaryContent :content="segmentSummaries[activeSegmentIndex].summary" :json="segmentSummaries[activeSegmentIndex].summaryJson"
                :topic-url="cachedTopic?.url" :post-page-map="postPageMap" :user-trust-scores="cachedTopic?.userTrustScores" :show-trust-badges="showTrustBadges">
                <template #actions>
                  <button class="btn btn-ghost btn-sm flex items-center gap-1" :disabled="isProcessing" @click="handleSummarizeSegment(activeSegmentIndex)">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Tóm tắt lại phần này
                  </button>
                </template>
              </SummaryContent>
            </div>
            <div v-else class="text-center py-4">
              <button class="btn-llm" :disabled="isProcessing" @click="handleSummarizeSegment(activeSegmentIndex)">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
                </svg>
                Tóm tắt {{ segments[activeSegmentIndex].label }}
              </button>
            </div>
          </template>
        </template>

      </template>
    </template>
  </div>

  <!-- Cost confirm modal for auto-summarize -->
  <CostConfirmModal v-if="showAutoSummarizeModal && estimatedAutoSummarizeCost" title="Tóm tắt tất cả segments" :estimate="estimatedAutoSummarizeCost"
    confirm-text="Tiếp tục từ nơi đã dừng" danger-confirm-text="Tóm tắt lại từ đầu"
    :warning="showAutoSummarizeWarning ? 'Thớt dài, chi phí sẽ cao hơn bình thường.' : undefined"
    @confirm="showAutoSummarizeModal = false; handleAutoSummarizeAll(false)" @danger-confirm="showAutoSummarizeModal = false; handleAutoSummarizeAll(true)"
    @cancel="showAutoSummarizeModal = false" />
</template>
