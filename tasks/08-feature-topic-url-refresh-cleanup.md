# Feature 08: Topic URL navigation, Refresh topic info, Xóa ExportButton, Fix CacheIndicator

## Status: ✅ DONE

## Files Changed

- `entrypoints/sidepanel/views/SummaryView.vue`
- `entrypoints/sidepanel/views/TopicHubView.vue`

---

## Task 3: Xóa ExportButton (làm trước)

**SummaryView.vue:**
- Xóa `import ExportButton from '../components/ExportButton.vue'`
- Xóa `<ExportButton v-if="cachedTopic" :topic="cachedTopic" />` khỏi template
- Xóa wrapper `<div class="flex gap-2">` chứa nút "Tóm tắt lại"
- Đổi nút "Tóm tắt lại" từ `flex-1` → `w-full`
- File `ExportButton.vue` giữ nguyên trong codebase

---

## Task 1: URL navigation

**SummaryView.vue:**
- Thêm `import watch` vào Vue imports
- Thêm function `navigateToTopic()`: query active tab, nếu tab có ID thì `browser.tabs.update(tab.id, { url })`, fallback `browser.tabs.create({ url })`
- Thêm UI bên dưới `<TopicMeta>`: button hiện URL topic, truncate max-w-full, click → `navigateToTopic()`

---

## Task 4: Fix CacheIndicator

**SummaryView.vue:**
- Thêm computed `livePostCount`: nếu activeTab khớp topic URL → dùng `store.activeTabDetect.value.postCount`; fallback `topic.totalPosts`
- Thêm `watch(livePostCount, ...)` → tự động re-evaluate `cacheFreshness` khi postCount thay đổi
- Thay `:current-posts="topicInfo?.postCount ?? 0"` → `:current-posts="livePostCount"` trên `<CacheIndicator>`
- Đơn giản hoá `loadTopicData()`: bỏ if/else phân nhánh, dùng `evaluateFreshness(fresh, livePostCount.value)` thống nhất

---

## Task 2a: Refresh button trong SummaryView

**SummaryView.vue:**
- Thêm `isRefreshing = ref(false)`
- Thêm function `refreshTopicInfo()`:
  - Query active tab, kiểm tra URL khớp topic (qua `isSameTopicUrl`)
  - Nếu không khớp → set `error.value` với thông báo user-friendly
  - Nếu khớp → gửi `DETECT_XF` đến tab → nhận `DetectResult`
  - Cập nhật `store.updateSelectedTopic({ totalPosts, totalPages, title })`
  - Re-evaluate `cacheFreshness` theo postCount mới
- Thay back-button đơn → flex row `justify-between`:
  - Trái: nút "← Quay lại danh sách"
  - Phải: nút "Cập nhật" với icon refresh SVG, `animate-spin` khi đang refresh

---

## Task 2b: Refresh button trong TopicHubView

**TopicHubView.vue:**
- Thêm `import DetectResult` vào types import
- Thêm `refreshingUrl = ref<string | null>(null)`
- Thêm function `refreshTopic(topic)`:
  - Query active tab, so sánh URL qua `normalizeForCompare`
  - Nếu không khớp → return sớm (silent)
  - Gửi `DETECT_XF` → cập nhật `allTopics.value[idx]` tại chỗ
  - Nếu topic đang selected trong store → cũng gọi `store.updateSelectedTopic()`
- Thay nút Xóa đơn (`<button>`) → container `<div class="absolute top-2 right-2 flex items-center gap-0.5">` gồm 2 nút:
  1. Nút refresh (icon quay, `animate-spin` khi `refreshingUrl === topic.url`)
  2. Nút xóa (icon X, giữ nguyên logic cũ)
- Đổi title padding `pr-6` → `pr-12` để tránh overlap với 2 nút

---

## Verification
- `npx vue-tsc --noEmit` ✅ pass
- `npm run build` ✅ pass (301.37 kB)
