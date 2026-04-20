# Phase 5 Code Review Fix — Tóm Tắt

**Thực hiện:** 2026-03-18
**Dựa trên:** `review/phase-5.md`
**Kết quả:** Build + type check pass sau khi fix

---

## C-1: FALSE POSITIVE — Không fix

**Review claim:** Template `TopicHubView.vue` dùng `store.activeTabDetect.value` bị double-unwrap.

**Thực tế:** TypeScript compiler xác nhận `store.activeTabDetect` trong template có type `Readonly<Ref<DetectResult | null>>` — **không** tự-unwrap. Lý do: Vue 3 chỉ auto-unwrap top-level refs trong template, còn `store.activeTabDetect` là property lồng trong một plain object (không phải `reactive()`). Accessor `.value` là **đúng và cần thiết** trong cả script lẫn template.

**Bằng chứng:** Khi thử áp dụng fix theo review (bỏ `.value` trong template), `npx vue-tsc` báo lỗi:
```
TS2339: Property 'title' does not exist on type 'Readonly<Ref<...>>'
```

**Action:** Không thay đổi code. Nếu "Tab hiện tại" card thực sự không hiển thị, nguyên nhân là `App.vue` chưa gọi `store.setActiveTab()` chứ không phải template bug.

---

## I-1: Fixed ✅

**File:** `entrypoints/sidepanel/views/SummaryView.vue`

**Vấn đề:** `cachedTopic.value` chỉ được set khi `GET_CACHED_TOPIC` round-trip thành công. Nếu round-trip fail → `cachedTopic` null → `ExportButton` (`v-if="cachedTopic"`) và `CacheIndicator` không hiển thị dù `summary` đã có.

**Fix:** Thêm `cachedTopic.value = topic as CachedTopic;` ngay sau `if (topic) {`, trước khi await round-trip. Round-trip vẫn chạy để lấy data mới nhất nhưng UI hiển thị đúng ngay cả khi fail.

```ts
// onMounted — SummaryView.vue
const topic = store.selectedTopic.value;
if (topic) {
  // Populate cachedTopic immediately from store so ExportButton/CacheIndicator won't be hidden
  // if the GET_CACHED_TOPIC round-trip below fails
  cachedTopic.value = topic as CachedTopic;  // <-- ADDED
  if (topic.summary) {
    ...
```

---

## I-2: Fixed ✅

**File:** `lib/types.ts`

**Vấn đề:** `'DETECT_ACTIVE_TAB'` có trong `MessageType` union nhưng không có handler nào trong background. Detection đi thẳng từ sidepanel → content script qua `browser.tabs.sendMessage` (không qua background). Type thừa gây nhầm lẫn.

**Fix:** Xóa `'DETECT_ACTIVE_TAB'` khỏi `MessageType` union.

---

## I-3: Fixed ✅

**File:** `entrypoints/sidepanel/views/SummaryView.vue`, function `handleSummarize`

**Vấn đề:** Khi incremental update nhưng topic không phải active tab, error message giống hệt fresh summarize: `"Hãy mở topic này trên trình duyệt để đọc bài viết."` — user không hiểu tại sao cập nhật fail.

**Fix:** Dùng message khác nhau theo context:

```ts
if (!isActiveTab) {
  error.value = incremental
    ? 'Hãy mở topic này trên trình duyệt để tải bài viết mới.'
    : 'Hãy mở topic này trên trình duyệt để đọc bài viết.';
  return;
}
```

---

## I-4: Fixed ✅

**File:** `entrypoints/sidepanel/views/ResearchView.vue`, function `clearHistory`

**Vấn đề:** `cachedTopic.value!.url` dùng non-null assertion (`!`) mà không guard. Template guard gián tiếp bảo vệ nhưng code thiếu explicit check.

**Fix:** Thêm null guard ở đầu function:

```ts
function clearHistory() {
  if (!cachedTopic.value) return;  // <-- ADDED
  history.value = [];
  ...
```

---

## I-5: Documented ✅

**File:** `entrypoints/sidepanel/composables/useTopicStore.ts`

**Vấn đề:** Plan đề xuất expose `_selectedTopic` writable ref làm escape hatch nhưng implementation bỏ qua mà không có giải thích.

**Fix:** Thêm comment giải thích:

```ts
return {
  // State (readonly để tránh mutation trực tiếp từ bên ngoài)
  // Note: plan đề xuất expose `_selectedTopic` writable ref làm escape hatch,
  // nhưng bỏ qua vì không có consumer nào cần — dùng updateSelectedTopic() thay thế.
  selectedTopic: readonly(selectedTopic),
  ...
```

---

## Minor (M-1, M-2, M-3)

Tất cả để nguyên:
- **M-1** (stale topic list): Component re-mounts mỗi lần navigate (không `<keep-alive>`) → tự load lại, không vấn đề hiện tại.
- **M-2** (minimal CachedTopic với llmConfig rỗng): SummaryView luôn populate `cachedTopic` từ background round-trip trước khi export, không ảnh hưởng thực tế.
- **M-3** (timeout slider label): Không có bug thực sự.

---

## Files Đã Sửa

| File | Thay đổi |
|------|----------|
| `lib/types.ts` | Xóa `DETECT_ACTIVE_TAB` khỏi MessageType (I-2) |
| `entrypoints/sidepanel/views/SummaryView.vue` | Set `cachedTopic` sớm (I-1) + incremental error msg (I-3) |
| `entrypoints/sidepanel/views/ResearchView.vue` | Null guard trong `clearHistory` (I-4) |
| `entrypoints/sidepanel/composables/useTopicStore.ts` | Comment giải thích `_selectedTopic` omission (I-5) |

**Build:** `npm run build` → 287.98 kB, no errors
**Type check:** `npx vue-tsc --noEmit` → pass
