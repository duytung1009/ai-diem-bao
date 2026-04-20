# Bug Fix: Review Feature 12 — 4 Issues

Ngày: 2026-03-20
Dựa trên: `review/20260320_2121_feature-12-scrape-any-tab.md`

---

## C-1 (Critical): `isSameTopicUrl()` thiếu trailing slash normalization

**File:** `SummaryView.vue`

**Vấn đề:** `normalizeUrl()` trong cache-manager luôn thêm trailing slash, nhưng `isSameTopicUrl()` không → so sánh sai khi URL đã normalize (có slash) vs URL gốc (không slash) → loading biến mất khi user quay lại topic đang tóm tắt.

**Fix:** Thêm `if (!parsed.pathname.endsWith('/')) parsed.pathname += '/'` và đổi regex từ `/\/page-\d+$/` thành `/\/page-\d+\/?$/` để đồng bộ với `normalizeUrl()`.

---

## C-2 (Critical): `autoUpdateCachedTopic` cập nhật `totalPages` → incremental range rỗng

**File:** `App.vue`

**Vấn đề:** `autoUpdateCachedTopic()` lưu `totalPages: detect.pageCount` vào IndexedDB → khi user click "Cập nhật", `cachedPages = cachedTopic.value.totalPages` đã bằng live count → `startPage > endPage` → 0 posts mới → incremental không hoạt động.

**Fix:** Tách cache save và store update:
- **Cache:** chỉ lưu `title` khi thay đổi — **không lưu `totalPages`** (giữ giá trị lúc tóm tắt cuối)
- **Store:** vẫn cập nhật `totalPages` live để hiển thị UI đúng

---

## I-1 (Important): `pageCount` lấy nhầm từ `activeTabDetect` khi tab khác

**File:** `SummaryView.vue`

**Vấn đề:** `store.activeTabDetect.value?.pageCount` được dùng ngay cả khi active tab mở topic khác cùng domain → scrape nhầm số trang.

**Fix:** Chỉ dùng `activeTabDetect.pageCount` khi URL của active tab khớp với topic đang xem:
```ts
const detectMatchesTopic = store.activeTabUrl.value
  && isSameTopicUrl(store.activeTabUrl.value, topic.url);
const pageCount = (detectMatchesTopic ? store.activeTabDetect.value?.pageCount : null)
  ?? topic.totalPages ?? 1;
```

---

## I-2 (Important): `SCRAPE_TOPIC` single-page scrape nhầm topic

**File:** `SummaryView.vue`

**Vấn đề:** `SCRAPE_TOPIC` handler đọc live DOM của tab → nếu `findForumTab()` trả về tab đang mở topic khác → scrape nhầm nội dung.

**Fix:** Thay `SCRAPE_TOPIC` bằng `scrapeInChunks(tabId, topic.url, 1, 1, 0)` — dùng `SCRAPE_PAGE_RANGE` với `baseUrl=topic.url`, `startPage=1`, `endPage=1`, `delayMs=0`. Đảm bảo fetch đúng URL topic bất kể tab đang mở trang nào.

---

## Kết quả

- `npx vue-tsc --noEmit` → pass
- `npm run build` → pass
