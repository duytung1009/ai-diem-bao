# Fix: Review Feature 13 — Fire-and-Forget LLM Progress

**Date:** 2026-03-21
**Review file:** `review/20260321_1500_feature-13-fire-and-forget-llm-progress.md`

## Issues đã được fix

### I-1 ✅ (đã fix trước khi tạo task này)
**useLLM.ts** — `currentModel` stale sau khi đổi model trong Settings
- Thêm `else` block trong `useLLM()` để refresh `currentModel.value` từ storage mỗi khi composable được gọi
- Chỉ reload model setting (fire-and-forget `.then().catch()`), không reload toàn bộ speed stats

### M-1 ✅ (đã fix trước khi tạo task này)
**LLMProgress.vue line 34** — biểu thức else luôn bằng 0
- `const elapsed = t.elapsedMs > 0 ? t.elapsedMs : (now.value - (now.value - (t.estimatedTotalMs * 0)))` → `const elapsed = t.elapsedMs > 0 ? t.elapsedMs : 0`

### M-2 ✅ (đã fix trước khi tạo task này)
**SummaryView.vue ~line 602** — `as any` trong `store.updateSelectedTopic`
- `} as any)` → `} as Partial<CachedTopic>)`

### M-3 ✅ (fix trong task này)
**SummaryView.vue ~line 567** — biến `count` thừa không dùng sau khi M-3 code đã được sửa
- `Array.from({ length: count }, ...)` đã được đổi thành `[...segmentSummaries.value]` + `updated[segmentIndex] = newSeg`
- Biến `count = Math.max(...)` còn sót lại → đã xóa

## Type check
`npx vue-tsc --noEmit` — pass, không có lỗi.
