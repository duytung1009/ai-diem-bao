# Phase 4 Implementation Summary

**Ngày thực hiện:** 2026-03-17
**Status:** DONE — Build thành công (254 kB), type-check sạch
**Bundle size:** 254.99 kB (lazy-loaded views, dưới 500 kB target)

---

## Tổng quan

Phase 4 hoàn thiện extension với đầy đủ tính năng: Research/tra cứu, export, error handling nâng cao, custom prompts, và UX polish.

---

## Các file mới tạo

### `lib/errors.ts`
Custom error classes với messages tiếng Việt thân thiện:
- `ScrapingError` + `ScrapingErrorCode` — NOT_XENFORO, LOGIN_REQUIRED, TIMEOUT, EMPTY_TOPIC
- `LLMError` + `LLMErrorCode` — AUTH_FAILED, RATE_LIMITED, SERVER_ERROR, BAD_REQUEST, NETWORK_ERROR
- `CacheError`, `NetworkError`
- Helper: `isRetryableStatus(status)` — true cho 429 và 5xx
- Helper: `llmErrorFromStatus(status, body)` — map HTTP status → LLMError

### `entrypoints/sidepanel/views/ResearchView.vue`
Tab "Tra cứu" mới:
- Textarea nhập câu hỏi (Ctrl+Enter submit)
- Gợi ý câu hỏi tự động khi history trống
- Hiển thị Q&A history theo thứ tự mới nhất trước
- Lưu history vào `CachedTopic.researchHistory` (persist qua reload)
- Nút "Xóa tất cả" để clear history

### `entrypoints/sidepanel/components/ExportButton.vue`
Dropdown export với 3 tùy chọn:
- **Sao chép Markdown** — summary + opinions + metadata → clipboard
- **Sao chép văn bản** — strip markdown syntax, copy plain text
- **Tải file .md** — download qua Blob URL với tên file từ topic title
- Toast notification "Đã sao chép!" / "Đã tải file!" hiển thị 2 giây
- Click-outside overlay để đóng dropdown

### `entrypoints/sidepanel/components/ErrorDisplay.vue`
Reusable error card component:
- Icon cảnh báo + message
- Props: `message`, `action` ('retry' | 'settings' | 'none')
- Emit: `retry`, `settings`

### `README.md`
Documentation dự án:
- Mô tả tính năng
- Supported forums/providers
- Hướng dẫn cài đặt và cấu hình
- Cấu trúc dự án
- Development commands

---

## Các file đã sửa đổi

### `lib/types.ts`
- `MessageType`: + `RESEARCH_QUERY`, `GET_CUSTOM_PROMPTS`, `SAVE_CUSTOM_PROMPTS`
- `CachedTopic`: + field `researchHistory?: ResearchEntry[]`
- Interface mới: `ResearchEntry { question, answer, askedAt }`
- Interface mới: `CustomPrompts { summary?, opinions?, research? }`

### `lib/constants.ts`
- `STORAGE_KEYS`: + `CUSTOM_PROMPTS: 'custom-prompts'`

### `lib/prompts.ts`
- Thêm `RESEARCH_PROMPT` — system prompt cho tra cứu Q&A với trích dẫn source (post number, author)

### `lib/llm/summarizer.ts`
- `summarizeTopic` — thêm param `customPrompts?: CustomPrompts`
- `updateSummary` — thêm param `customPrompts?: CustomPrompts`
- `analyzeOpinions` — thêm param `customPrompts?: CustomPrompts`
- Hàm mới: `researchTopic(posts, question, config, onProgress?, customPrompts?)` — đặt câu hỏi về topic với context-aware chunking

### `lib/llm/openai-adapter.ts`
- Import + dùng `llmErrorFromStatus` từ `lib/errors.ts`
- Thêm `withRetry<T>()` — retry tối đa 3 lần, exponential backoff (1s, 2s, 4s), chỉ retry 429/5xx
- `chatCompletion` wraps trong `withRetry`

### `lib/llm/claude-adapter.ts`
- Cùng pattern retry như `openai-adapter.ts`
- Import + dùng `llmErrorFromStatus`
- `withRetry` trong `chatCompletion` (sau mock check)

### `entrypoints/background/index.ts`
- Import: thêm `researchTopic`, `CustomPrompts`
- `SUMMARIZE` handler: load custom prompts và pass vào `summarizeTopic`
- `SUMMARIZE_INCREMENTAL` handler: cùng pattern
- `ANALYZE_OPINIONS` handler: cùng pattern
- Handler mới: `RESEARCH_QUERY` — nhận `{ posts, question }`, gọi `researchTopic`
- Handler mới: `GET_CUSTOM_PROMPTS` — đọc từ `browser.storage.sync`
- Handler mới: `SAVE_CUSTOM_PROMPTS` — lưu vào `browser.storage.sync`
- `SAVE_CACHED_TOPIC` handler: merge `researchHistory` field
- Helper mới: `getCustomPrompts()`, `saveCustomPrompts()`

### `entrypoints/sidepanel/views/SettingsView.vue`
- Import `CustomPrompts`, default prompts từ `lib/prompts.ts`
- Thêm section "Prompt Templates" cuối trang
- Tabs: Tóm tắt / Ý kiến / Tra cứu
- Textarea chỉnh sửa prompt với placeholder hint dạng textarea mờ
- Dot indicator trên tab khi có custom prompt
- Nút "Lưu Prompts" và "Reset mặc định"
- Validation: prompt không được trống (với note về `{{posts}}` placeholder)

### `entrypoints/sidepanel/views/SummaryView.vue`
- Import `ExportButton`
- Thêm `<ExportButton>` cạnh nút "Tóm tắt lại" khi có kết quả

### `entrypoints/sidepanel/App.vue`
- Thêm tab "Tra cứu" → route `/research`
- Tab text giảm xuống `text-xs` để vừa 4 tabs trong 1 hàng

### `entrypoints/sidepanel/main.ts`
- Chuyển sang **lazy loading** cho tất cả views: `() => import('./views/...')`
- Thêm route `/research` → `ResearchView.vue`
- Xóa static imports của views cũ

---

## Quyết định thiết kế

- **Research context**: Câu hỏi được inject như một post cuối cùng (`USER_QUESTION`) để dùng map-reduce path khi cần
- **Custom prompts validation**: Chỉ warn, không block — vì research prompt không cần `{{posts}}` literal
- **Export**: Dùng Blob + `URL.createObjectURL` thay vì `chrome.downloads.download` để tránh cần permission bổ sung
- **Retry**: `withRetry` là local function trong mỗi adapter thay vì shared util — tránh coupling giữa adapter và `lib/errors.ts` qua module boundary

---

## Phase 4 items KHÔNG triển khai (để sau hoặc out-of-scope)

- **4.5 Dark mode** — Cần thêm `prefers-color-scheme` media query hoặc toggle state; bỏ qua để tập trung vào tính năng cốt lõi
- **4.5 Keyboard shortcuts** (`Ctrl+Shift+S`) — Cần content script + command registration trong manifest
- **4.5 Extension badge** — Cần background script polling, minor UX value
- **4.6 Service worker keep-alive** — WXT handles lifecycle; chưa cần thiết với current flow
- **4.8 Testing** — Manual testing, không có automated test framework

---

## Build artifacts

```
background.js      16.28 kB
SummaryView        17.15 kB  (lazy chunk)
SettingsView       10.67 kB  (lazy chunk)
OpinionsView        5.03 kB  (lazy chunk)
ResearchView        4.10 kB  (lazy chunk)
MarkdownContent    41.21 kB  (lazy chunk, marked.js)
sidepanel          101.4 kB  (Vue runtime + router + shared)
Σ Total:           254.99 kB
```
