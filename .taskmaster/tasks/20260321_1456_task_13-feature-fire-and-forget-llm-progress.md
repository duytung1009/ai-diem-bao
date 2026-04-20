# Task Summary: Feature 13 — Fire-and-Forget LLM + Progress + Speed Estimation

Ngày: 2026-03-21
Planning: `planning/20260320_1633_13-feature-fire-and-forget-llm-progress.md`

---

## Những gì đã thực hiện

### Task 1: lib/types.ts + lib/constants.ts
- Thay `SUMMARIZE | SUMMARIZE_INCREMENTAL | ANALYZE_OPINIONS | RESEARCH_QUERY` bằng `START_LLM_TASK | LLM_PROGRESS | LLM_RESULT`
- Thêm 4 interfaces: `LLMTaskRequest`, `LLMProgressMessage`, `LLMResultMessage`, `ModelSpeedStats`
- Thêm `STORAGE_KEYS.MODEL_SPEED_STATS = 'model-speed-stats'`

### Task 2: lib/llm/summarizer.ts
- Đổi signature của `onProgress` callback từ `(message: string)` → `(msg: string, step?: number, totalSteps?: number)`
- `summaryChunks()`: truyền `step` và `total = chunks.length + 1` vào mỗi `onProgress` call
- `summarizeWithMapReduce`, `summarizeTopic`, `updateSummary`, `analyzeOpinions`, `researchTopic` — tất cả updated signature

### Task 3: entrypoints/background/index.ts
- Xoá 4 case cũ: `SUMMARIZE`, `SUMMARIZE_INCREMENTAL`, `ANALYZE_OPINIONS`, `RESEARCH_QUERY`
- Thêm `START_LLM_TASK` handler: respond `{started: true}` ngay, chạy `processLLMTask()` async + keepalive ping mỗi 20s
- `processLLMTask()`: dispatch 4 taskType, gửi `LLM_PROGRESS` qua `browser.runtime.sendMessage`, gửi `LLM_RESULT` khi xong
- `updateModelSpeedStats()`: rolling average TPS (70% old + 30% new), lưu vào `storage.sync`

### Task 4: entrypoints/sidepanel/composables/useLLM.ts (rewrite)
- Module-level singleton: `activeTasks` Map ref, `modelSpeedStats` ref, `currentModel` ref, `listenerRegistered` flag
- `startTask()`: sync taskId generation, fire-and-forget `sendMessage('START_LLM_TASK', ...)`
- Typed wrappers: `summarize()`, `summarizeIncremental()`, `analyzeOpinions()`, `researchTopic()` — mỗi hàm trả `{ taskId: string; result: Promise<LLMResultMessage> }`
- `handleProgress()` / `handleResult()`: cập nhật `activeTasks` reactive map
- `getETA()`: estimate thời gian còn lại từ `modelSpeedStats`
- `loadSpeedStats()`: load từ `storage.sync` + lấy current model

### Task 5: entrypoints/sidepanel/components/LLMProgress.vue (TẠO MỚI)
- Nhận `taskId` + `fallbackMessage` props
- Hiển thị message từ task progress hoặc fallbackMessage
- Progress bar (`h-1.5 bg-(--color-primary)`) khi có map-reduce steps
- ETA countdown cập nhật mỗi giây (watchEffect + setInterval)

### Task 6: SummaryView.vue — 3 call sites
- Import `useLLM` + `LLMProgress`; thêm `llmTaskId = ref<string | null>(null)`
- `confirmSummarize()`: dùng `summarize(posts)` + `summarizeIncremental(prev, newPosts)` từ useLLM; set `llmTaskId.value = taskId` ngay khi bắt đầu
- `handleSummarizeSegment()`: dùng `summarize(segPosts)`
- `generateOverallSummary()`: dùng `summarize(segmentPosts)`
- `finally`: clear `llmTaskId.value = null`
- Reset `llmTaskId.value = null` trong `loadTopicData()` reset block
- Template: `v-if="loadingText || llmTaskId"` — `<LoadingSpinner>` cho scraping, `<LLMProgress>` cho LLM phase

### Task 7: OpinionsView.vue
- Thêm `isLoading`, `error`, `llmTaskId` refs (bỏ destructure từ useLLM cũ)
- `handleAnalyze()`: dùng `{ taskId, result } = runAnalysis(posts)`, await result
- Template: `<LLMProgress>` khi `isLoading && llmTaskId`, `<LoadingSpinner>` fallback

### Task 8: ResearchView.vue
- Import `useLLM` + `LLMProgress`; thêm `llmTaskId` ref
- `handleResearch()`: dùng `{ taskId, result } = runResearch(posts, q)`, await result
- Template: `<LLMProgress>` khi `isLoading && llmTaskId`, `<LoadingSpinner>` fallback

---

## Kết quả

- `npx vue-tsc --noEmit` → pass ✅
- `npm run build` → pass ✅ (348.52 kB total)

---

## Bug fixes trong quá trình implement

- `chrome.runtime.getPlatformInfo` → `browser.storage.sync.get('')` cho keepalive (WXT không expose `chrome` global trong TypeScript)
- Cast `stored[key] as Record<string, ModelSpeedStats>` để tránh TS error
- Cast `stored[STORAGE_KEYS.SETTINGS] as { model?: string }` cho model lookup
