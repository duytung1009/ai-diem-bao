<script setup lang="ts">
import { ref, computed, onMounted, onActivated } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage } from '@/lib/messaging';
import { isSameTopicUrl } from '@/lib/cache-manager';
import type { LLMConfig, CachedTopic, TopReactItem, SummaryJSON } from '@/lib/types';
import { computeTopReacts } from '@/lib/top-reacts';
import { calculateSegmentBudget, estimateTokens } from '@/lib/token-estimator';
import { SUMMARY_PROMPT } from '@/lib/prompts';
import type { CostEstimate } from '@/lib/types';
import { estimateAutoSummarizeCostFromSegments } from '@/lib/llm/cost-estimator';
import { LLM_WARN_THRESHOLD_CALLS } from '@/lib/constants';
import { formatNumber } from '@/lib/format';
import { getModelMaxOutput } from '@/lib/token-estimator';
import CostConfirmModal from '../components/CostConfirmModal.vue';
import ContentActions from '../components/ContentActions.vue';
import { useTopicStore } from '../composables/useTopicStore';
import { useSummarize } from '../composables/useSummarize';
import { useAlertSettings } from '../composables/useAlertSettings';

const { hideInfoAlerts, hideWarningAlerts } = useAlertSettings();
import ProgressIndicator from '../components/ProgressIndicator.vue';
import StepTimeline from '../components/StepTimeline.vue';
import SummaryContent from '../components/SummaryContent.vue';
import SegmentGrid from '../components/SegmentGrid.vue';
import type { SegmentGridItem } from '../components/SegmentGrid.vue';
import { deriveSummarySegmentStatus } from '@/lib/segment-grid-status';
import ErrorDisplay from '../components/ErrorDisplay.vue';
import BackButton from '../components/BackButton.vue';
import EmptyState from '../components/EmptyState.vue';
import ForwardLink from '../components/ForwardLink.vue';
import OperationConflictAlert from '../components/OperationConflictAlert.vue';

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
  segmentSize, segmentSummaries, runningSegmentIndex, segmentErrors,
  loadedTopicUrl, dynamicSegmentBoundaries,
  topicInfo, isProcessing,
  isSegmentMode, segments,
  summarizedCount, progressPercent, nextPendingSegmentIndex,
  loadTopicData, handleCancel,
  handleSummarizeSegment, generateOverallSummary, handleSegmentUpdate, handleAutoSummarizeAll,
  hasPartialScrape,
  pendingPermissionOrigin, handleGrantPermission,
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
const segmentGridPreviewIndex = ref<number | null>(null);
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

// F44: map segments + per-segment summary/error/running state → generic SegmentGrid items
const summaryGridItems = computed<SegmentGridItem[]>(() =>
  segments.value.map((seg, i) => {
    const ss = segmentSummaries.value[i];
    return {
      index: i,
      label: `Trang ${seg.label}`,
      meta: ss?.postCount ? `· ${formatNumber(ss.postCount)} bài` : undefined,
      status: deriveSummarySegmentStatus({
        running: runningSegmentIndex.value === i,
        error: Boolean(segmentErrors.value[i]),
        hasSummary: Boolean(ss?.summary),
        complete: ss?.complete,
      }),
    };
  }),
);

const summaryHeaderLabel = computed(
  () => `${formatNumber(summarizedCount.value)} / ${formatNumber(segments.value.length)} đoạn đã tóm tắt`,
);

function formatSummaryMD(text: string, json?: SummaryJSON | null): string {
  if (!json) return text;
  const lines: string[] = [];
  lines.push('## Tóm tắt', json.summary, '');
  if (json.opinions?.length) {
    lines.push('## Quan điểm nổi bật');
    for (const op of json.opinions) {
      lines.push(`### ${op.title}`);
      if (Array.isArray(op.supporters) && op.supporters.length) lines.push(`Ủng hộ: ${op.supporters.join(', ')}`);
      lines.push(op.description);
      if (op.quotes?.length) {
        for (const q of op.quotes) lines.push(`> '${q.text}' — ${q.author} (#${q.postNumber})`);
      }
      lines.push('');
    }
  }
  if (json.conclusion) lines.push('## Kết luận', json.conclusion);
  return lines.join('\n');
}
const newPostCount = computed(() => {
  const topic = cachedTopic.value;
  if (!topic) return 0;
  const totalRef = topic.forumPostCount ?? topic.totalPosts ?? 0;
  const summarized = topic.summarizedPostCount ?? topic.totalPosts ?? 0;
  return Math.max(0, totalRef - summarized);
});

const hasKnowledgeChunks = computed(() => (cachedTopic.value?.knowledgeChunks?.length ?? 0) > 0);
const savedKnowledgeCount = computed(() => cachedTopic.value?.knowledgeEntries?.length ?? 0);
const allPostsForCTA = computed(() => {
  if (!cachedTopic.value) return [];
  return cachedTopic.value.posts?.length ? cachedTopic.value.posts : cachedTopic.value.segments?.flatMap(s => s?.posts ?? []) ?? [];
});

function handleKnowledgeCTA(action: 'extract' | 'view') {
  if (action === 'extract') {
    // Segment-mode topics: navigate to knowledge tab so user uses the segment grid.
    // Legacy (non-segment) topics: ?extract=true triggers handleExtract automatically.
    if (cachedTopic.value?.segments?.length) {
      router.push('/knowledge');
    } else {
      router.push('/knowledge?extract=true');
    }
  } else {
    router.push('/knowledge');
  }
}

const modelLabel = computed(() => {
  const cfg = cachedTopic?.value?.llmConfig;
  if (!cfg?.provider || !cfg?.model) return null;
  return `${cfg.provider}: ${cfg.model}`;
});

const topReacts = computed<TopReactItem[]>(() => {
  const topic = cachedTopic?.value;
  if (!topic) return [];
  const posts = (topic.posts.length ? topic.posts : topic.segments?.flatMap((s) => s?.posts ?? []) ?? []) as import('@/lib/types').ScrapedPost[];
  return computeTopReacts(posts, 3);
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
    <EmptyState v-if="!topicInfo" icon="🧵" title="Chưa chọn thớt">
      <template #action>
        <BackButton />
      </template>
    </EmptyState>

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

        <!-- Error -->
        <ErrorDisplay v-if="error" :message="error" action="none" />

        <!-- Permission prompt -->
        <div v-if="pendingPermissionOrigin" class="alert alert-warning text-xs flex items-center justify-between gap-2 mt-2">
          <span>Cần cấp quyền truy cập <strong class="text-(--color-text-primary)">{{ pendingPermissionOrigin }}</strong> để tải nội dung từ forum này.</span>
          <button class="btn btn-accent btn-xs shrink-0" @click="handleGrantPermission()">Cấp quyền</button>
        </div>

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
        <template v-if="isSegmentMode">
          <!-- Banners + update button: chỉ hiển thị khi không đang xử lý -->
          <template v-if="!isProcessing">
            <!-- Info banner: chỉ hiển thị khi > 1 segment -->
            <div v-if="segments.length > 1 && !hideInfoAlerts" class="text-xs alert alert-info">
              <p class="font-medium">Thớt dài ({{ formatNumber(topicInfo!.pageCount) }} trang)</p>
              <p v-if="currentConfig?.dynamicSegments" class="mt-0.5">Chia thành {{ formatNumber(segments.length) }} phần theo độ dài nội dung. Tóm tắt từng phần
                rồi tạo tổng quan.</p>
              <p v-else class="mt-0.5">Chia thành {{ formatNumber(segments.length) }} phần, mỗi phần ~{{ formatNumber(segmentSize) }} trang. Tóm tắt từng phần rồi
                tạo tổng quan.</p>
            </div>

            <!-- Resume banner: partial scrape detected from previous interrupted run -->
            <div v-if="hasPartialScrape && !summary" class="text-xs alert alert-warning flex items-center justify-between">
              <div>
                <p class="font-medium">Đã scrape {{ formatNumber(cachedTopic!.posts.length) }} bài viết ({{ formatNumber(cachedTopic!.lastScrapedPage!) }}/{{ formatNumber(topicInfo!.pageCount) }} trang)</p>
                <p class="mt-0.5">Có thể tiếp tục scrape từ trang {{ formatNumber(cachedTopic!.lastScrapedPage! + 1) }}</p>
              </div>
              <button class="btn-llm btn-sm shrink-0" @click="handleAutoSummarizeAll()">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                Tiếp tục
              </button>
            </div>

            <button v-if="summary && cacheFreshness && cacheFreshness !== 'fresh' && newPostCount > 0" class="btn-llm" @click="handleSegmentUpdate">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
              </svg>
              Cập nhật
              <span v-if="newPostCount > 0">(+{{ formatNumber(newPostCount) }})</span>
            </button>
          </template>

          <!-- F44: Segment grid (chỉ khi > 1 segment) — luôn hiển thị kể cả khi đang xử lý -->
          <SegmentGrid
            v-if="segments.length > 1"
            v-model:expanded="segmentGridExpanded"
            v-model:expandedIndex="segmentGridPreviewIndex"
            :items="summaryGridItems"
            :header-label="summaryHeaderLabel"
            :progress-percent="progressPercent"
          >
            <template #header-actions>
              <!-- Đang xử lý: hiện trạng thái loading + Hủy (giống KnowledgeView) -->
              <template v-if="isProcessing">
                <svg class="w-3.5 h-3.5 animate-spin text-(--color-accent)" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span class="text-xs text-(--color-text-muted)">Đang tóm tắt...</span>
                <button class="btn text-xs text-(--color-error-text)" @click="handleCancel">Hủy</button>
              </template>
              <button v-else class="btn text-xs" @click="onAutoSummarizeClick">
                Tóm tắt tất cả
              </button>
            </template>
            <template #preview="{ item }">
              <SummaryContent
                v-if="segmentSummaries[item.index]?.summary"
                :content="segmentSummaries[item.index]?.summary ?? ''"
                :json="segmentSummaries[item.index]?.summaryJson ?? undefined"
                :topic-url="cachedTopic?.url"
                :post-page-map="postPageMap"
                :top-reacts="topReacts"
                :user-trust-scores="cachedTopic?.userTrustScores"
                :show-trust-badges="showTrustBadges"
              />
              <span v-else class="text-xs text-(--color-text-muted)">Chưa có tóm tắt</span>
            </template>
            <template #row-actions="{ item }">
              <button v-if="item.status === 'running'"
                class="text-xs font-medium shrink-0 link" @click.stop="handleCancel">
                Hủy
              </button>
              <button v-else-if="item.status === 'error'"
                class="text-xs font-medium shrink-0 link text-(--color-error-text) disabled:cursor-not-allowed disabled:text-(--color-text-muted)"
                :disabled="isProcessing" @click.stop="handleSummarizeSegment(item.index)">
                Thử lại
              </button>
              <button v-else-if="item.status === 'pending'"
                class="text-xs font-medium shrink-0 link disabled:cursor-not-allowed disabled:text-(--color-text-muted)"
                :disabled="isProcessing" @click.stop="handleSummarizeSegment(item.index)">
                Tóm tắt
              </button>
              <button v-else
                class="text-xs font-medium shrink-0 link disabled:cursor-not-allowed disabled:text-(--color-text-muted)"
                :disabled="isProcessing" @click.stop="handleSummarizeSegment(item.index)">
                Tóm tắt lại
              </button>
            </template>
          </SegmentGrid>

          <!-- Overall summary view -->
          <!-- Single segment: hiển thị summary trực tiếp -->
          <template v-if="segments.length === 1">
              <div v-if="segmentSummaries[0]?.summary" class="space-y-3">
                <ContentActions
                  :model-label="modelLabel ? `Tóm tắt bởi ${modelLabel}` : undefined"
                  :copy-content="formatSummaryMD(segmentSummaries[0]?.summary ?? '', segmentSummaries[0]?.summaryJson ?? null)"
                  :export-topic="cachedTopic as unknown as CachedTopic"
                  reload-label="Tóm tắt lại"
                  :reload-disabled="isProcessing"
                  :on-reload="() => handleSummarizeSegment(0)"
                ></ContentActions>
                <SummaryContent :content="segmentSummaries[0].summary" :json="segmentSummaries[0].summaryJson ?? undefined" :topic-url="cachedTopic?.url"
                  :post-page-map="postPageMap" :top-reacts="topReacts" :user-trust-scores="cachedTopic?.userTrustScores" :show-trust-badges="showTrustBadges" />

                <!-- Knowledge CTA -->
                <div v-if="allPostsForCTA.length > 0 && !isProcessing" class="flex justify-between">
                  <template v-if="!hasKnowledgeChunks">
                    <button class="btn-llm" @click="handleKnowledgeCTA('extract')">
                      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
                      </svg>
                      Trích xuất kiến thức
                    </button>
                  </template>
                </div>
              </div>
              <div v-if="!isProcessing && !segmentSummaries[0]?.summary" class="flex flex-col items-center space-y-2">
                <button class="btn-llm" @click="handleSummarizeSegment(0)">
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
                <ContentActions
                  :model-label="modelLabel ? `Tóm tắt bởi ${modelLabel}` : undefined"
                  :copy-content="formatSummaryMD(summary ?? '', summaryJson ?? null)"
                  :export-topic="cachedTopic as unknown as CachedTopic"
                  reload-label="Tạo lại tổng quan"
                  :reload-disabled="isProcessing"
                  :on-reload="() => generateOverallSummary()"
                ></ContentActions>
                <SummaryContent :content="summary" :json="summaryJson ?? undefined" :topic-url="cachedTopic?.url" :post-page-map="postPageMap" :top-reacts="topReacts" :user-trust-scores="cachedTopic?.userTrustScores" :show-trust-badges="showTrustBadges" />
                <!-- Knowledge CTA -->
                <div v-if="allPostsForCTA.length > 0 && !isProcessing" class="flex justify-between">
                  <template v-if="!hasKnowledgeChunks">
                    <button class="btn-llm" @click="handleKnowledgeCTA('extract')">
                      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
                      </svg>
                      Trích xuất kiến thức
                    </button>
                  </template>
                </div>
              </div>
              <div v-if="!isProcessing && !summary" class="flex flex-col items-center space-y-2">
                <button class="btn-llm" @click="handleAutoSummarizeAll()">
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
                  </svg>
                  Tóm tắt toàn bộ
                </button>
              </div>
          </template>
        </template>

        <!-- Loading + Cancel -->
        <StepTimeline v-if="isProcessing && activePipeline" :pipeline="activePipeline" :show-cancel="isProcessing" @cancel="handleCancel" />

        <ProgressIndicator v-else-if="isProcessing" :task-id="llmTaskId" :scrape-progress="scrapeProgress"
          :scrape-delay-ms="currentConfig?.scrapeDelayMs ?? 2000" :message="simpleLoadingText || undefined" fallback-message="Đang tóm tắt..."
          :show-cancel="isProcessing" @cancel="handleCancel" />

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
