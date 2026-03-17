# AI Điểm Báo

Chrome Extension tóm tắt các topic thảo luận trên forum XenForo bằng LLM (Large Language Model).

## Tính năng

- **Tóm tắt tự động** — Đọc toàn bộ topic (kể cả nhiều trang) và tóm tắt nội dung thảo luận bằng AI
- **Phân tích ý kiến** — Nhóm các quan điểm, xác định phe ủng hộ/phản đối, đánh giá sentiment
- **Tra cứu (Research)** — Đặt câu hỏi cụ thể về nội dung topic và nhận câu trả lời có trích dẫn
- **Export** — Sao chép Markdown, plain text, hoặc tải file `.md`
- **Cache thông minh** — Lưu kết quả vào local storage, phát hiện khi có bài mới
- **Custom prompts** — Tuỳ chỉnh hướng dẫn cho từng loại phân tích
- **Retry tự động** — Tự thử lại khi gặp lỗi rate limit (429) hoặc lỗi server (5xx)
- **Map-reduce** — Tự động chia nhỏ topic > context limit thành nhiều chunk để xử lý

## Hỗ trợ

- **Forum:** XenForo 1.x và XenForo 2.x
- **LLM Providers:** OpenAI, Anthropic Claude, bất kỳ API tương thích OpenAI (LM Studio, Ollama, v.v.)
- **Trình duyệt:** Chrome (Manifest V3)

## Cài đặt (Development)

### Yêu cầu

- Node.js 18+
- npm

### Bước cài đặt

```bash
# Clone repo
git clone <repo-url>
cd ai-diem-bao

# Cài dependencies
npm install

# Build extension
npm run build

# Dev mode (hot reload)
npm run dev
```

### Load vào Chrome

1. Mở Chrome → `chrome://extensions/`
2. Bật **Developer mode** (góc trên phải)
3. Bấm **Load unpacked**
4. Chọn thư mục `.output/chrome-mv3/`

## Cấu hình API Key

1. Mở extension → tab **Cài đặt**
2. Chọn Provider (OpenAI / Claude / Custom)
3. Nhập API Key
4. (Tuỳ chọn) Điều chỉnh Base URL cho custom provider
5. Chọn model và temperature
6. Bấm **Test Connection** để kiểm tra
7. Bấm **Lưu**

### Providers được hỗ trợ

| Provider | Base URL | Model mẫu |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Anthropic Claude | _(tự động)_ | `claude-sonnet-4-6` |
| LM Studio | `http://localhost:1234/v1` | _(model đang chạy)_ |
| Ollama | `http://localhost:11434/v1` | `llama3` |

## Sử dụng

1. Mở một topic XenForo bất kỳ
2. Click icon extension để mở side panel
3. Tab **Tóm tắt** → bấm "Tóm tắt" để bắt đầu
4. Tab **Ý kiến** → bấm "Phân tích Ý kiến" sau khi đã tóm tắt
5. Tab **Tra cứu** → đặt câu hỏi cụ thể về topic
6. Bấm nút **Xuất** để copy hoặc download kết quả

## Cấu trúc dự án

```
entrypoints/
  background/   — Service worker (xử lý LLM, cache)
  content/      — Content script (scrape forum)
  sidepanel/    — Vue 3 app (UI)
    views/      — SummaryView, OpinionsView, ResearchView, SettingsView
    components/ — ExportButton, ErrorDisplay, LoadingSpinner, ...
    composables/— useLLM, useCache, useScraper
lib/
  llm/          — OpenAI adapter, Claude adapter, summarizer
  scrapers/     — XF1/XF2 scrapers, page loader
  errors.ts     — Custom error classes
  prompts.ts    — System prompts
  token-estimator.ts — Token/cost estimation
```

## Development

```bash
npm run dev          # Dev mode với hot reload
npm run build        # Production build
npx vue-tsc --noEmit # Type check
```
