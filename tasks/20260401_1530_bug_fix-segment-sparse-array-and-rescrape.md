# Bug Fix: Segment Mode — Sparse Array + Re-scrape on Retry

**Ngày:** 2026-04-01

---

## Bugs đã fix

### BUG-1: Sparse JavaScript array → null items khi save segment index cao
- **Severity:** major
- **Affected module:** `entrypoints/sidepanel/views/SummaryView.vue`
- **Steps to reproduce:**
  1. Topic > segmentSize trang (ví dụ: 1238 trang, segmentSize=10 → 124 segments)
  2. Click tóm tắt segment 122 (index cao, chưa tóm tắt segment nào trước đó)
  3. `SAVE_CACHED_TOPIC` nhận `segments` với 122 `null` items + 1 item thật ở cuối
- **Root cause:** `[...segmentSummaries.value]` trả về array rỗng (length=0) khi chưa có segment nào; `arr[122] = x` tạo sparse array với 122 holes; JSON serialize holes thành `null`
- **Fix:** `makeDenseBase(segIdx)` helper dùng `Array.from({ length: max(current, idx+1, totalSegs) }, ...)` — đảm bảo dense array không có holes

### BUG-2: Luôn re-scrape khi retry, bỏ qua posts đã cache
- **Severity:** major
- **Affected module:** `entrypoints/sidepanel/views/SummaryView.vue`
- **Steps to reproduce:**
  1. Tóm tắt segment → scrape thành công → LLM fail (mạng, timeout)
  2. Click Retry
  3. Scrape lại từ đầu thay vì dùng posts đã có trong cache
- **Root cause:** Code luôn gọi `scrapeRange(...)` mà không check `segmentSummaries.value[segmentIndex]?.posts?.length`
- **Fix:** Check `existing?.posts?.length` trước scrape; nếu có posts → dùng lại, hiển thị thông báo "Dùng N bài viết đã lưu (scrape trước đó)"

### BUG-3: UI state không update sau pre-LLM save
- **Severity:** minor
- **Affected module:** `entrypoints/sidepanel/views/SummaryView.vue`
- **Steps to reproduce:**
  1. Tóm tắt segment → scrape OK → pre-LLM save ghi vào IndexedDB → LLM fail
  2. UI segment tab vẫn hiển thị "chưa làm" — user không biết posts đã được cache
  3. Retry không có gì để dùng lại (vì Bug-2 cũng bị ảnh hưởng do `segmentSummaries.value` không được cập nhật)
- **Root cause:** `SAVE_CACHED_TOPIC` pre-LLM chỉ cập nhật IndexedDB, không cập nhật `segmentSummaries.value` → UI và Fix-2 không thấy posts đã cache
- **Fix:** Thêm `segmentSummaries.value = tempUpdated as TopicSegment[]` sau pre-LLM save

---

## Changes

### `entrypoints/sidepanel/views/SummaryView.vue` — SỬA

1. **Thêm `makeDenseBase` helper** trước `handleSummarizeSegment`:
   ```typescript
   const makeDenseBase = (segIdx: number): (TopicSegment | null)[] =>
     Array.from(
       { length: Math.max(segmentSummaries.value.length, segIdx + 1, segments.value.length) },
       (_, i) => segmentSummaries.value[i] ?? null,
     );
   ```

2. **Skip re-scrape nếu posts đã cache**: check `existing?.posts?.length` ngay đầu try-block, dùng `if/else` để quyết định scrape fresh hay dùng cache

3. **Cập nhật UI state sau pre-LLM save**: `segmentSummaries.value = tempUpdated as TopicSegment[]` sau `SAVE_CACHED_TOPIC` silent call

4. **Dùng `makeDenseBase` ở cả 2 chỗ** tạo mảng updated (pre-LLM và post-LLM), tránh sparse array

5. **Rename `updated` → `updatedDense`** ở post-LLM path để rõ ràng hơn sau khi thêm cast

---

## Self-review Results
- Issues found: 1 (type mismatch: `(TopicSegment | null)[]` không gán được vào `ref<TopicSegment[]>`)
- Issues fixed: 1 (cast `as TopicSegment[]` tại 2 điểm assign)
- Remaining: Không có — pre-existing errors ở `KnowledgeView.vue` và `TopicHubView.vue` (unrelated)
