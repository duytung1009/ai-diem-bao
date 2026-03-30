# Task: Feature 17 — Unified Progress Indicator

**Ngày:** 2026-03-30
**Planning file:** `planning/20260330_1400_17-feature-unified-progress-indicator.md`

## Summary

Gộp `LoadingSpinner` + `LLMProgress` thành một component `ProgressIndicator` hỗ trợ 3 chế độ:
- **LLM mode** (`taskId`): progress bar step-based (map-reduce) hoặc fake ETA-based (single-pass), ETA countdown
- **Scraping mode** (`scrapeProgress`): progress bar real-time theo page, ETA dựa trên `scrapeDelayMs + PAGE_LOAD_MS (500ms)`
- **Simple mode** (`message`): chỉ spinner + text

## Changes

### `components/ProgressIndicator.vue` — TẠO MỚI

Props: `taskId?`, `scrapeProgress?`, `scrapeDelayMs?`, `message?`, `fallbackMessage?`, `showCancel?`

**LLM mode:**
- Map-reduce (`totalSteps >= 2`): step/totalSteps × 100%
- Single-pass: `Math.min(95, elapsed/estimatedTotalMs × 100%)` — capped 95% chờ result
- ETA: `estimatedTotalMs - elapsedMs`, format "~Ns" / "~N phút Ns" / "Sắp xong..."

**Scraping mode:**
- Progress bar: `currentPage / totalPages × 100%`
- ETA: `(totalPages - currentPage) × (scrapeDelayMs + 500)`, cùng format

Timer 1s để cập nhật ETA (chỉ khi LLM mode running — scraping ETA reactive qua prop).

### `components/LLMProgress.vue` — XÓA

Toàn bộ chức năng đã chuyển vào `ProgressIndicator`.

### `views/SummaryView.vue`

- `loadingText: Ref<string>` → split thành `scrapeProgress` (structured) + `simpleLoadingText`
- `isProcessing` computed: `!!llmTaskId || !!scrapeProgress || !!simpleLoadingText`
- Template: thay `LoadingSpinner` + `LLMProgress` + cancel button → `<ProgressIndicator :show-cancel="isScraping" @cancel="handleCancel">`
- `scrapeInChunks` loop: set `scrapeProgress.value = { currentPage: chunkStart, totalPages: endPage, postsScraped }` thay vì format string
- `onRuntimeMessage SCRAPE_PROGRESS`: update `scrapeProgress.value = p` trực tiếp
- Segment mode: dùng `simpleLoadingText` cho initial state thay vì `scrapeProgress` với absolute page numbers
- Tất cả button `:disabled="!!loadingText"` → `:disabled="isProcessing"`

### `views/OpinionsView.vue`

```vue
<!-- Trước -->
<LLMProgress v-if="isLoading && llmTaskId" ... />
<LoadingSpinner v-else-if="isLoading" ... />

<!-- Sau -->
<ProgressIndicator v-if="isLoading" :task-id="llmTaskId" fallback-message="Đang phân tích ý kiến..." />
```

### `views/ResearchView.vue`

```vue
<!-- Trước -->
<LLMProgress v-if="isLoading && llmTaskId" ... />
<LoadingSpinner v-else-if="isLoading" ... />

<!-- Sau -->
<ProgressIndicator v-if="isLoading" :task-id="llmTaskId" fallback-message="Đang tra cứu câu trả lời..." />
```

`LoadingSpinner.vue` giữ nguyên — vẫn dùng cho `TopicHubView` (load list) và `SettingsView` (test connection).

---

## Self-review Results

- Issues found: 2
- Issues fixed: 2
- Remaining: none

### Issues fixed

**I-1 (Important) — Typo trong OpinionsView.vue:**
`"Đang phân tích ý kiẽn..."` (dấu sai `ẽ`) → `"Đang phân tích ý kiến..."`.

**M-1 (Minor) — Segment mode initial progress bar hiển thị ~50%:**
`handleSummarizeSegment` set `scrapeProgress = { currentPage: seg.start, totalPages: seg.end }` trước khi scrape → progress bar hiện `seg.start / seg.end` (ví dụ: segment trang 10–20 → 50%). Fix: dùng `simpleLoadingText.value = \`Đang đọc ${seg.label}...\`` cho initial state; SCRAPE_PROGRESS messages từ content script sẽ update `scrapeProgress` với giá trị chính xác.

Type check: `npx vue-tsc --noEmit` → **PASS** ✅
