import { ref, readonly } from 'vue';
import { sendMessage } from '@/lib/messaging';
import { estimateTokens } from '@/lib/token-estimator';
import { STORAGE_KEYS, FALLBACK_MS_PER_TOKEN, LLM_TASK_CLEANUP_DELAY_MS } from '@/lib/constants';
import type { ScrapedPost, LLMTaskRequest, LLMProgressMessage, LLMResultMessage, ModelSpeedStats, KnowledgeEntry, SummaryJSON, PipelineDefinition } from '@/lib/types';
import { markStepDone, markStepError, markFirstStepRunning } from '@/lib/pipeline-builder';

interface LLMTaskState {
  taskId: string;
  taskType: string;
  status: 'running' | 'done' | 'error';
  progress: { step: number; totalSteps: number; message: string } | null;
  elapsedMs: number;
  estimatedTotalMs: number;
  result: unknown;
  error: string | null;
  stats: LLMResultMessage['stats'] | null;
  pipeline: PipelineDefinition | null;
  onComplete?: (result: LLMResultMessage) => void;
}

// Module-level singleton state
const activeTasks = ref<Map<string, LLMTaskState>>(new Map());
const modelSpeedStats = ref<Record<string, ModelSpeedStats>>({});
const currentModel = ref<string>('');
let listenerRegistered = false;

function handleProgress(payload: LLMProgressMessage) {
  const task = activeTasks.value.get(payload.taskId);
  if (!task) return;
  task.status = 'running';
  task.elapsedMs = payload.elapsedMs;
  task.progress = {
    step: payload.step,
    totalSteps: payload.totalSteps,
    message: payload.message,
  };
  // Initialize pipeline from first progress message
  if (payload.pipeline) {
    task.pipeline = payload.pipeline;
    // Mark first step running so StepTimeline shows active state immediately
    markFirstStepRunning(task.pipeline);
  }
  // Update ETA on the currently running pipeline step (do NOT advance steps —
  // LLM progress step numbers represent map-reduce chunks within a single task,
  // not pipeline flow steps.  Advancing them here causes handleResult to find
  // no running step and throw a TypeError, which silently kills the onComplete
  // callback and hangs the entire summarize flow.)
  // NOTE: Use index access (steps[i]) instead of .find() to get reactive proxy
  // from Vue's array proxy, so etaMs mutation triggers re-render.
  if (task.pipeline) {
    const steps = task.pipeline.steps;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].status === 'running') {
        steps[i].etaMs = task.estimatedTotalMs;
        break;
      }
    }
  }
}

function handleResult(payload: LLMResultMessage) {
  const task = activeTasks.value.get(payload.taskId);
  if (!task) return;
  task.status = payload.success ? 'done' : 'error';
  task.result = payload.data;
  task.error = payload.error ?? null;
  task.stats = payload.stats;
  task.elapsedMs = payload.stats.elapsedMs;
  // Mark all pipeline steps as done on success, or mark current running as error
  if (task.pipeline) {
    const runningStep = task.pipeline.steps.find(s => s.status === 'running');
    if (runningStep) {
      if (payload.success) {
        markStepDone(task.pipeline!, runningStep.id);
      } else {
        markStepError(task.pipeline!, runningStep.id, payload.error ?? undefined);
      }
    }
  }
  task.onComplete?.(payload);
  // Cleanup after 5s so progress display fades naturally
  setTimeout(() => activeTasks.value.delete(payload.taskId), LLM_TASK_CLEANUP_DELAY_MS);
}

async function loadSpeedStats() {
  try {
    const key = STORAGE_KEYS.MODEL_SPEED_STATS;
    const stored = await browser.storage.sync.get([key, STORAGE_KEYS.SETTINGS]);
    if (stored[key]) modelSpeedStats.value = stored[key] as Record<string, ModelSpeedStats>;
    const settings = stored[STORAGE_KEYS.SETTINGS] as { model?: string } | undefined;
    if (settings?.model) currentModel.value = settings.model;
  } catch { /* non-critical */ }
}

function getETA(inputTokens: number, model: string): number | null {
  const stats = modelSpeedStats.value[model];
  if (!stats || stats.samples < 1) return null;
  return Math.ceil((inputTokens / stats.tokensPerSecond) * 1000);
}

function estimateETA(taskType: string, payload: unknown): number {
  let text = '';
  if (Array.isArray(payload)) {
    const firstItem = payload?.[0];
    if (firstItem && typeof firstItem === 'object' && 'content' in firstItem) {
      text = (payload as ScrapedPost[]).map(p => p.content).join('');
    } else if (typeof payload[0] === 'string') { 
      text = (payload as string[]).join('');
    }
  } else if (typeof payload === 'object' && payload !== null) {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.posts)) text = (p.posts as ScrapedPost[]).map((x: ScrapedPost) => x.content).join('');
    if (typeof p.previousSummary === 'string') text += p.previousSummary;
    if (typeof p.question === 'string') text += p.question;
    if (Array.isArray(p.newPosts)) text += (p.newPosts as ScrapedPost[]).map((x: ScrapedPost) => x.content).join('');
  }
  const tokens = estimateTokens(text);
  return getETA(tokens, currentModel.value) ?? tokens * FALLBACK_MS_PER_TOKEN; // fallback ms/token
}

/**
 * Start a fire-and-forget LLM task.
 * Returns the taskId synchronously; fires the message in background.
 */
function startTask(
  taskType: LLMTaskRequest['taskType'],
  payload: unknown,
  onComplete?: (result: LLMResultMessage) => void,
): string {
  const taskId = crypto.randomUUID();
  const eta = estimateETA(taskType, payload);

  activeTasks.value.set(taskId, {
    taskId, taskType, status: 'running',
    progress: null, elapsedMs: 0,
    estimatedTotalMs: eta,
    result: null, error: null, stats: null,
    pipeline: null,
    onComplete,
  });

  // Fire-and-forget — sendMessage returns quickly because background responds with {started: true}
  sendMessage('START_LLM_TASK', { taskId, taskType, payload } as LLMTaskRequest)
    .catch((err) => {
      const task = activeTasks.value.get(taskId);
      if (task) {
        task.status = 'error';
        task.error = String(err);
        task.onComplete?.({
          taskId, taskType, success: false, error: String(err),
          stats: { elapsedMs: 0, inputTokens: 0, outputTokens: 0, mapReduceSteps: 0 },
        });
      }
    });

  return taskId;
}

function getTaskState(taskId: string): LLMTaskState | undefined {
  return activeTasks.value.get(taskId);
}

/** Factory: wraps startTask with a Promise that resolves/rejects when the LLM task completes */
function createTask<TPayload>(
  taskType: LLMTaskRequest['taskType'],
  payload: TPayload,
): { taskId: string; result: Promise<LLMResultMessage> } {
  let resolve!: (r: LLMResultMessage) => void;
  let reject!: (e: Error) => void;
  const result = new Promise<LLMResultMessage>((res, rej) => { resolve = res; reject = rej; });
  const taskId = startTask(taskType, payload, (r) => {
    r.success ? resolve(r) : reject(new Error(r.error ?? 'LLM error'));
  });
  return { taskId, result };
}

function summarize(posts: ScrapedPost[]) { return createTask('summarize', posts); }

function researchTopic(posts: ScrapedPost[], question: string) {
  return createTask('research', { posts, question });
}

function summarizeSegmentsTask(segmentSummaries: string[]) {
  return createTask('summarize_segments', segmentSummaries);
}

function extractKnowledgeChunkTask(posts: ScrapedPost[], title: string, mode: 'extract' | 'chunk' = 'chunk') {
  return createTask('extract_knowledge_chunk', { posts, title, mode });
}

function reduceKnowledgeChunksTask(partialEntries: KnowledgeEntry[][], entryCap?: number) {
  return createTask('reduce_knowledge_chunks', { partialEntries, entryCap });
}

function threadAnalysisTask(summaryJson: SummaryJSON, meta: { title: string; totalPages: number; totalPosts: number }) {
  return createTask('thread_analysis', { summaryJson, meta });
}

function cancelTask(taskId: string) {
  sendMessage('CANCEL_LLM_TASK', { taskId }).catch(() => {});
}

export function useLLM() {
  if (!listenerRegistered) {
    browser.runtime.onMessage.addListener((message: { type: string; payload: unknown }) => {
      if (message.type === 'LLM_PROGRESS') handleProgress(message.payload as LLMProgressMessage);
      if (message.type === 'LLM_RESULT') handleResult(message.payload as LLMResultMessage);
    });
    listenerRegistered = true;
    loadSpeedStats();
  } else {
    // Refresh current model on each call — stays accurate after user changes Settings
    browser.storage.sync.get(STORAGE_KEYS.SETTINGS).then((r) => {
      const s = r[STORAGE_KEYS.SETTINGS] as { model?: string } | undefined;
      if (s?.model) currentModel.value = s.model;
    }).catch(() => {});
  }

  return {
    startTask,
    summarize,
    summarizeSegmentsTask,
    researchTopic,
    extractKnowledgeChunkTask,
    reduceKnowledgeChunksTask,
    threadAnalysisTask,
    cancelTask,
    getTaskState,
    getETA,
    activeTasks: readonly(activeTasks),
    modelSpeedStats: readonly(modelSpeedStats),
  };
}
