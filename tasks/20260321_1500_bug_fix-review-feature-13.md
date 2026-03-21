# Bug Fix: Review Feature 13 — Fire-and-Forget LLM Progress

Ngày: 2026-03-21
Review file: `review/20260321_1500_feature-13-fire-and-forget-llm-progress.md`

## Các fix đã thực hiện

### I-1: `currentModel` stale sau khi đổi model trong Settings
**File:** `entrypoints/sidepanel/composables/useLLM.ts`
- Thêm `else` branch vào `useLLM()`: mỗi khi composable được gọi lại (không phải lần đầu), refresh `currentModel` từ `storage.sync` (fire-and-forget, không block)
- Đảm bảo `estimateETA()` dùng model hiện tại chứ không phải model lúc khởi tạo

### M-1: ETA expression dead code trong LLMProgress.vue
**File:** `entrypoints/sidepanel/components/LLMProgress.vue`
- Bỏ biểu thức `(now.value - (now.value - (t.estimatedTotalMs * 0)))` luôn bằng `0`
- Thay bằng `const elapsed = t.elapsedMs > 0 ? t.elapsedMs : 0;`

### M-2: `as any` trong SummaryView.vue
**File:** `entrypoints/sidepanel/views/SummaryView.vue`
- Thay `as any` bằng `as Partial<CachedTopic>` — type đúng hơn và không bypass type check

### M-3: `as TopicSegment[]` che giấu null slots
**File:** `entrypoints/sidepanel/views/SummaryView.vue`
- Thay `Array.from({ length: count }, ...)` bằng spread `[...segmentSummaries.value]`; JS tự xử lý sparse array
- Bỏ `as TopicSegment[]` cast; type thực tế là `(TopicSegment | undefined)[]` — phù hợp với optional chaining `?.` đã dùng downstream

## Kết quả
- `npx vue-tsc --noEmit` → pass ✅
