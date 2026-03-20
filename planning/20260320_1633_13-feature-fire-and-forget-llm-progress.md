# Feature 13: Fire-and-Forget LLM + Progress + Speed Estimation

Ngày: 2026-03-20

---

## Mục tiêu

1. **Fire-and-forget LLM:** Tách message channel khỏi thời gian xử lý LLM → fix timeout cho topic dài
2. **Realtime progress:** Hiển thị tiến trình map-reduce giữa chừng trên tất cả views
3. **Speed estimation:** Đo tốc độ per-model, estimate ETA cho lần gọi tiếp theo

---

## Phân tích hiện trạng

### 4 loại LLM message (tất cả synchronous)

| Message | View | Hàm gọi | Hàm xử lý (summarizer.ts) |
|---------|------|---------|---------------------------|
| `SUMMARIZE` | SummaryView × 3 (full, segment, overall) | `confirmSummarize()`, `handleSummarizeSegment()`, `generateOverallSummary()` | `summarizeTopic()` |
| `SUMMARIZE_INCREMENTAL` | SummaryView × 1 | `confirmSummarize()` | `updateSummary()` |
| `ANALYZE_OPINIONS` | OpinionsView × 1 (via `useLLM`) | `handleAnalyze()` | `analyzeOpinions()` |
| `RESEARCH_QUERY` | ResearchView × 1 | `handleResearch()` | `researchTopic()` |

**Tổng: 6 call sites, 4 message types, 3 views.**

### Map-reduce đã có `onProgress` callback

`summarizer.ts` đã truyền `onProgress` vào các hàm LLM, nhưng **background handler không wire** callback này lên UI:

```ts
// summarizer.ts — đã có sẵn
export async function summarizeTopic(
  posts: ScrapedPost[], config: LLMConfig,
  onProgress?: (msg: string) => void,  // ← CHƯA DÙNG
  customPrompts?: CustomPrompts
)
```

### `useLLM` composable không nhất quán

- OpinionsView dùng `useLLM().analyzeOpinions()`
- SummaryView, ResearchView gọi `sendMessage()` trực tiếp
- Composable chưa hỗ trợ fire-and-forget

---

## Thiết kế mới

### Message flow

```
┌──────────────┐  START_LLM_TASK   ┌─────────────┐
│     View     │ ────────────────→ │  Background  │ ── {started, taskId} ──→ View
│  (sidepanel) │                   │  (service    │
│              │  LLM_PROGRESS     │   worker)    │
│              │ ←──────────────── │              │ ← onProgress callback
│              │                   │              │
│              │  LLM_RESULT       │              │
│              │ ←──────────────── │              │ ← LLM done
└──────────────┘                   └─────────────┘
```

### Payload types mới

```ts
// --- Request ---
interface LLMTaskRequest {
  taskId: string;           // crypto.randomUUID()
  taskType: 'summarize' | 'summarize_incremental' | 'analyze_opinions' | 'research';
  payload: unknown;         // posts, { previousSummary, newPosts }, { posts, question }...
}

// --- Progress (background → sidepanel) ---
interface LLMProgressMessage {
  taskId: string;
  step: number;             // chunk hiện tại (1-based)
  totalSteps: number;       // tổng chunks + reduce step
  message: string;          // "Đang tóm tắt phần 2/4..."
  elapsedMs: number;        // thời gian đã chạy
}

// --- Result (background → sidepanel) ---
interface LLMResultMessage {
  taskId: string;
  taskType: string;
  success: boolean;
  data?: unknown;           // { summary } | { opinions } | { answer }
  error?: string;
  stats: {
    elapsedMs: number;
    inputTokens: number;    // estimate từ token-estimator
    outputTokens: number;   // estimate từ response length
    mapReduceSteps: number; // 1 nếu single-pass, >1 nếu map-reduce
  };
}

// --- Speed stats (lưu trong storage) ---
interface ModelSpeedStats {
  model: string;
  tokensPerSecond: number;  // rolling average
  samples: number;          // số lần đo
  lastUpdated: number;      // timestamp
}
```

---

## Task 1: Type definitions + message types

### File: `lib/types.ts`

**Thêm interfaces:**
- `LLMTaskRequest`, `LLMProgressMessage`, `LLMResultMessage`, `ModelSpeedStats`

**Thêm MessageType:**
```ts
| 'START_LLM_TASK'    // sidepanel → background (fire-and-forget)
| 'LLM_PROGRESS'      // background → sidepanel (push)
| 'LLM_RESULT'        // background → sidepanel (push)
```

**Thêm storage key:**
```ts
STORAGE_KEYS.MODEL_SPEED_STATS = 'model-speed-stats'
```

---

## Task 2: Background handler — fire-and-forget + progress + keepalive

### File: `entrypoints/background/index.ts`

**Thay thế 4 handler cũ** (`SUMMARIZE`, `SUMMARIZE_INCREMENTAL`, `ANALYZE_OPINIONS`, `RESEARCH_QUERY`) bằng **1 handler generic** `START_LLM_TASK`:

```ts
case 'START_LLM_TASK': {
  const { taskId, taskType, payload } = message.payload as LLMTaskRequest;

  // Respond immediately — giải phóng message channel
  sendResponse({ started: true, taskId });

  // Keepalive — prevent service worker termination
  const keepalive = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20_000);

  // Process async
  processLLMTask(taskId, taskType, payload)
    .finally(() => clearInterval(keepalive));

  return true;
}
```

**`processLLMTask()` function:**

```ts
async function processLLMTask(taskId: string, taskType: string, payload: unknown) {
  const startTime = Date.now();
  const config = await getSettings();
  const prompts = await getCustomPrompts();
  let inputTokens = 0;
  let step = 0;
  let totalSteps = 1;

  // onProgress callback — gửi LLM_PROGRESS message
  const onProgress = (msg: string) => {
    step++;
    browser.runtime.sendMessage({
      type: 'LLM_PROGRESS',
      payload: { taskId, step, totalSteps, message: msg, elapsedMs: Date.now() - startTime }
    }).catch(() => {}); // sidepanel có thể đã đóng
  };

  try {
    let result: unknown;

    switch (taskType) {
      case 'summarize': {
        const posts = payload as ScrapedPost[];
        inputTokens = estimateTokens(posts.map(p => p.content).join(''));
        result = { summary: await summarizeTopic(posts, config, onProgress, prompts) };
        break;
      }
      case 'summarize_incremental': {
        const { previousSummary, newPosts } = payload as { previousSummary: string; newPosts: ScrapedPost[] };
        inputTokens = estimateTokens(previousSummary + newPosts.map(p => p.content).join(''));
        result = { summary: await updateSummary(previousSummary, newPosts, config, onProgress, prompts) };
        break;
      }
      case 'analyze_opinions': {
        const posts = payload as ScrapedPost[];
        inputTokens = estimateTokens(posts.map(p => p.content).join(''));
        result = { opinions: await analyzeOpinions(posts, config, onProgress, prompts) };
        break;
      }
      case 'research': {
        const { posts, question } = payload as { posts: ScrapedPost[]; question: string };
        inputTokens = estimateTokens(posts.map(p => p.content).join('') + question);
        result = { answer: await researchTopic(posts, question, config, onProgress, prompts) };
        break;
      }
    }

    const elapsedMs = Date.now() - startTime;
    const outputTokens = estimateTokens(JSON.stringify(result));

    // Gửi kết quả
    browser.runtime.sendMessage({
      type: 'LLM_RESULT',
      payload: {
        taskId, taskType, success: true, data: result,
        stats: { elapsedMs, inputTokens, outputTokens, mapReduceSteps: step || 1 }
      }
    }).catch(() => {});

    // Cập nhật speed stats
    await updateModelSpeedStats(config.model, inputTokens + outputTokens, elapsedMs);

  } catch (err) {
    browser.runtime.sendMessage({
      type: 'LLM_RESULT',
      payload: {
        taskId, taskType, success: false, error: String(err),
        stats: { elapsedMs: Date.now() - startTime, inputTokens, outputTokens: 0, mapReduceSteps: step || 1 }
      }
    }).catch(() => {});
  }
}
```

**`updateModelSpeedStats()` helper:**
```ts
async function updateModelSpeedStats(model: string, totalTokens: number, elapsedMs: number) {
  const key = STORAGE_KEYS.MODEL_SPEED_STATS;
  const stored = await browser.storage.sync.get(key);
  const allStats: Record<string, ModelSpeedStats> = stored[key] || {};

  const current = allStats[model] || { model, tokensPerSecond: 0, samples: 0, lastUpdated: 0 };
  const newTps = totalTokens / (elapsedMs / 1000);

  // Rolling average (weighted: 70% old, 30% new) — ổn định sau vài lần đo
  const weight = Math.min(current.samples, 5);
  current.tokensPerSecond = weight > 0
    ? (current.tokensPerSecond * 0.7 + newTps * 0.3)
    : newTps;
  current.samples++;
  current.lastUpdated = Date.now();

  allStats[model] = current;
  await browser.storage.sync.set({ [key]: allStats });
}
```

**Giữ lại 4 handler cũ** (`SUMMARIZE`, `SUMMARIZE_INCREMENTAL`, `ANALYZE_OPINIONS`, `RESEARCH_QUERY`) trong giai đoạn transition. Đánh dấu deprecated. Xóa sau khi tất cả views migrate xong.

---

## Task 3: `useLLM` composable — rewrite thành fire-and-forget hub

### File: `entrypoints/sidepanel/composables/useLLM.ts`

Rewrite composable thành **trung tâm quản lý** tất cả LLM tasks:

```ts
// State (module-level singleton)
const activeTasks = ref<Map<string, LLMTaskState>>(new Map());
const modelSpeedStats = ref<Record<string, ModelSpeedStats>>({});
let listenerRegistered = false;

interface LLMTaskState {
  taskId: string;
  taskType: string;
  status: 'pending' | 'running' | 'done' | 'error';
  progress: { step: number; totalSteps: number; message: string } | null;
  elapsedMs: number;
  estimatedTotalMs: number;  // ETA dựa trên speed stats
  result: unknown;
  error: string | null;
  stats: LLMResultMessage['stats'] | null;
  onComplete?: (result: LLMResultMessage) => void;  // callback khi xong
}

export function useLLM() {
  // Register listener 1 lần duy nhất
  if (!listenerRegistered) {
    browser.runtime.onMessage.addListener((message) => {
      if (message.type === 'LLM_PROGRESS') handleProgress(message.payload);
      if (message.type === 'LLM_RESULT') handleResult(message.payload);
    });
    listenerRegistered = true;
    loadSpeedStats();
  }

  return {
    startTask,          // generic fire-and-forget
    summarize,          // typed wrapper
    summarizeIncremental,
    analyzeOpinions,
    researchTopic,
    cancelTask,         // (future: abort support)
    getTaskState,       // reactive state cho UI
    activeTasks: readonly(activeTasks),
    modelSpeedStats: readonly(modelSpeedStats),
    getETA,             // estimate ETA dựa trên input tokens + model speed
  };
}
```

**Core methods:**

```ts
async function startTask(
  taskType: LLMTaskRequest['taskType'],
  payload: unknown,
  onComplete?: (result: LLMResultMessage) => void
): Promise<string> {
  const taskId = crypto.randomUUID();

  // Estimate ETA
  const eta = estimateETA(taskType, payload);

  activeTasks.value.set(taskId, {
    taskId, taskType, status: 'running',
    progress: null, elapsedMs: 0,
    estimatedTotalMs: eta,
    result: null, error: null, stats: null,
    onComplete,
  });

  await sendMessage('START_LLM_TASK', { taskId, taskType, payload });
  return taskId;
}

// Typed wrappers trả về Promise resolve khi LLM xong
function summarize(posts: ScrapedPost[]): Promise<LLMResultMessage> {
  return new Promise((resolve, reject) => {
    startTask('summarize', posts, (result) => {
      result.success ? resolve(result) : reject(new Error(result.error));
    });
  });
}

function summarizeIncremental(previousSummary: string, newPosts: ScrapedPost[]): Promise<LLMResultMessage> {
  return new Promise((resolve, reject) => {
    startTask('summarize_incremental', { previousSummary, newPosts }, (result) => {
      result.success ? resolve(result) : reject(new Error(result.error));
    });
  });
}

// Tương tự cho analyzeOpinions, researchTopic...
```

**Progress handler:**

```ts
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
}

function handleResult(payload: LLMResultMessage) {
  const task = activeTasks.value.get(payload.taskId);
  if (!task) return;
  task.status = payload.success ? 'done' : 'error';
  task.result = payload.data;
  task.error = payload.error ?? null;
  task.stats = payload.stats;
  task.elapsedMs = payload.stats.elapsedMs;
  task.onComplete?.(payload);
  // Cleanup sau 5s
  setTimeout(() => activeTasks.value.delete(payload.taskId), 5000);
}
```

**ETA estimation:**

```ts
function getETA(inputTokens: number, model: string): number | null {
  const stats = modelSpeedStats.value[model];
  if (!stats || stats.samples < 1) return null;
  return Math.ceil((inputTokens / stats.tokensPerSecond) * 1000); // ms
}

function estimateETA(taskType: string, payload: unknown): number {
  // Estimate input tokens từ payload
  let text = '';
  if (Array.isArray(payload)) {
    text = payload.map((p: ScrapedPost) => p.content).join('');
  } else if (typeof payload === 'object' && payload !== null) {
    const p = payload as Record<string, unknown>;
    if (p.posts) text = (p.posts as ScrapedPost[]).map(x => x.content).join('');
    if (p.previousSummary) text += p.previousSummary;
    if (p.question) text += p.question;
  }
  const tokens = estimateTokens(text);
  // Lấy model hiện tại từ settings cache
  return getETA(tokens, currentModel.value) ?? tokens * 20; // fallback 20ms/token
}

async function loadSpeedStats() {
  const key = STORAGE_KEYS.MODEL_SPEED_STATS;
  const stored = await browser.storage.sync.get(key);
  modelSpeedStats.value = stored[key] || {};
}
```

---

## Task 4: Component `LLMProgress.vue` — hiển thị progress + ETA

### File: `entrypoints/sidepanel/components/LLMProgress.vue` (TẠO MỚI)

Component dùng chung cho mọi view loading LLM:

```vue
<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';

const props = defineProps<{
  taskId: string | null;
  fallbackMessage?: string;  // "Đang tóm tắt..." khi chưa có progress
}>();

const { getTaskState, modelSpeedStats } = useLLM();

const task = computed(() => props.taskId ? getTaskState(props.taskId) : null);

// Countdown timer — cập nhật mỗi giây
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval>;
watchEffect((onCleanup) => {
  if (task.value?.status === 'running') {
    timer = setInterval(() => { now.value = Date.now(); }, 1000);
    onCleanup(() => clearInterval(timer));
  }
});

const progressPercent = computed(() => {
  if (!task.value?.progress) return null;
  const { step, totalSteps } = task.value.progress;
  return Math.round((step / totalSteps) * 100);
});

const etaDisplay = computed(() => {
  if (!task.value) return null;
  const { estimatedTotalMs, elapsedMs } = task.value;
  if (!estimatedTotalMs) return null;
  const remaining = Math.max(0, estimatedTotalMs - elapsedMs);
  if (remaining < 5000) return 'Sắp xong...';
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return mins > 0 ? `~${mins} phút ${secs}s` : `~${secs}s`;
});
</script>
```

**Template:**
```html
<div class="space-y-2">
  <!-- Message -->
  <p class="text-sm text-[var(--color-text-secondary)]">
    {{ task?.progress?.message || fallbackMessage || 'Đang xử lý...' }}
  </p>

  <!-- Progress bar (chỉ hiện khi có map-reduce steps) -->
  <div v-if="progressPercent !== null" class="w-full bg-[var(--color-bg-tertiary)] rounded-full h-1.5">
    <div
      class="bg-[var(--color-primary)] h-1.5 rounded-full transition-all duration-500"
      :style="{ width: progressPercent + '%' }"
    />
  </div>

  <!-- ETA -->
  <p v-if="etaDisplay" class="text-xs text-[var(--color-text-tertiary)]">
    Ước tính còn {{ etaDisplay }}
  </p>
</div>
```

---

## Task 5: Migrate SummaryView.vue

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**Thay thế 4 chỗ gọi `sendMessage` bằng `useLLM()`:**

**5a. `confirmSummarize()` — SUMMARIZE + SUMMARIZE_INCREMENTAL:**

```ts
// Trước:
loadingText.value = 'Đang tóm tắt...';
const result = await sendMessage<{summary?: string; error?: string}>('SUMMARIZE', posts);
if (result.error) throw new Error(result.error);
const summaryText = result.summary!;

// Sau:
const { summarize, summarizeIncremental } = useLLM();
llmTaskId.value = null;  // ref mới cho LLMProgress component

if (incremental && cachedTopic.value?.summary && newPosts.length > 0) {
  const result = await summarizeIncremental(cachedTopic.value.summary, newPosts);
  summaryText = (result.data as { summary: string }).summary;
  llmTaskId.value = result.taskId;  // (đã done tại thời điểm này)
} else {
  const result = await summarize(posts);
  summaryText = (result.data as { summary: string }).summary;
}
```

**5b. `handleSummarizeSegment()` — SUMMARIZE (segment):**

```ts
// Trước:
loadingText.value = `Đang tóm tắt ${seg.label}...`;
const result = await sendMessage<{summary?: string; error?: string}>('SUMMARIZE', segPosts);

// Sau:
const result = await summarize(segPosts);
const summaryText = (result.data as { summary: string }).summary;
```

**5c. `generateOverallSummary()` — SUMMARIZE (overall):**

```ts
// Tương tự 5b
```

**5d. Template — thay loading spinner:**

```html
<!-- Trước: -->
<LoadingSpinner :text="loadingText" />

<!-- Sau: -->
<LLMProgress v-if="llmTaskId" :task-id="llmTaskId" :fallback-message="loadingText" />
<LoadingSpinner v-else :text="loadingText" />
```

`LLMProgress` hiển thị khi đang chờ LLM. `LoadingSpinner` hiển thị khi đang scraping (trước khi gửi LLM).

---

## Task 6: Migrate OpinionsView.vue

### File: `entrypoints/sidepanel/views/OpinionsView.vue`

Hiện dùng `useLLM().analyzeOpinions()`. Chỉ cần:

1. Thêm `llmTaskId` ref
2. Đổi từ `runAnalysis(posts)` sang composable mới: `analyzeOpinions(posts)` trả `Promise<LLMResultMessage>`
3. Template: thêm `<LLMProgress>` component

```ts
// Trước:
const result = await runAnalysis(cachedTopic.value.posts);

// Sau:
const { analyzeOpinions } = useLLM();
const result = await analyzeOpinions(cachedTopic.value.posts);
opinions.value = result.data as OpinionResult;
llmTaskId.value = result.taskId;
```

---

## Task 7: Migrate ResearchView.vue

### File: `entrypoints/sidepanel/views/ResearchView.vue`

```ts
// Trước:
const result = await sendMessage<{ answer?: string; error?: string }>(
  'RESEARCH_QUERY', { posts: cachedTopic.value.posts, question: q }
);

// Sau:
const { researchTopic: research } = useLLM();
const result = await research(cachedTopic.value.posts, q);
const answer = (result.data as { answer: string }).answer;
```

Thêm `<LLMProgress>` vào template.

---

## Task 8: `summarizer.ts` — bổ sung `totalSteps` cho onProgress

### File: `lib/llm/summarizer.ts`

Hiện `onProgress` chỉ gửi text message, không có step count. Cần bổ sung:

**Đổi signature `onProgress`:**

```ts
// Trước:
onProgress?: (msg: string) => void

// Sau:
onProgress?: (msg: string, step?: number, totalSteps?: number) => void
```

**Trong `summaryChunks()` / `summarizeWithMapReduce()`:**

```ts
// Trước:
onProgress?.(`Đang tóm tắt phần ${i + 1}/${chunks.length}...`);

// Sau:
const total = chunks.length + 1; // +1 for reduce step
onProgress?.(`Đang tóm tắt phần ${i + 1}/${chunks.length}...`, i + 1, total);
```

**Background handler wire `totalSteps`:**

```ts
const onProgress = (msg: string, step?: number, total?: number) => {
  if (total) totalSteps = total;  // cập nhật khi biết chính xác
  browser.runtime.sendMessage({
    type: 'LLM_PROGRESS',
    payload: { taskId, step: step ?? ++stepCount, totalSteps, message: msg, elapsedMs: Date.now() - startTime }
  }).catch(() => {});
};
```

---

## Task 9: Cleanup — xoá handler cũ

Sau khi tất cả views đã migrate:

### File: `entrypoints/background/index.ts`
- Xoá 4 case: `SUMMARIZE`, `SUMMARIZE_INCREMENTAL`, `ANALYZE_OPINIONS`, `RESEARCH_QUERY`
- Chỉ giữ `START_LLM_TASK`

### File: `lib/types.ts`
- Xoá 4 MessageType cũ: `'SUMMARIZE'`, `'SUMMARIZE_INCREMENTAL'`, `'ANALYZE_OPINIONS'`, `'RESEARCH_QUERY'`

### File: `entrypoints/sidepanel/composables/useLLM.ts`
- Xoá code cũ (isLoading, error refs đơn giản)

---

## Tóm tắt thay đổi

| File | Thay đổi |
|------|----------|
| `lib/types.ts` | Thêm 3 MessageType mới + 4 interfaces + 1 storage key |
| `entrypoints/background/index.ts` | Thêm `START_LLM_TASK` handler + `processLLMTask()` + `updateModelSpeedStats()` + keepalive |
| `composables/useLLM.ts` | Rewrite: singleton task manager, listener, typed wrappers, ETA estimation |
| `components/LLMProgress.vue` | TẠO MỚI: progress bar + ETA display |
| `views/SummaryView.vue` | 4 call sites → `useLLM()` wrappers + `<LLMProgress>` |
| `views/OpinionsView.vue` | 1 call site → `useLLM()` wrapper + `<LLMProgress>` |
| `views/ResearchView.vue` | 1 call site → `useLLM()` wrapper + `<LLMProgress>` |
| `lib/llm/summarizer.ts` | `onProgress` thêm `step`, `totalSteps` params |
| Cleanup (cuối) | Xoá 4 handler cũ + 4 MessageType cũ |

---

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. **Normal summarize:** Topic nhỏ → LLM hoàn thành, summary hiện đúng, speed stats được lưu
3. **Map-reduce:** Topic lớn → progress bar cập nhật theo step, ETA countdown
4. **Segment mode:** Tóm tắt segment → progress hiện cho từng segment riêng
5. **Opinions:** Phân tích ý kiến → progress bar + ETA
6. **Research:** Tra cứu → progress bar + ETA
7. **Timeout:** Topic 100+ trang → message channel không timeout (fire-and-forget)
8. **Service worker:** Background không bị kill giữa chừng (keepalive hoạt động)
9. **Speed stats:** Sau 2-3 lần tóm tắt → ETA hiển thị chính xác hơn
10. **Error:** LLM lỗi → error message hiện đúng, không treo loading
11. **Đóng sidepanel giữa chừng:** Background vẫn hoàn thành, `.catch(() => {})` không crash
12. **Mở lại sidepanel:** Nếu topic đã có summary trong cache → hiện kết quả (không mất data)
