# Task: F26 — LLM Cost Guard (Phase A + Phase B)

**Ngày:** 2026-04-16  
**Planning file:** `planning/20260416_0110_26-feature-llm-cost-guard.md`  
**Tier:** Tier 3 (cross-module, 12 files)

---

## Tóm tắt

Implement Phase A (Warning + Cost Estimate) và Phase B (True LLM Cancel) cho F26 LLM Cost Guard.

- **Phase A:** Hiển thị cảnh báo ước tính API call trước khi bắt đầu tác vụ tốn kém
- **Phase B:** Gắn AbortController chain từ sidepanel xuyên qua background worker xuống đến `fetch()` của từng adapter

---

## Files đã tạo / sửa

### Phase A

| File | Thay đổi |
|------|----------|
| `lib/llm/cost-estimator.ts` | **NEW** — 3 functions: `estimateAutoSummarizeCalls`, `estimateExtractCalls`, `estimateSummarizeSegmentCalls` |
| `lib/constants.ts` | Thêm `LLM_WARN_THRESHOLD_CALLS = 5` |
| `entrypoints/sidepanel/views/SummaryView.vue` | Import cost-estimator; computed `estimatedAutoSummarizeCalls`, `showAutoSummarizeCostWarning`; warn message trong confirm UI |
| `entrypoints/sidepanel/views/KnowledgeView.vue` | Import cost-estimator; `confirmingExtract` ref; `estimatedExtractApiCalls`, `showExtractCostWarning` computed; `onExtractClick()` gate; `handleCancel()` gọi `cancelTask` |

### Phase B

| File | Thay đổi |
|------|----------|
| `lib/types.ts` | Thêm `'CANCEL_LLM_TASK'` vào `MessageType` |
| `lib/llm/types.ts` | `LLMProvider.summarize()` thêm `signal?: AbortSignal` |
| `lib/llm/openai-adapter.ts` | `mergeAbortSignals()` helper; `summarize()` và `chatCompletion()` nhận `signal`; phân biệt timeout vs user cancel trong catch |
| `lib/llm/claude-adapter.ts` | Cùng pattern với OpenAI adapter |
| `lib/llm/gemini-adapter.ts` | Cùng pattern — `generateContent()` nhận `signal` |
| `lib/llm/summarizer.ts` | 11 function (9 exported + 2 private) thêm `signal?: AbortSignal`; tất cả `provider.summarize()` call đều pass signal |
| `entrypoints/background/index.ts` | `activeLLMTasks = new Map<string, AbortController>()`; `START_LLM_TASK` tạo + lưu `AbortController`; thêm `CANCEL_LLM_TASK` case; `processLLMTask()` nhận `signal?`; 9 summarizer call thêm `signal` làm arg cuối |
| `entrypoints/sidepanel/composables/useLLM.ts` | Thêm `cancelTask(taskId)` function; expose trong return object |
| `entrypoints/sidepanel/composables/useSummarize.ts` | Destructure `cancelTask` từ `useLLM()`; `handleCancel()` gọi `cancelTask(llmTaskId.value)` trước khi reset state |

---

## Thiết kế chính đã implement

### mergeAbortSignals (Decision Log #2)
`AbortSignal.any()` không available trên all Chrome versions. Dùng helper tự implement (~12 LOC) trong mỗi adapter để merge timeout signal + external cancel signal.

### Phân biệt timeout vs user cancel
Trong catch block của adapter: kiểm tra `timeoutCtrl.signal.aborted` để distinguish:
- `true` → throw `LLMError(TIMEOUT, ...)` (behavior cũ)
- `false` → rethrow `AbortError` (user cancel, propagate silent qua stale guard)

### activeLLMTasks Map (Decision Log #3)
Background service worker không share memory với sidepanel → dùng message passing `CANCEL_LLM_TASK`. Map được cleanup trong `.finally()` để không leak.

### Cancel flow (Phase B)
```
user click Cancel
  → handleCancel() (useSummarize/KnowledgeView)
    → activeSummarizeId++ (stale guard)
    → cancelTask(llmTaskId) (useLLM)
      → sendMessage('CANCEL_LLM_TASK', { taskId })
        → background: activeLLMTasks.get(taskId)?.abort()
          → signal propagate → fetch() abort → AbortError
            → LLM_RESULT { success: false, error: "AbortError..." }
              → stale guard: activeSummarizeId mismatch → silent drop ✅
```

---

## Self-review Results

- Issues found: 0
- Issues fixed: 0
- Remaining: không có

TypeScript errors sau khi implement: **0** (verified với `get_errors` trên 12 files)

---

## Test Plan (từ planning)

**Phase A:**
- [ ] Topic 5 trang: không hiện cảnh báo (dưới threshold 5)
- [ ] Topic 30 trang: hiện cảnh báo "~X API calls" trong confirm box
- [ ] Cancel trong confirm: không bắt đầu gì
- [ ] Confirm: tiến hành bình thường
- [ ] KnowledgeView với nhiều posts: hiện estimated chunk count
- [ ] KnowledgeView confirm → cancel: không extract

**Phase B:**
- [ ] Bắt đầu summarize → click Cancel: LLM fetch dừng ngay (kiểm tra network tab)
- [ ] Bắt đầu extract → click Hủy: dừng giữa chừng, không corrupt cache
- [ ] Cancel xong → bắt đầu lại: hoạt động bình thường
- [ ] Topic switch giữa LLM: signal abort + invalidate đều fire, không corrupt
