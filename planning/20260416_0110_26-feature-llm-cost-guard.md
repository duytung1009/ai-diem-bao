# F26 — LLM Cost Guard: Cảnh báo chi phí + Cancel thực sự + Pause/Resume

**Ngày:** 2026-04-16  
**Feature số:** 26  
**Tier:** Tier 3 (cross-module, architecture impact)  
**Model:** Sonnet implement; Opus review

---

## Objective & Scope

Ngăn user vô tình trigger quá nhiều API call khi tóm tắt/trích xuất kiến thức từ topic lớn.

**Vấn đề hiện tại:**
1. Không có cảnh báo trước khi bắt đầu tác vụ tốn kém (nhiều segments, nhiều chunks)
2. `handleCancel()` chỉ abort scraping — LLM call đang chạy vẫn tiếp tục đến timeout 120s
3. Không có pause/resume — cancel = mất toàn bộ progress

**Phạm vi F26:**
- **Phase A** — Warning + Cost Estimate (Tier 2, Sonnet)
- **Phase B** — True LLM Cancel (Tier 2-3, Sonnet)
- **Phase C** — Pause/Resume (Tier 3, tách planning riêng nếu cần)

---

## Danh sách tất cả LLM Entry Points

| # | Hàm / Trigger | File | Loại tác vụ | Cost Factor | Cancel hiện tại |
|---|---------------|------|-------------|-------------|-----------------|
| 1 | `handleSummarizeSegment()` | useSummarize.ts | Tóm tắt 1 segment | 1+ calls (map-reduce nếu segment lớn) | Invalidate via `activeSummarizeId++` |
| 2 | `handleAutoSummarizeAll()` | useSummarize.ts | Tóm tắt toàn bộ topic | N segments × (1+ calls) + log(N) reduce | Invalidate + abort scraping |
| 3 | `generateOverallSummary()` | useSummarize.ts | Tổng hợp từ các segment | O(log N) tree-reduce calls | Invalidate only |
| 4 | `handleGenerateAnalysis()` | useSummarize.ts | Phân tích thread | 1 call | Invalidate only |
| 5 | `handleResearch()` | ResearchView.vue | Nghiên cứu câu hỏi | 1 call (1+ nếu context lớn) | Không có |
| 6 | `handleExtract()` | KnowledgeView.vue | Trích xuất kiến thức | K chunks + 1 reduce | Invalidate via `activeExtractId++` |
| 7 | `analyzeOpinions` (auto) | useSummarize.ts | Phân tích ý kiến | 1 call (1+ nếu context lớn) | Không có |

**Entry points cần cảnh báo** (cost > 1 call tiềm năng): #1, #2, #3, #6  
**Entry points cần warning nhẹ** (có thể 1-3 calls): #5, #7  
**Entry points luôn 1 call, không cần warn**: #4

---

## Phase A — Warning + Cost Estimate

### A1. Cost Estimation Logic

Tạo `lib/llm/cost-estimator.ts`:

```typescript
/**
 * Ước tính số API call cho auto-summarize toàn bộ.
 * @param totalPages  - tổng số trang topic
 * @param budgetTokens - token budget per segment (từ calculateSegmentBudget)
 * @param avgTokensPerPage - ước tính (default 3000)
 */
export function estimateAutoSummarizeCalls(
  totalPages: number,
  budgetTokens: number,
  avgTokensPerPage = 3000,
): number {
  const pagesPerSegment = Math.max(1, Math.floor(budgetTokens / avgTokensPerPage));
  const segmentCount = Math.ceil(totalPages / pagesPerSegment);
  // Tree-reduce: ceil(log2(segmentCount)) levels, mỗi level N/group calls
  const reduceCalls = segmentCount > 1 ? Math.ceil(Math.log2(segmentCount)) : 0;
  return segmentCount + reduceCalls;
}

/**
 * Ước tính số API call cho knowledge extraction.
 * Dùng planKnowledgeChunks() nếu đã có posts; fallback estimate nếu chưa scrape.
 */
export function estimateExtractCalls(
  chunkCount: number, // từ planKnowledgeChunks().length
): number {
  return chunkCount + (chunkCount > 1 ? 1 : 0); // chunks + 1 reduce
}

export function estimateSummarizeSegmentCalls(chunksNeeded: number): number {
  return chunksNeeded + (chunksNeeded > 1 ? 1 : 0);
}
```

### A2. Ngưỡng cảnh báo

Thêm vào `lib/constants.ts`:
```typescript
export const LLM_WARN_THRESHOLD_CALLS = 5; // warn nếu estimated calls > 5
```

Không thêm vào Settings để đơn giản. Có thể mở rộng sau.

### A3. Warning UI

**Cho `handleAutoSummarizeAll()`:**  
Hiện tại đã có `confirmingAutoSummarize` pattern (inline confirm). Mở rộng:
- Tính `estimatedCalls = estimateAutoSummarizeCalls(totalPages, budget)`  
- Nếu `estimatedCalls > LLM_WARN_THRESHOLD_CALLS`: hiển thị cảnh báo trong confirm box
- Format: `"⚠️ Topic này ước tính cần ~{N} API calls. Chi phí có thể cao."`

**Cho `handleExtract()` trong KnowledgeView:**  
- Nếu `cachedTopic.posts` tồn tại: dùng `planKnowledgeChunks()` để tính exact chunks
- Nếu chưa có posts (chưa scrape): hiển thị `"Topic {N} trang — trích xuất có thể tốn nhiều API call."`
- Thêm `confirmingExtract: Ref<boolean>` vào KnowledgeView
- Nếu estimated > threshold: chuyển sang state xác nhận trước khi extract

**Cho `handleSummarizeSegment()` (single segment map-reduce):**  
- Tính `chunksNeeded` từ `willExceedContext()`
- Nếu `chunksNeeded > 3`: thêm note nhỏ "Segment lớn, sẽ dùng {N} API calls"
- Không block — chỉ informational, hiển thị trong progress text đầu tiên

### A4. Affected files (Phase A)

- `lib/llm/cost-estimator.ts` — NEW: estimation functions
- `lib/constants.ts` — thêm `LLM_WARN_THRESHOLD_CALLS`
- `entrypoints/sidepanel/composables/useSummarize.ts` — extend confirm box
- `entrypoints/sidepanel/views/KnowledgeView.vue` — thêm confirm before extract
- `entrypoints/sidepanel/views/SummaryView.vue` — hiển thị cảnh báo trong confirm UI

---

## Phase B — True LLM Cancel

### B1. Vấn đề kiến trúc hiện tại

Background worker dùng fire-and-forget: `processLLMTask()` chạy async, gửi `LLM_RESULT` khi xong.  
Không có cơ chế cancel — `activeSummarizeId++` chỉ ngăn **orchestration layer** tiếp tục, nhưng in-flight LLM `fetch()` vẫn chạy đến 120s timeout.

### B2. Solution: AbortController chain

```
useLLM.cancelTask(taskId)
  → sendMessage('CANCEL_LLM_TASK', { taskId })
    → background: activeTasks.get(taskId)?.abort()
      → signal propagates to: processLLMTask → summarizer function → adapter.chatCompletion → fetch()
```

### B3. Implementation steps

#### Step B-1: Thêm message type
`lib/types.ts`:
```typescript
| 'CANCEL_LLM_TASK'
```

#### Step B-2: Background worker — track + cancel
`entrypoints/background/index.ts`:
```typescript
const activeTasks = new Map<string, AbortController>();

// Trong START_LLM_TASK handler:
const ctrl = new AbortController();
activeTasks.set(taskId, ctrl);
processLLMTask(taskId, taskType, payload, ctrl.signal)
  .finally(() => activeTasks.delete(taskId));

// Thêm handler mới:
onMessage('CANCEL_LLM_TASK', ({ taskId }) => {
  activeTasks.get(taskId as string)?.abort();
});
```

#### Step B-3: processLLMTask nhận signal
```typescript
async function processLLMTask(
  taskId: string, taskType: string, payload: unknown,
  signal?: AbortSignal  // NEW
): Promise<void>
```
Truyền `signal` vào từng `summarizeTopic()`, `extractKnowledge()`, etc.

#### Step B-4: Summarizer functions nhận signal
Mỗi exported function trong `lib/llm/summarizer.ts` thêm `signal?: AbortSignal`:
- `summarizeTopic(posts, config, onProgress, prompts, signal?)`
- `updateSummary(prev, posts, config, onProgress, prompts, signal?)`
- `analyzeOpinions(posts, config, onProgress, prompts, signal?)`
- `researchTopic(posts, question, config, onProgress, prompts, signal?)`
- `extractKnowledge(posts, title, config, onProgress, prompts, signal?)`
- `extractKnowledgeChunk(posts, title, config, onProgress, signal?)`
- `reduceKnowledgeChunks(partialEntries, config, onProgress, signal?)`
- `summarizeSegments(summaries, config, onProgress, signal?)`
- `generateThreadAnalysis(summaryJson, meta, config, onProgress, prompts, signal?)`
- Private: `summarizeWithMapReduce()`, `summaryChunks()`, `reduceSegmentSummaries()` — tất cả thêm signal

Signal được truyền đến `provider.summarize(posts, prompt, signal?)`.

#### Step B-5: LLMProvider interface
`lib/llm/types.ts`:
```typescript
export interface LLMProvider {
  summarize(posts: ScrapedPost[], systemPrompt: string, signal?: AbortSignal): Promise<LLMResponse>;
  testConnection(): Promise<boolean>;
}
```

#### Step B-6: Adapters — merge signals
Mỗi adapter (`openai-adapter.ts`, `claude-adapter.ts`, `gemini-adapter.ts`):

Thêm helper `mergeAbortSignals`:
```typescript
function mergeAbortSignals(...signals: (AbortSignal | undefined)[]): AbortController {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) { ctrl.abort(s.reason); break; }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl;
}
```

Trong `chatCompletion(messages, signal?)`:
```typescript
const timeoutCtrl = new AbortController();
const timeoutId = setTimeout(() => timeoutCtrl.abort(), this.config.timeoutMs ?? 120000);
const merged = mergeAbortSignals(timeoutCtrl.signal, signal);
// ... fetch({ signal: merged.signal })
```

Khi `signal` bị abort (user cancel), fetch bị hủy ngay → `AbortError` → propagate lên.

#### Step B-7: useLLM.ts — cancelTask()
```typescript
function cancelTask(taskId: string) {
  sendMessage('CANCEL_LLM_TASK', { taskId }).catch(() => {});
}
// expose trong return
```

#### Step B-8: useSummarize.ts — handleCancel() gọi cancelTask
```typescript
async function handleCancel() {
  activeSummarizeId++;
  scrapeAbortCtrl?.abort();
  if (llmTaskId.value) {
    cancelTask(llmTaskId.value); // NEW: cancel in-flight LLM
  }
}
```

#### Step B-9: KnowledgeView.vue — cancel button cho extraction
- Hiện tại không có cancel button cho extraction (chỉ có `activeExtractId++`)
- Thêm `currentLlmTaskId: Ref<string | null>` track taskId đang chạy
- Thêm "Hủy" button hiện khi `isExtracting`
- `cancelExtract()`: `activeExtractId++` + `cancelTask(currentLlmTaskId.value)`

### B4. Affected files (Phase B)

- `lib/types.ts` — thêm `CANCEL_LLM_TASK`
- `lib/llm/types.ts` — thêm `signal?` vào `LLMProvider.summarize()`
- `lib/llm/openai-adapter.ts` — `mergeAbortSignals`, pass signal
- `lib/llm/claude-adapter.ts` — same
- `lib/llm/gemini-adapter.ts` — same
- `lib/llm/summarizer.ts` — tất cả exported + private functions thêm `signal?` param
- `entrypoints/background/index.ts` — `activeTasks` Map, `CANCEL_LLM_TASK` handler, pass signal
- `entrypoints/sidepanel/composables/useLLM.ts` — expose `cancelTask()`
- `entrypoints/sidepanel/composables/useSummarize.ts` — `handleCancel()` gọi cancelTask
- `entrypoints/sidepanel/views/KnowledgeView.vue` — cancel button + cancelTask

---

## Phase C — Pause/Resume (Deferred)

Tách thành planning riêng khi Phase A+B ổn định. Sơ bộ:
- Thêm `pauseRequested: Ref<boolean>` vào useSummarize, KnowledgeView
- Kiểm tra `pauseRequested` giữa các iteration của vòng lặp (page loop, chunk loop)
- Lưu `DynamicResumeState` khi pause (đã có cấu trúc này trong useSummarize)
- Resume: gọi lại `handleAutoSummarizeAll()` với resume state
- UI: nút "⏸ Tạm dừng" / "▶ Tiếp tục"

---

## Implementation Order

```
Phase A (implement trước, ít risk):
  A1. lib/llm/cost-estimator.ts (NEW)
  A2. lib/constants.ts (+1 constant)
  A3. useSummarize.ts (extend confirm box với cost estimate)
  A4. KnowledgeView.vue (thêm confirm before extract)
  A5. SummaryView.vue (hiển thị cảnh báo nếu cần)

Phase B (implement sau, nhiều file hơn):
  B1. lib/types.ts (+1 message type)
  B2. lib/llm/types.ts (interface change)
  B3. lib/llm/openai-adapter.ts
  B4. lib/llm/claude-adapter.ts
  B5. lib/llm/gemini-adapter.ts
  B6. lib/llm/summarizer.ts (signal threading — lớn nhất)
  B7. entrypoints/background/index.ts
  B8. composables/useLLM.ts
  B9. composables/useSummarize.ts
  B10. views/KnowledgeView.vue
```

---

## Edge Cases

1. **User cancel giữa map-reduce**: fetch bị abort → `AbortError` → propagate → LLM_RESULT `{success: false, error: "AbortError: ..."}` → useLLM nhận error → `activeSummarizeId` đã tăng → error bị silent drop (đúng behavior)
2. **Cancel sau khi task xong**: `activeTasks.get(taskId)` trả undefined → no-op, safe
3. **Sidepanel đóng giữa chừng**: background tiếp tục (đúng) nhưng không có ai nhận LLM_RESULT → timeout → abort sau 120s. Không thay đổi so với hiện tại.
4. **Cost estimate khi chưa có posts**: dùng `totalPages × avgTokensPerPage` estimate, làm rõ trong UI là "ước tính"
5. **estimateAutoSummarizeCalls với 1 segment**: trả 1, không warn (dưới threshold 5)
6. **Signal timeout race**: merged controller abort khi timeout trước cancel → behavior giữ nguyên; cancel trước timeout → abort sớm hơn (đúng behavior)
7. **KnowledgeView cancel giữa reduce phase**: `reduceKnowledgeChunks` nhận signal → abort → chunks đã persist không bị mất (đã persist từng chunk) → resume từ đầu vẫn được

---

## Test Plan

**Phase A:**
- [ ] Topic 5 trang: không hiện cảnh báo (dưới threshold)
- [ ] Topic 30 trang: hiện cảnh báo "~X API calls" trong confirm box
- [ ] Cancel trong confirm: không bắt đầu gì
- [ ] Confirm: tiến hành bình thường
- [ ] KnowledgeView với 50 posts: hiện estimated chunk count
- [ ] KnowledgeView confirm → cancel: không extract

**Phase B:**
- [ ] Bắt đầu summarize → click Cancel: LLM fetch dừng ngay (kiểm tra network tab)
- [ ] Bắt đầu extract → click Hủy: dừng giữa chừng, không corrupt cache
- [ ] Cancel xong → bắt đầu lại: hoạt động bình thường
- [ ] Topic switch giữa LLM: signal abort + invalidate đều fire, không corrupt
- [ ] `testConnection()` adapter: không bị ảnh hưởng (không nhận signal)

---

## Rollback Plan

Phase A: chỉ thêm UI + 1 file mới → remove confirm logic + delete cost-estimator.ts  
Phase B: revert `lib/llm/types.ts` interface + remove signal params → adapters trở về original

Không có thay đổi data schema → không cần DB migration.

---

## Decision Log

### Quyết định 1: Ngưỡng cảnh báo hardcode vs configurable
- **Đã chọn:** Hardcode `LLM_WARN_THRESHOLD_CALLS = 5` trong constants.ts
- **Lý do:** Đơn giản hóa MVP; threshold phù hợp cho hầu hết use case; có thể thêm Settings sau
- **Đã cân nhắc nhưng loại:**
  - Settings UI cho threshold — loại vì thêm complexity không cần thiết ở lần đầu
- **Điều kiện thay đổi:** Nếu user phản ánh threshold 5 quá thấp/cao → mở Settings option

### Quyết định 2: mergeAbortSignals thay vì AbortSignal.any()
- **Đã chọn:** Helper `mergeAbortSignals(...signals)` tự implement
- **Lý do:** `AbortSignal.any()` chưa available trong tất cả Chrome versions extension target; helper đơn giản (~10 LOC) và đủ
- **Đã cân nhắc nhưng loại:**
  - `AbortSignal.any()` — loại vì compatibility
  - Chỉ dùng user signal không merge timeout — loại vì mất timeout protection
- **Điều kiện thay đổi:** Khi minimum Chrome version support được nâng lên có `AbortSignal.any()` → thay helper bằng native

### Quyết định 3: Signal threading qua background worker
- **Đã chọn:** Background worker `activeTasks` Map + `CANCEL_LLM_TASK` message
- **Lý do:** Background service worker không share memory với sidepanel — phải dùng message passing; Map-based approach clean, không leak (delete on complete)
- **Đã cân nhắc nhưng loại:**
  - Timeout giảm từ 120s xuống 30s làm "cancel nhanh hơn" — loại vì không giải quyết vấn đề, chỉ giảm timeout
  - `CANCEL_ALL_LLM_TASKS` — loại vì quá broad, cancel 1 task cụ thể là đủ
- **Điều kiện thay đổi:** Nếu background worker restart thường xuyên làm mất Map state → thêm recovery mechanism

### Quyết định 4: Cost estimate dựa trên pages × avgTokensPerPage
- **Đã chọn:** `estimateAutoSummarizeCalls(totalPages, budgetTokens, avgTokensPerPage=3000)`
- **Lý do:** Không có posts trước khi scrape → phải estimate; 3000 tokens/page là conservative estimate (thực tế có thể ít hơn)
- **Đã cân nhắc nhưng loại:**
  - Đọc page 1 trước để calibrate → loại vì thêm latency, phức tạp hóa flow
  - Chỉ hiển thị số trang thay vì API calls — loại vì API calls meaningful hơn với user
- **Điều kiện thay đổi:** Nếu estimate sai xa thực tế → điều chỉnh `avgTokensPerPage` hoặc dùng actual posts count sau scrape page 1

### Quyết định 5: Phase C (Pause/Resume) tách planning riêng
- **Đã chọn:** Không implement Phase C trong F26
- **Lý do:** Phase A+B đã đủ giải quyết vấn đề user; Pause/Resume thêm độ phức tạp lớn (state machine, checkpoint, resume logic) mà benefit marginal khi đã có cancel + warning
- **Điều kiện thay đổi:** Nếu user phản ánh cần pause (ví dụ muốn tạm dừng tốn chi phí nhưng không muốn mất progress) → tạo planning F27
