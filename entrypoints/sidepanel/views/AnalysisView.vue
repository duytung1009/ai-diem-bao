<script setup lang="ts">
import { onActivated, computed, ref, onMounted } from 'vue';
import { useTopicStore } from '../composables/useTopicStore';
import { sendMessage } from '@/lib/messaging';
import type { CachedTopic, ThreadAnalysisJSON } from '@/lib/types';
import { useThreadAnalysis } from '../composables/useThreadAnalysis';
import { useSeederDetection } from '../composables/useSeederDetection';
import type { PipelineDefinition } from '@/lib/types';
import { safeFilename } from '@/lib/exporter';
import ErrorDisplay from '../components/ErrorDisplay.vue';
import ThreadAnalysisContent from '../components/ThreadAnalysisContent.vue';
import ContentActions from '../components/ContentActions.vue';
import StepTimeline from '../components/StepTimeline.vue';
import BackButton from '../components/BackButton.vue';
import EmptyState from '../components/EmptyState.vue';
import OperationConflictAlert from '../components/OperationConflictAlert.vue';

const store = useTopicStore();
const { threadAnalysis, isAnalyzing, error, hasSummary, llmTaskId, generateAnalysis, getTaskState, cancelTask } = useThreadAnalysis(store);
const { showTrustBadges, loadSetting: loadSeederSetting } = useSeederDetection();

onMounted(() => { loadSeederSetting().catch(() => {}); });

const cachedTopic = computed(() => store.selectedTopic.value);

function heatIcon(heat: string) {
  if (heat === 'high' || heat === 'hot') return '🔥';
  if (heat === 'medium' || heat === 'normal') return '🧠';
  return '💬';
}
function heatLabel(heat: string) {
  if (heat === 'hot' || heat === 'high') return 'Nóng bỏng';
  if (heat === 'normal' || heat === 'medium') return 'Vừa phải';
  return 'Nhẹ nhàng';
}
function commentIcon(type: string) {
  if (type === 'defining') return '🔥';
  if (type === 'insightful') return '🧠';
  return '😂';
}
function formatAnalysisAsText(a: ThreadAnalysisJSON, title: string, totalPages: number): string {
  const lines: string[] = [];
  lines.push(`# PHÂN TÍCH THREAD: ${title}`, `(${totalPages} trang)`, '');
  lines.push('## 1. TỔNG QUAN');
  lines.push(`Độ nóng: ${heatLabel(a.overview.heat)}`, `Mâu thuẫn chính: ${a.overview.coreConflict}`, 'Fact quan trọng:');
  for (const fact of a.overview.keyFacts) lines.push(`  - ${fact}`);
  if (a.overview?.misconception) lines.push(`VOZ hiểu sai: ${a.overview.misconception}`);
  lines.push('');
  lines.push('## 2. USER TIÊU BIỂU');
  for (const p of a.userProfiles) {
    lines.push(`### ${p.role}`, p.description, `Nhận xét: ${p.note}`, `Quote: '${p.quote}'`, '');
  }
  lines.push('## 3. LUỒNG TRANH LUẬN');
  for (const s of a.debateStreams) lines.push(`${heatIcon(s.heat)} ${s.title}`, s.description, '');
  lines.push('## 4. COMBAT TIÊU BIỂU');
  for (const c of a.combats) lines.push(`### ${c.title}`, `Phe A: ${c.sideA}`, `Phe B: ${c.sideB}`, `Nhận xét: ${c.note}`, '');
  lines.push('## 5. TIMELINE');
  for (const ph of a.timeline) {
    lines.push(`### ${ph.name} (${ph.pageRange})`);
    for (const ev of ph.events) lines.push(`  - ${ev}`);
    lines.push('');
  }
  lines.push('## 6. COMMENT NỔI BẬT');
  for (const c of a.notableComments) lines.push(`${commentIcon(c.type)} [${c.author}]: ${c.text}`, '');
  lines.push('## 7. KẾT LUẬN');
  for (const item of a.conclusion.breakdown) lines.push(`  ${item.label}: ${item.percent}%`);
  lines.push(`Góc nhìn hệ thống: ${a.conclusion.insightPolicy}`, `Phản ứng VOZ: ${a.conclusion.insightPublic}`, `Tổng kết: ${a.conclusion.finalNote}`, '');
  lines.push('## 8. KIẾM HIỆP', a.wuxia);
  return lines.join('\n');
}
const loadedTopicUrl = ref<string | null>(null);
const loadedTopicTitle = ref('');
const pendingConflict = ref<{ newUrl: string; newTitle: string } | null>(null);

const activePipeline = computed<PipelineDefinition | null>(() => {
  if (!llmTaskId.value) return null;
  return getTaskState(llmTaskId.value)?.pipeline ?? null;
});

onActivated(() => {
  const url = store.selectedTopic.value?.url;
  if (!url) return;

  // Show conflict alert if analyzing for a different topic
  if (isAnalyzing.value && loadedTopicUrl.value && url !== loadedTopicUrl.value) {
    pendingConflict.value = { newUrl: url, newTitle: store.selectedTopic.value?.title ?? '...' };
    return;
  }

  loadedTopicUrl.value = url;
  loadedTopicTitle.value = store.selectedTopic.value?.title ?? '';
});

function handleConflictCancel() {
  if (llmTaskId.value) cancelTask(llmTaskId.value);
  isAnalyzing.value = false;
  llmTaskId.value = null;
  pendingConflict.value = null;
  loadedTopicUrl.value = store.selectedTopic.value?.url ?? null;
  loadedTopicTitle.value = store.selectedTopic.value?.title ?? '';
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
    <EmptyState v-if="!cachedTopic" icon="🧵" title="Chưa chọn thớt">
      <template #action>
        <BackButton />
      </template>
    </EmptyState>

    <template v-else>
      <div class="flex items-center justify-between">
        <BackButton />
        <h2 class="section-heading">Phân tích thớt</h2>
      </div>

      <OperationConflictAlert
        v-if="pendingConflict"
        operation="phân tích thớt"
        :oldTopicTitle="loadedTopicTitle"
        :newTopicTitle="pendingConflict.newTitle"
        @cancel="handleConflictCancel"
        @goBack="handleConflictGoBack"
      />

      <template v-if="!pendingConflict">
        <StepTimeline v-if="isAnalyzing && activePipeline" :pipeline="activePipeline" :show-cancel="true" @cancel="cancelTask(llmTaskId!)" />

        <div v-if="!hasSummary" class="alert alert-warning text-xs">
          Chưa có dữ liệu của thớt. Vui lòng tóm tắt thớt ở tab "Tóm tắt" trước.
        </div>

        <template v-else>
          <ErrorDisplay v-if="error" :message="error" />

          <template v-if="threadAnalysis">
            <ContentActions
              :model-label="cachedTopic?.llmConfig?.model ? `Phân tích bởi ${cachedTopic.llmConfig.model}` : undefined"
              :copy-content="formatAnalysisAsText(threadAnalysis, cachedTopic!.title, cachedTopic!.totalPages)"
              :export-topic="(cachedTopic as unknown as CachedTopic)"
              :json-data="threadAnalysis"
              :json-filename="`${safeFilename(cachedTopic!.title)}_analysis.json`"
              :reload-label="isAnalyzing ? 'Đang phân tích...' : 'Phân tích lại'"
              :reload-disabled="isAnalyzing"
              :on-reload="generateAnalysis"
            ></ContentActions>
            <ThreadAnalysisContent :analysis="threadAnalysis" :thread-title="cachedTopic.title" :total-pages="cachedTopic.totalPages" :user-trust-scores="cachedTopic?.userTrustScores" :show-trust-badges="showTrustBadges" />
          </template>

          <div v-else-if="!isAnalyzing" class="flex flex-col items-center space-y-2">
            <button class="btn-llm" @click="generateAnalysis">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
              </svg>
              {{ 'Phân tích thớt' }}
            </button>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
