# Task: F25 — Thread Analysis View

## Objective
Thêm tính năng phân tích sâu (Thread Analysis) vào SummaryView, hiển thị dưới dạng sub-tab "Phân tích" bên cạnh tab "Tóm tắt" hiện có.

## Affected Modules
- `lib/types.ts` — new interfaces
- `lib/prompts.ts` — new prompt
- `lib/llm/summarizer.ts` — new functions
- `entrypoints/background/index.ts` — new task handler
- `entrypoints/sidepanel/composables/useLLM.ts` — new task factory
- `entrypoints/sidepanel/composables/useSummarize.ts` — state + handler
- `entrypoints/sidepanel/components/ThreadAnalysisContent.vue` — new component (NEW FILE)
- `entrypoints/sidepanel/views/SummaryView.vue` — sub-tabs

## Implementation Steps

1. ✅ **Types** — Added `ThreadUserProfile`, `ThreadDebateStream`, `ThreadCombat`, `ThreadTimelinePhase`, `ThreadNotableComment`, `ThreadAnalysisJSON` to `lib/types.ts`. Added `threadAnalysis?` to `CachedTopic`, `'thread_analysis'` to `LLMTaskRequest.taskType`.

2. ✅ **Prompt** — Added `THREAD_ANALYSIS_PROMPT` to `lib/prompts.ts` (Vietnamese, JSON-only, 8-section schema, single-quote constraint for text fields, exactly 3 `notableComments`).

3. ✅ **Summarizer** — Added `parseThreadAnalysisJSON()` (reuses `repairUnescapedQuotes` + fence stripping pattern) and `generateThreadAnalysis()` (1 InputPost with summaryJson + meta, throws on parse failure).

4. ✅ **Background handler** — Added `case 'thread_analysis':` in `processLLMTask()`. Added `threadAnalysis` field to `SAVE_CACHED_TOPIC` partial merge logic.

5. ✅ **useLLM** — Added `threadAnalysisTask(summaryJson, meta)` factory, exposed in return object.

6. ✅ **useSummarize** — Added `threadAnalysis`, `isAnalyzing` reactive refs, `activeAnalyzeId` non-reactive counter. `loadTopicData()` resets state and loads from cache. `handleGenerateAnalysis()` with stale guard, error handling, cache persist.

7. ✅ **ThreadAnalysisContent.vue** — New component, renders 8 sections (overview, userProfiles, debateStreams, combats, timeline, notableComments, conclusion, wuxia). Copy button with `navigator.clipboard.writeText()` + `prompt()` fallback, `copied` ref 2s toast.

8. ✅ **SummaryView.vue** — Sub-tabs (Tóm tắt / Phân tích) added inside `activeSegmentIndex === null` block. `activeSummaryView` ref reset on topic switch in `onActivated`.

## Decision Log (tham chiếu từ planning)

### Decision 1: Input = summaryJson (không phải raw posts)
- **Đã chọn:** `summaryJson` làm input cho LLM
- **Lý do:** Rẻ (~2-3K tokens), đã có đủ thông tin từ tóm tắt
- **Implementation:** `generateThreadAnalysis(summaryJson, meta, config)` — 1 InputPost

### Decision 2: Sub-tabs chỉ ở Tổng quan (activeSegmentIndex === null)
- **Đã chọn:** Sub-tabs chỉ hiện khi không đang xem segment cụ thể
- **Lý do:** Phân tích toàn thread không apply cho từng segment
- **Implementation:** Guard `v-if="activeSegmentIndex === null"` wraps cả sub-tab UI

### Decision 3: On-demand trigger
- **Đã chọn:** User click nút "Phân tích thread"
- **Lý do:** Tránh gọi LLM tự động không cần thiết
- **Implementation:** Empty state với button disabled khi không có summaryJson

### Decision 4: Copy = plain-text markdown
- **Đã chọn:** `formatAnalysisAsText()` → flat markdown string
- **Lý do:** Dễ paste, readable mọi nơi, không cần HTML
- **Implementation:** `handleCopy()` → clipboard API + prompt() fallback

## Build Verification
- `npm run build` → ✔ Built extension in 5.464 s
- `get_errors` → No TS errors on all 8 files

## Self-review Results
- Issues found: 0
- Issues fixed: 0
- Remaining (cần review thêm): —

### Checklist chi tiết

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Error handling | ✅ | `handleGenerateAnalysis` có try/catch/finally; `sendMessage().catch(()=>{})` cho silent cache save; `generateThreadAnalysis` throws on invalid parse; `handleCopy` catches clipboard error với prompt() fallback |
| 2 | Null safety | ✅ | Guard `!topic \|\| !summaryJson.value \|\| isAnalyzing.value`; cache load với `if (fresh.threadAnalysis)` guard; template `v-if="threadAnalysis"` trước khi render component |
| 3 | Naming consistency | ✅ | `threadAnalysis`, `isAnalyzing`, `handleGenerateAnalysis`, `activeAnalyzeId` — consistent với pattern `activeSummarizeId`, `isAnalyzingOpinions` v.v. |
| 4 | Imports/exports | ✅ | Tất cả imports verified: `ThreadAnalysisJSON`, `generateThreadAnalysis`, `SummaryJSON`, `ThreadAnalysisContent` |
| 5 | Debug code | ✅ | Không có `console.log`, `debugger`, hay commented-out code |
| 6 | Hardcoded values | ✅ | Chỉ có `2000`ms cho copy toast (UI constant, không cần vào constants.ts); không có API key hay URL hardcoded |
| 7 | TypeScript types | ✅ | Không có `any`; cast `(taskResult.data as { analysis: unknown }).analysis` là safe vì background throws khi parse fail → task.result rejects → caught in catch block |
| 8 | Reactive patterns | ✅ | `threadAnalysis = ref<ThreadAnalysisJSON \| null>(null)`, `isAnalyzing = ref(false)`; `activeAnalyzeId` là non-reactive (let) — đúng pattern; `activeSummaryView` reset trong `onActivated` |
