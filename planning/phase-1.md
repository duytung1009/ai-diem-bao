# Phase 1 — Skeleton + Basic Flow

**Mục tiêu:** Có extension chạy được end-to-end: mở topic XenForo 2.x → scrape → gửi LLM → hiển thị summary trên side panel.

---

## 1.1 Project Scaffold

- [ ] `npm create vite` với Vue 3 + TypeScript
- [ ] Cài dependencies: `vue`, `vue-router`, `tailwindcss`
- [ ] Cài dev dependencies: `@crxjs/vite-plugin` (hoặc `vite-plugin-web-extension`), `@types/chrome`
- [ ] Cấu hình `vite.config.ts` cho Chrome Extension build
- [ ] Cấu hình `tsconfig.json` với paths alias (`@/`)
- [ ] Cấu hình Tailwind CSS (`tailwind.config.ts`, `postcss.config.js`)
- [ ] Tạo `src/manifest.json` (Manifest V3) với:
  - `permissions`: `storage`, `sidePanel`, `activeTab`
  - `content_scripts`: match XenForo URLs (wildcard)
  - `background.service_worker`
  - `side_panel.default_path`
- [ ] Verify build: `npm run build` tạo ra folder dist load được trên Chrome

## 1.2 Shared Types & Messaging

- [ ] `src/shared/types.ts` — Định nghĩa core types:
  - `XenForoVersion = 'xf1' | 'xf2' | 'unknown'`
  - `ScrapedPost { author, content, timestamp, postNumber, avatar? }`
  - `TopicData { url, title, version, posts, totalPages, currentPage }`
  - `SummaryResult { main?, opinions?, research? }`
  - `LLMConfig { provider, model, apiKey, baseUrl?, temperature? }`
- [ ] `src/shared/constants.ts` — App constants:
  - Storage keys
  - Default LLM config
  - Max token limits
- [ ] `src/shared/messaging.ts` — Chrome message helpers:
  - `sendMessage<T>(type, payload): Promise<T>`
  - `onMessage(type, handler)` wrapper
  - Định nghĩa message types enum: `SCRAPE_TOPIC`, `SUMMARIZE`, `GET_SETTINGS`, `SAVE_SETTINGS`

## 1.3 Content Script — XF Version Detection

- [ ] `src/content/detector.ts`:
  - `detectXenForoVersion(): XenForoVersion` — theo logic trong dev_plan
  - Check `html[data-app]`, `XF.config`, `#XenForo`, DOM selectors
  - Export kết quả detection
- [ ] `src/content/index.ts`:
  - Entry point, chạy detect khi page load
  - Gửi message về background với version detected
  - Lắng nghe message từ side panel yêu cầu scrape

## 1.4 Content Script — XF2 Scraper (Single Page)

- [ ] `src/content/scrapers/types.ts` — Scraper interface:
  - `interface TopicScraper { scrape(): TopicData; getPostCount(): number; getPageCount(): number }`
- [ ] `src/content/scrapers/xf2-scraper.ts`:
  - Implement `TopicScraper` cho XenForo 2.x
  - Selectors: `article.message`, `.message-body .bbWrapper`, `.message-attribution`
  - Extract: author, nội dung post (strip quotes, strip signatures), timestamp, post number
  - Extract topic title từ `h1.p-title-value`
  - Lấy total pages từ `.pageNav`
- [ ] Test thủ công trên 1 forum XenForo 2.x thực tế

## 1.5 Background Service Worker

- [ ] `src/background/index.ts`:
  - Đăng ký side panel
  - Lắng nghe messages: `SCRAPE_TOPIC`, `SUMMARIZE`, `GET_SETTINGS`, `SAVE_SETTINGS`
  - Router logic dispatch đến handlers tương ứng

## 1.6 LLM Integration — OpenAI-Compatible Adapter

- [ ] `src/background/llm/types.ts`:
  - `interface LLMProvider { summarize(posts: ScrapedPost[], prompt: string): Promise<string> }`
  - `interface LLMResponse { content: string; tokensUsed: { prompt: number; completion: number } }`
- [ ] `src/background/llm/openai-adapter.ts`:
  - Implement `LLMProvider` dùng `fetch` gọi OpenAI Chat Completions API
  - Support custom `baseUrl` để tương thích LM Studio, Ollama, etc.
  - Xử lý streaming response (optional, có thể phase sau)
  - Error handling: rate limit, invalid key, timeout
- [ ] `src/background/llm/factory.ts`:
  - `createProvider(config: LLMConfig): LLMProvider`
  - Lựa chọn adapter dựa trên `config.provider`
- [ ] `src/background/summarizer.ts`:
  - `summarizeTopic(posts: ScrapedPost[], config: LLMConfig): Promise<string>`
  - Prompt template cơ bản cho tóm tắt topic tiếng Việt
  - Gộp posts thành 1 prompt đơn giản (chưa cần chunking)

## 1.7 Side Panel — Vue App

- [ ] `src/sidepanel/main.ts` — Vue app entry, mount `#app`
- [ ] `src/sidepanel/App.vue`:
  - Layout chính với tab navigation (Summary | Opinions | Research | Settings)
  - Vue Router setup
- [ ] `src/sidepanel/views/SummaryView.vue`:
  - Nút "Tóm tắt" trigger scrape + summarize flow
  - Hiển thị `TopicMeta` (title, số posts, version detected)
  - Hiển thị loading animation khi đang xử lý
  - Render kết quả summary (markdown → HTML)
- [ ] `src/sidepanel/views/SettingsView.vue`:
  - Form cấu hình: Provider (dropdown), API Key (password input), Base URL, Model name, Temperature (slider)
  - Lưu vào `chrome.storage.sync`
  - Nút "Test Connection" gửi prompt đơn giản để verify
- [ ] `src/sidepanel/components/LoadingAnimation.vue`:
  - Animation/spinner khi đang scrape hoặc gọi LLM
  - Hiển thị progress text: "Đang đọc bài viết...", "Đang tóm tắt..."
- [ ] `src/sidepanel/components/TopicMeta.vue`:
  - Hiển thị: Topic title, số bài viết, XF version, thời gian

## 1.8 End-to-End Integration

- [ ] Kết nối flow: Content Script scrape → message → Background summarize → message → Side Panel render
- [ ] Test end-to-end trên Chrome với 1 topic XF2 thực tế
- [ ] Fix các edge cases: topic không có posts, page không phải XenForo, API key sai
- [ ] Verify extension load/unload không gây memory leak

---

**Definition of Done Phase 1:**
Extension load được trên Chrome, mở topic XenForo 2.x bất kỳ, nhấn "Tóm tắt" trên side panel → hiển thị bản tóm tắt từ LLM (OpenAI-compatible).
