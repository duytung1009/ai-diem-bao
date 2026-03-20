# Bug Fix: Stale Summarize Guard

Ngày: 2026-03-20
Dựa trên: `planning/20260320_2227_fix-stale-summarize-guard.md`

---

## Root Cause

`confirmSummarize()`, `handleSummarizeSegment()`, `generateOverallSummary()` là async functions "trôi nổi". Sau `await sendMessage('SUMMARIZE')`, user có thể đã chuyển topic khác, nhưng các hàm vẫn ghi `summary.value`, gọi `store.updateSelectedTopic()`, và `finally` xóa `loadingText → ''` → loading biến mất khi quay về topic đang tóm tắt.

Thêm vào đó, `isSummarizingThisTopic` trong `onActivated` check `loadedTopicUrl` → false positive khi mở topicB while topicA is summarizing.

---

## Thay đổi

Tất cả trong `entrypoints/sidepanel/views/SummaryView.vue`:

### B1: Thêm `activeSummarizeId`
```ts
let activeSummarizeId = 0; // incremented on each new summarize or topic load
```

### B2: `loadTopicData()` — invalidate
```ts
// === RESET all view state for new topic ===
activeSummarizeId++; // invalidate any in-flight LLM callbacks
```

### B3: `confirmSummarize()` — capture + stale guard
- `const thisId = ++activeSummarizeId` trước `store.setSummarizing()`
- Sau LLM await: nếu `thisId !== activeSummarizeId` → vẫn save cache, `return` (không ghi refs)
- `catch`: guard `if (thisId !== activeSummarizeId) return`
- `finally`: `store.setSummarizing(null)` luôn chạy; `loadingText = ''` chỉ khi `thisId === activeSummarizeId`

### B4: `handleSummarizeSegment()` — tương tự B3
- `const thisId = ++activeSummarizeId` trước `store.setSummarizing()`
- Sau LLM: nếu stale → save segment vào cache, `return`
- Conditional catch + finally

### B5: `generateOverallSummary()` — tương tự B3
- `const thisId = ++activeSummarizeId` trước `store.setSummarizing()`
- Sau LLM: nếu stale → save overall summary, `return`
- Conditional catch + finally

### B6: `onActivated` — fix `isSummarizingThisTopic`
```ts
// Trước (gây false positive khi mở topicB):
const isSummarizingThisTopic =
  store.summarizingUrl.value !== null &&
  (isSameTopicUrl(summarizingUrl, url) || isSameTopicUrl(summarizingUrl, loadedTopicUrl));

// Sau (chỉ check topic được chọn hiện tại):
const isSummarizingThisTopic =
  store.summarizingUrl.value !== null &&
  isSameTopicUrl(store.summarizingUrl.value, url);
```

---

## Kết quả

- `npx vue-tsc --noEmit` → pass
- `npm run build` → pass
- TopicA summarizing → view topicB → topicB không bị ghi đè summary A
- LLM xong khi đang xem topicB → quay về topicA → load từ cache → hiện đúng tóm tắt
- LLM xong khi đang xem topicA → loading biến mất, tóm tắt hiện bình thường
