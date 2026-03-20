# Fix: Review Issues — Features 07–10

Ngày: 2026-03-20
Nguồn: `review/20260319_2320_features-07-to-10.md`

## Tổng kết

Fix 12/19 issues từ review (1 Critical, 8 Important, 3 Minor). Bỏ qua 7 Minor issues ít impact (M-2 F07, M-3 F07, I-2 F08, I-3 F09, M-1 F10).

## Các fix đã thực hiện

### Feature 07 — cache-db.ts

**[I-1] getDB() race condition:**
- Thêm `openingPromise: Promise<IDBDatabase> | null = null`
- `getDB()` return `openingPromise` nếu đang mở, tránh 2 connection song song
- `openingPromise = null` sau khi `onsuccess` hoặc `onerror`

**[M-1] onversionchange handler:**
- Thêm `db.onversionchange = () => { db!.close(); db = null; }` trong `onsuccess`
- Cho phép DB upgrade trong tương lai không bị block

### Feature 08 — App.vue

**[I-1] Empty title overwrite:**
- Guard `!!detect.title` trong `hasChanges` check — không trigger change khi title empty
- Dùng `detect.title || cached.title` khi save vào cache + store update

**[M-1] Dead code navigateToTopic:**
- Xóa function `navigateToTopic()` trong SummaryView.vue — không còn được gọi kể từ khi navigation delegate sang `TopicMeta`

### Feature 09 — content/index.ts + SummaryContent.vue

**[I-1] XF1 false positive:**
- Bỏ selector `#messageList .message` — match cả Recent Posts, member profiles
- Chỉ giữ `li.message .messageText` (specific hơn với thread pages)

**[I-2] Supporter count regex:**
- `/\((\d+)\s*người[^)]*\)\s*$/` → `/\((\d+)\s*người[^)]*\)[.,:]?\s*$/`
- Cho phép trailing punctuation `.,:`  sau `)` —LLM hay thêm dấu câu cuối
- Cập nhật cả cleanup regex để strip trailing punctuation khi lấy cleanTitle

**[M-1] OpinionsView async race:**
- `loadTopicData()` capture `url = topic.url` trước async boundary
- Check `if (loadedTopicUrl.value !== url) return;` sau `await sendMessage(...)` — discard stale result nếu user đã switch sang topic khác

### Feature 10 — SummaryView.vue + article-extractor.ts

**[C-1] Incremental scrape off-by-one:**
- `Math.max(1, cachedPages)` → `Math.max(1, cachedPages + 1)`
- Không re-fetch page cuối đã cache mỗi lần incremental

**[I-1] Article fetch timeout:**
- Thêm `AbortController` với timeout 12 giây trong `extractArticle()`
- `clearTimeout(timeoutId)` trong `finally` block để cleanup dù success hay abort

**[I-3] Article posts filtered in incremental:**
- `posts.filter(p => p.postNumber > lastPostNumber)` → `posts.filter(p => p.postNumber < 0 || p.postNumber > lastPostNumber)`
- Article posts (postNumber âm) được giữ lại trong incremental — context bài báo gốc luôn có mặt

**[I-4] Sparse segment array:**
- `const updated = [...segmentSummaries.value]` → dùng `Array.from({ length: count }, ...)` để fill `null` thay vì undefined holes
- Tránh serialization issue khi persist sparse array vào IndexedDB

**[M-2] Info messages vs warnings:**
- Thêm `scrapingInfo = ref<string[]>([])` riêng cho informational messages
- "Đã tải N bài báo gốc" đưa vào `scrapingInfo` thay vì `scrapingWarnings`
- Template: thêm `alert-info` block hiển thị `scrapingInfo` — không lẫn với warning heading "Một số trang bị bỏ qua"
- Reset `scrapingInfo` trong block reset state đầu `loadTopicData()`

## Files đã thay đổi

- `lib/cache-db.ts` — race condition + onversionchange
- `lib/scrapers/article-extractor.ts` — fetch timeout
- `entrypoints/sidepanel/App.vue` — empty title guard
- `entrypoints/content/index.ts` — XF1 selector
- `entrypoints/sidepanel/components/SummaryContent.vue` — regex
- `entrypoints/sidepanel/views/OpinionsView.vue` — async race
- `entrypoints/sidepanel/views/SummaryView.vue` — C-1, I-3, I-4, M-1, M-2

## Kết quả

- `npx vue-tsc --noEmit` — pass, không có type error
