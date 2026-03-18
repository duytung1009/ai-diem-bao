# Phase 5 Code Review — Topic Hub + Tab-Switch Fix + Timeout

**Reviewed:** 2026-03-18
**Scope:** 12 tasks trong `planning/phase-5.md` vs. actual implementation
**Result:** 9 issues (1 Critical, 5 Important, 3 Minor)

---

## Tổng quan

Implementation phần lớn đúng theo kế hoạch. Tasks 1-3, 6, 8, 10-12 implement chính xác. Các vấn đề tập trung ở Tasks 4, 5, 7, 9.

**Issue nghiêm trọng nhất:** "Tab hiện tại" card trong TopicHubView sẽ KHÔNG BAO GIỜ hiển thị do bug double-unwrap `.value` trong template.

---

## TODO List

### Critical

- [ ] **C-1 (Task 7): Fix double-unwrap `.value` trong TopicHubView template**
  - **File:** `entrypoints/sidepanel/views/TopicHubView.vue`
  - **Vấn đề:** Trong Vue template, refs được tự động unwrap. `store.activeTabDetect` đã là giá trị `DetectResult | null` trong template. Code hiện tại dùng `store.activeTabDetect.value` → truy cập property `.value` trên object `DetectResult` → luôn `undefined` → card "Tab hiện tại" không bao giờ render.
  - **Các dòng cần sửa:**
    - Template: tất cả `store.activeTabDetect.value` → `store.activeTabDetect` (khoảng dòng 110, 117, 120-121, 176)
    - Template: `store.activeTabUrl.value` → `store.activeTabUrl` (nếu có trong template)
    - **Không sửa** code trong `<script setup>` — `.value` trong script là đúng
  - **Verify:** Sau khi sửa, mở sidepanel khi đang ở trang XenForo → phần "Tab hiện tại" phải hiển thị

---

### Important

- [ ] **I-1 (Task 9): `cachedTopic` không được gán từ store khi mount**
  - **File:** `entrypoints/sidepanel/views/SummaryView.vue`, block `onMounted`
  - **Vấn đề:** Khi `topic.summary` tồn tại, code set `summary.value` và `summarizedPostCount.value` nhưng KHÔNG set `cachedTopic.value = topic`. `cachedTopic` chỉ được populate từ `GET_CACHED_TOPIC` round-trip. Nếu round-trip fail → `cachedTopic` vẫn null → `ExportButton` (v-if="cachedTopic") và `CacheIndicator` không hiển thị.
  - **Fix:** Thêm `cachedTopic.value = topic as CachedTopic;` ngay sau dòng kiểm tra `if (topic)`, trước block `if (topic.summary)`

- [ ] **I-2 (Task 5/1): `DETECT_ACTIVE_TAB` message type khai báo nhưng không có handler**
  - **File:** `lib/types.ts` (dòng khai báo), `entrypoints/background/index.ts` (thiếu handler)
  - **Vấn đề:** `'DETECT_ACTIVE_TAB'` có trong `MessageType` union nhưng không có `case` nào trong background switch. App.vue dùng `browser.tabs.sendMessage` trực tiếp (đúng). Type thừa gây nhầm lẫn.
  - **Fix:** Xóa `'DETECT_ACTIVE_TAB'` khỏi `MessageType` union trong `lib/types.ts` vì không cần thiết — detection đi thẳng từ sidepanel → content script qua `browser.tabs.sendMessage`

- [ ] **I-3 (Task 9): Incremental update hiển thị error sai khi topic không phải active tab**
  - **File:** `entrypoints/sidepanel/views/SummaryView.vue`, function `handleSummarize`
  - **Vấn đề:** Khi user chọn topic từ Hub (không phải tab hiện tại) và click "Cập nhật" (incremental=true), error "Hãy mở topic này trên trình duyệt để đọc bài viết." hiển thị — giống hệt error của fresh summarize. User không hiểu tại sao không thể update.
  - **Fix:** Thay message cho trường hợp incremental: `"Hãy mở topic này trên trình duyệt để tải bài viết mới."` hoặc cho phép fallback re-summarize từ cached posts

- [ ] **I-4 (Task 11): `clearHistory` dùng non-null assertion không an toàn**
  - **File:** `entrypoints/sidepanel/views/ResearchView.vue`, function `clearHistory`
  - **Vấn đề:** `cachedTopic.value!.url` dùng `!` assertion mà không kiểm tra null. Template guard (`v-if="cachedTopic?.posts?.length"`) bảo vệ gián tiếp nhưng code thiếu defensive check.
  - **Fix:** Thêm `if (!cachedTopic.value) return;` ở đầu function `clearHistory()`

- [ ] **I-5 (Task 4): `_selectedTopic` writable ref bị bỏ khỏi useTopicStore**
  - **File:** `entrypoints/sidepanel/composables/useTopicStore.ts`
  - **Vấn đề:** Plan ghi rõ export `_selectedTopic: selectedTopic` để có escape hatch cho writable access. Implementation bỏ qua. Hiện tại không có consumer nào cần, nhưng thiếu so với plan.
  - **Fix:** Bỏ qua nếu không cần, hoặc thêm comment giải thích tại sao omit. Không blocking.

---

### Minor

- [ ] **M-1 (Task 7): Topic list stale khi quay lại Hub sau khi summarize**
  - **File:** `entrypoints/sidepanel/views/TopicHubView.vue`
  - **Vấn đề:** `allTopics` chỉ load trong `onMounted`. Khi user summarize xong → quay lại Hub, topic list có thể stale. Hiện tại không có `<keep-alive>` nên component re-mount mỗi lần navigate → vấn đề tự giải quyết. Nhưng nếu thêm `<keep-alive>` sau này sẽ bị lỗi.
  - **Fix (optional):** Thêm `onActivated` hook reload `allTopics`, hoặc watch `store.selectedTopic` để sync

- [ ] **M-2 (Task 7/4): Minimal CachedTopic có `llmConfig` rỗng**
  - **File:** `entrypoints/sidepanel/views/TopicHubView.vue`, function `handleActiveTabTopic`
  - **Vấn đề:** Khi tạo minimal CachedTopic từ active tab detect, `llmConfig: { provider: '', model: '' }` → nếu object này bị dùng cho export trước khi save, sẽ có data rỗng. Thực tế SummaryView populate `cachedTopic` từ background round-trip nên không ảnh hưởng.
  - **Fix (optional):** Load `DEFAULT_LLM_CONFIG` vào minimal object, hoặc bỏ qua

- [ ] **M-3 (Task 12): Timeout slider — cosmetic only**
  - **File:** `entrypoints/sidepanel/views/SettingsView.vue`
  - **Vấn đề:** Không có bug thực sự. Label hiển thị đúng, `?? 120000` fallback xử lý null case đúng. Noted for completeness.
  - **Fix:** Không cần action

---

## Các task implement đúng (không cần sửa)

| Task | File(s) | Status |
|------|---------|--------|
| 1 | `lib/types.ts`, `lib/constants.ts` | ✅ Đúng theo plan |
| 2 | `lib/errors.ts` | ✅ Đúng theo plan |
| 3 | `openai-adapter.ts`, `claude-adapter.ts` | ✅ AbortController + timeout đúng pattern |
| 6 | `lib/cache-manager.ts` | ✅ Filter sửa đúng |
| 8 | `main.ts`, `App.vue` | ✅ Router + nav 5 tabs đúng |
| 10 | `OpinionsView.vue` | ✅ Topic store integration đúng |
| 12 | `SettingsView.vue` | ✅ Timeout slider đúng |

---

## Priority fix order

1. **C-1** — Fix ngay, "Tab hiện tại" hoàn toàn không hoạt động
2. **I-1** — Fix ngay, ExportButton/CacheIndicator có thể không hiển thị
3. **I-2** — Quick fix, xóa type thừa
4. **I-4** — Quick fix, thêm null guard
5. **I-3** — UX improvement, sửa error message
6. **I-5** — Optional, document deviation
