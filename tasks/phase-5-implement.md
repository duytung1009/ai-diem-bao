# Phase 5 Implementation Summary

## Mục tiêu đã hoàn thành
1. ✅ Không reload toàn bộ app khi chuyển tab — xóa `onTabActivated` listener khỏi SummaryView
2. ✅ Topic Hub hiển thị tất cả chủ đề đã cache, phân loại theo domain
3. ✅ Mỗi chủ đề hiển thị trạng thái tóm tắt và thời gian
4. ✅ Chọn chủ đề → xem tóm tắt hoặc nút "Tóm tắt" nếu chưa có
5. ✅ Cấu hình timeout cho LLM calls trong Settings

## Build & Type Check
- **Type check:** `npx vue-tsc --noEmit` → PASS (0 errors)
- **Build:** `npm run build` → PASS (287.86 kB, TopicHubView lazy-loaded)

---

## Các file đã thay đổi

### `lib/types.ts`
- Thêm `timeoutMs?: number` vào `LLMConfig`
- Thêm `'GET_ALL_CACHED_TOPICS'` và `'DETECT_ACTIVE_TAB'` vào `MessageType`

### `lib/constants.ts`
- Thêm `timeoutMs: 120000` vào `DEFAULT_LLM_CONFIG`

### `lib/errors.ts`
- Thêm `TIMEOUT = 'TIMEOUT'` vào `LLMErrorCode`
- Thêm message tiếng Việt cho TIMEOUT error

### `lib/cache-manager.ts`
- Fix filter trong `getAllCachedTopics`: từ `'summary' in value` → `'url' in value && 'title' in value`
- Mục đích: hiển thị cả topics đã scrape nhưng chưa tóm tắt trong Hub

### `lib/llm/openai-adapter.ts`
- Import thêm `LLMError, LLMErrorCode`
- Wrap fetch trong `chatCompletion` với AbortController + timeout
- AbortError → throws `LLMError(TIMEOUT)`

### `lib/llm/claude-adapter.ts`
- Wrap fetch trong `chatCompletion` với AbortController + timeout
- AbortError → throws `LLMError(TIMEOUT)`

### `lib/cache-manager.ts`
- *(đã ghi ở trên)*

### `entrypoints/background/index.ts`
- Import `getAllCachedTopics`
- Thêm case `GET_ALL_CACHED_TOPICS`: trả về toàn bộ cached topics
- Fix case `GET_CACHED_TOPIC`: hỗ trợ `payload` URL (nếu có) thay vì luôn dùng active tab
- Fix case `SAVE_CACHED_TOPIC`: hỗ trợ `url` field trong payload thay vì chỉ dùng active tab

### `entrypoints/sidepanel/composables/useTopicStore.ts` (MỚI)
- Singleton store dùng module-level `ref()` (không cần Pinia)
- State: `selectedTopic`, `activeTabDetect`, `activeTabUrl`
- Actions: `selectTopic`, `clearSelection`, `setActiveTab`, `updateSelectedTopic`
- Tất cả state dùng `readonly()` để tránh mutation trực tiếp

### `entrypoints/sidepanel/views/TopicHubView.vue` (MỚI)
- Route: `'/'` (index)
- Load toàn bộ cached topics qua `GET_ALL_CACHED_TOPICS`
- Group theo domain, sort by `cachedAt` descending
- Hiển thị "Tab hiện tại" nếu active tab là XenForo topic chưa có trong list
- Status badge: "✓ Đã tóm tắt" hoặc "○ Chưa tóm tắt"
- Click topic → `store.selectTopic()` → navigate `/summary`

### `entrypoints/sidepanel/main.ts`
- Thêm route `/` → `TopicHubView` (đổi từ SummaryView)
- Route `/summary` → SummaryView (giữ nguyên)

### `entrypoints/sidepanel/App.vue`
- `onMounted`: detect active tab 1 lần → `store.setActiveTab(result, tab.url)`
- Tab "Chủ đề" (`/`): `<router-link>` (luôn enabled)
- Tab "Tóm tắt", "Ý kiến", "Tra cứu": `<button>` disabled khi `!store.selectedTopic.value`
- Tab "Cài đặt": `<router-link>` (luôn enabled)

### `entrypoints/sidepanel/views/SummaryView.vue`
**Thay đổi lớn:**
- Xóa: `onTabActivated`, `resetState`, `detectTopic`, `checkCache`, `isDetecting` ref, tab listener
- Thêm: `useRouter`, `useTopicStore`
- `topicInfo` thay bằng `computed` từ `store.selectedTopic.value`
- `onMounted`: load từ store → reload fresh cache với URL cụ thể
- `handleSummarize`: nếu topic đã có posts → dùng trực tiếp; nếu không → scrape từ active tab (nếu URL match)
- `confirmSummarize`: truyền `url: topic.url` vào `SAVE_CACHED_TOPIC`; sau khi save gọi `store.updateSelectedTopic()`
- Thêm nút "← Quay lại danh sách"

### `entrypoints/sidepanel/views/OpinionsView.vue`
- Thêm `useTopicStore`
- `onMounted`: load store → reload fresh cache với URL cụ thể
- `handleAnalyze`: truyền `url: cachedTopic.value.url` vào `SAVE_CACHED_TOPIC`; gọi `store.updateSelectedTopic({ opinions: result })`

### `entrypoints/sidepanel/views/ResearchView.vue`
- Thêm `useTopicStore`
- `onMounted`: load store (với `[...spread]` fix) → reload fresh cache với URL cụ thể
- `handleResearch`: truyền `url` vào save; gọi `store.updateSelectedTopic({ researchHistory })`
- `clearHistory`: truyền `url` vào save; gọi `store.updateSelectedTopic({ researchHistory: [] })`

### `entrypoints/sidepanel/views/SettingsView.vue`
- `onMounted`: `config.value = { ...loaded, timeoutMs: loaded.timeoutMs ?? 120000 }`
- Thêm UI slider "Timeout: Xs" (30s–600s, step 30s) trước nút Actions

---

## Type Fix
- `SummaryView.vue`: `pendingPosts.value = [...topic.posts]` (spread để mutable)
- `ResearchView.vue`: `history.value = [...(topic.researchHistory ?? [])]` (spread để mutable)
- Nguyên nhân: `store.selectedTopic` dùng `readonly()` → Vue DeepReadonly wrapper làm arrays bất biến

---

## Pattern quan trọng
- `useTopicStore` = singleton store pattern dùng module-level refs (không cần Pinia/Vuex)
- Tab switch không còn reset app — `App.vue` chỉ detect 1 lần khi sidepanel mở
- Khi user chọn topic từ Hub → navigate `/summary` → SummaryView đọc từ store
- `GET_CACHED_TOPIC` và `SAVE_CACHED_TOPIC` giờ nhận `url` trong payload thay vì dùng active tab
