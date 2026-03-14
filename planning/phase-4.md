# Phase 4 — Research + Polish

**Mục tiêu:** Hoàn thiện tính năng tra cứu mở rộng, export, error handling, và đánh bóng UX.

---

## 4.1 Research / Extended Analysis View

- [ ] `src/sidepanel/views/ResearchView.vue`:
  - Input field cho câu hỏi cụ thể về topic ("Ai đề cập đến X?", "So sánh ý kiến về Y")
  - Hiển thị kết quả dạng Q&A
  - Gợi ý keyword/câu hỏi dựa trên nội dung topic đã scrape
  - Lưu history câu hỏi đã tra cứu vào cache
- [ ] Prompt template cho research:
  - `RESEARCH_PROMPT` trong `prompts.ts`
  - Nhận context là posts đã scrape + câu hỏi của user
  - Output: câu trả lời có trích dẫn source (post number, author)
- [ ] Lưu kết quả vào `cached.summaries.research` (hoặc array nếu nhiều câu hỏi)

## 4.2 Export Functionality

- [ ] `src/sidepanel/components/ExportButton.vue`:
  - Dropdown menu: "Copy Markdown", "Copy Text", "Download .md"
- [ ] Export logic:
  - **Copy Markdown:** summary + opinions + metadata → clipboard dạng markdown
  - **Copy Text:** plain text version (strip markdown syntax)
  - **Download .md:** tạo file markdown với header (topic title, URL, date, model used)
  - Sử dụng `navigator.clipboard.writeText()` cho copy
  - Sử dụng `chrome.downloads.download()` hoặc Blob URL cho download
- [ ] Notification sau khi copy: toast "Đã sao chép!" hiển thị 2 giây

## 4.3 Error Handling & Retry

- [ ] Centralized error handling:
  - `src/shared/errors.ts`:
    - Custom error classes: `ScrapingError`, `LLMError`, `CacheError`, `NetworkError`
    - Error codes enum cho từng loại lỗi
  - Error messages tiếng Việt thân thiện
- [ ] Retry logic trong `llm/` adapters:
  - Retry tối đa 3 lần cho lỗi 429 (rate limit) và 5xx (server error)
  - Exponential backoff: 1s, 2s, 4s
  - Không retry cho 401 (auth) hoặc 400 (bad request)
- [ ] UI error states:
  - `src/sidepanel/components/ErrorDisplay.vue`:
    - Hiển thị lỗi dạng card với icon, message, và action button
    - Actions: "Thử lại", "Kiểm tra cài đặt", "Báo lỗi"
  - Inline error cho từng view (summary, opinions, research)
- [ ] Scraping error handling:
  - Forum yêu cầu đăng nhập → "Vui lòng đăng nhập vào forum trước"
  - Trang không phải XenForo → "Trang này không phải forum XenForo"
  - Timeout scraping → "Không thể tải trang, vui lòng thử lại"

## 4.4 Custom Prompt Templates

- [ ] UI trong `SettingsView.vue`:
  - Section "Prompt Templates" với tabs: Summary, Opinions, Research
  - Mỗi tab: textarea chỉnh sửa prompt, nút "Reset Default"
  - Placeholder hints: `{{posts}}`, `{{topic_title}}`, `{{post_count}}`
  - Lưu custom prompts vào `chrome.storage.sync`
- [ ] Logic load prompt:
  - Ưu tiên custom prompt nếu có
  - Fallback về default prompt
  - Validate prompt có chứa placeholder bắt buộc `{{posts}}`

## 4.5 UX Polish

- [ ] Responsive layout cho side panel (narrow width ~400px)
- [ ] Dark mode support (detect `prefers-color-scheme` hoặc toggle)
- [ ] Keyboard shortcuts:
  - `Ctrl+Shift+S` → trigger summarize
  - Tab navigation giữa các views
- [ ] Empty states:
  - Chưa mở topic XenForo → hướng dẫn sử dụng
  - Chưa cài API key → link đến Settings
- [ ] Smooth transitions giữa loading → content → error states
- [ ] Tooltip cho các icon/button
- [ ] Badge trên extension icon: hiển thị khi có cache cho tab hiện tại

## 4.6 Performance & Cleanup

- [ ] Review bundle size: ensure < 500KB (không tính assets)
- [ ] Lazy load views (Vue Router `() => import(...)`)
- [ ] Service worker lifecycle: đảm bảo không bị kill giữa chừng khi gọi LLM
  - Sử dụng `chrome.runtime.getBackgroundPage` hoặc keep-alive techniques
- [ ] Memory cleanup: dispose listeners khi content script unload
- [ ] CSP compliance: không dùng `eval`, inline scripts

## 4.7 Documentation

- [ ] `README.md`:
  - Mô tả project, screenshots
  - Hướng dẫn cài đặt (load unpacked extension)
  - Hướng dẫn cấu hình API key
  - Supported forums / XenForo versions
  - Development setup instructions
- [ ] Code comments cho các phần phức tạp (detector, map-reduce, cache)

## 4.8 Final Testing

- [ ] Test trên nhiều forum XF1 và XF2 thực tế
- [ ] Test với các LLM provider: OpenAI, Claude, LM Studio local
- [ ] Test edge cases:
  - Topic rỗng (0 posts)
  - Topic cực dài (500+ trang)
  - API key hết quota
  - Mất kết nối mạng giữa chừng
  - Nhiều tab mở cùng lúc
- [ ] Test trên Chrome stable và Chrome beta
- [ ] Kiểm tra performance: thời gian scrape, memory usage

---

**Definition of Done Phase 4:**
Extension hoàn chỉnh, có đầy đủ tính năng (summary, opinions, research), export, error handling tốt, UX mượt mà, và sẵn sàng publish lên GitHub / Chrome Web Store.
