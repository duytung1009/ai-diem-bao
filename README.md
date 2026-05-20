# AI Điểm Báo / AI Newspaper Digest

> Chrome Extension tự động tóm tắt và phân tích thảo luận trên diễn đàn XenForo bằng AI
> *Chrome Extension that automatically summarizes and analyzes XenForo forum discussions using AI*

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue)
![Vue 3](https://img.shields.io/badge/Vue-3-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8)
![WXT](https://img.shields.io/badge/WXT-0.20-60a5fa)

---

## Tính năng chính / Key Features

- **Tóm tắt tự động** *(Auto Summarization)* — Đọc toàn bộ topic (kể cả nhiều trang) và tóm tắt nội dung thảo luận bằng AI
- **Trích xuất kiến thức** *(Knowledge Extraction)* — Rút trích sự thật, mẹo, kinh nghiệm từ thảo luận thành kho kiến thức có cấu trúc
- **Tra cứu / Q&A** *(Research)* — Đặt câu hỏi cụ thể về nội dung topic và nhận câu trả lời có trích dẫn
- **Phân tích chuyên sâu** *(Thread Analysis)* — Phân tích động thái debate, profile người dùng, timeline, bình luận notable, và tóm tắt phong cách "võ hiệp"
- **Export** — Sao chép Markdown, plain text, hoặc tải file `.md`
- **Caching** — Lưu kết quả vào IndexedDB, phát hiện bài mới, hỗ trợ cập nhật incremental
- **Custom prompts** — Tuỳ chỉnh system prompt cho từng loại phân tích
- **Map-reduce pipeline** — Tự động chia nhỏ topic thành nhiều chunk để xử lý dựa trên cấu hình LLM tương ứng
- **Phát hiện bài viết** *(News Detection)* — Tự động phân biệt discussion và news article, trích xuất nội dung bài báo

## Hỗ trợ / Support

| | |
|---|---|
| **Forum** | XenForo 1.x và XenForo 2.x |
| **LLM Providers** | OpenAI, Anthropic Claude, Google Gemini, bất kỳ OpenAI-compatible API (LM Studio, Ollama, v.v.) |
| **Trình duyệt** | Chrome (Manifest V3), Firefox |

## Tech Stack

| Layer | Công nghệ |
|---|---|
| **Extension Framework** | [WXT](https://wxt.dev/) v0.20 — Modern web extension build tool |
| **UI Framework** | [Vue 3](https://vuejs.org/) với Composition API |
| **Routing** | [Vue Router](https://router.vuejs.org/) v4 |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) v4 với custom design tokens |
| **Language** | [TypeScript](https://www.typescriptlang.org/) v5 |
| **Build Tool** | [Vite](https://vitejs.dev/) (qua WXT) |
| **Storage** | IndexedDB (cache topic) + `chrome.storage.sync` (settings) |
| **Markdown** | [marked](https://marked.js.org/) v17 |
| **Sanitization** | [DOMPurify](https://github.com/cure53/DOMPurify) v3 |

## Cài đặt / Installation

### Yêu cầu / Requirements

- Node.js 18+
- npm

### Các bước cài đặt / Setup Steps

```bash
# Clone repo
git clone <repo-url>
cd ai-diem-bao

# Cài đặt dependencies
npm install

# Copy file môi trường (tuỳ chọn)
cp .env.example .env

# Dev mode (hot reload)
npm run dev

# Hoặc build production
npm run build
```

### Load vào Chrome / Load into Chrome

1. Mở Chrome → `chrome://extensions/`
2. Bật **Developer mode** (góc trên phải)
3. Bấm **Load unpacked**
4. Chọn thư mục `.output/chrome-mv3/`

## Cấu hình API Key / API Configuration

1. Mở extension → tab **Cài đặt** *(Settings)*
2. Chọn Provider (OpenAI / Claude / Gemini / Custom)
3. Nhập API Key
4. (Tuỳ chọn) Điều chỉnh Base URL cho custom provider
5. Chọn model và temperature
6. Bấm **Test Connection** để kiểm tra
7. Bấm **Lưu** *(Save)*

### Providers được hỗ trợ / Supported Providers

| Provider | Base URL | Model mẫu |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Anthropic Claude | _(tự động)_ | `claude-sonnet-4-20250514` |
| Google Gemini | _(tự động)_ | `gemini-2.5-flash` |
| LM Studio | `http://localhost:1234/v1` | _(model đang chạy)_ |
| Ollama | `http://localhost:11434/v1` | `llama3` |
| OpenRouter | `https://openrouter.ai/api/v1` | _(tùy chọn)_ |

> **Mẹo / Tip:** Dùng `.env` để quản lý API key trong development. Xem `.env.example` để biết các biến hỗ trợ.

## Sử dụng / Usage

1. Mở một topic XenForo bất kỳ
2. Click icon extension để mở side panel
3. **Topic Hub** — Xem danh sách các topic đã lưu, lọc, tìm kiếm
4. **Tóm tắt** *(Summary)* → bấm "Tóm tắt" để bắt đầu
5. **Ý kiến** *(Opinions)* → bấm "Phân tích Ý kiến" sau khi đã tóm tắt
6. **Kiến thức** *(Knowledge)* → trích xuất và quản lý kho kiến thức từ topic
7. **Phân tích Thread** *(Thread Analysis)* → phân tích sâu động thái debate
8. **Tra cứu** *(Research)* → đặt câu hỏi cụ thể về topic
9. Bấm nút **Xuất** *(Export)* để copy hoặc download kết quả

## Cấu trúc dự án / Project Structure

```
ai-diem-bao/
├── entrypoints/
│   ├── background/index.ts         # Service worker: LLM orchestration, messaging, cache
│   ├── content/index.ts            # Content script: XF version detection, scraper dispatch
│   └── sidepanel/                  # Vue 3 side panel app
│       ├── App.vue                 # Root component với tab navigation
│       ├── main.ts                 # Vue app + router setup
│       ├── index.html              # Side panel HTML shell
│       ├── views/
│       │   ├── TopicHubView.vue    # Dashboard danh sách topic
│       │   ├── SummaryView.vue     # Hiển thị tóm tắt + phân tích ý kiến
│       │   ├── KnowledgeView.vue   # Trích xuất & quản lý kiến thức
│       │   ├── ResearchView.vue    # Q&A / Research
│       │   ├── SettingsView.vue    # Cấu hình LLM provider
│       │   └── HelpView.vue        # Hướng dẫn sử dụng
│       ├── components/             # 12 reusable UI components
│       │   ├── TopicMeta.vue       # Topic metadata
│       │   ├── SummaryContent.vue  # Summary rendering
│       │   ├── ThreadAnalysisContent.vue  # Thread analysis rendering
│       │   ├── StepTimeline.vue    # Progress step timeline
│       │   ├── ExportButton.vue    # Export functionality
│       │   ├── CacheIndicator.vue  # Cache freshness indicator
│       │   ├── ProgressIndicator.vue  # Scraping/LLM progress
│       │   ├── LoadingSpinner.vue  # Loading animation
│       │   ├── ErrorDisplay.vue    # Error display
│       │   ├── MarkdownContent.vue # Markdown rendering
│       │   ├── AccordionItem.vue   # Collapsible sections
│       │   └── ConfirmInline.vue   # Inline confirmation dialog
│       └── composables/
│           ├── useTopicStore.ts    # Reactive topic state management
│           ├── useSummarize.ts     # Summarization orchestration
│           ├── useLLM.ts           # LLM task communication
│           ├── usePipeline.ts      # Pipeline state management
│           ├── useTopicScraper.ts  # Scraping coordination
│           ├── useOptimisticUpdate.ts  # Optimistic UI updates với auto-rollback
│           └── useTheme.ts         # Dark mode theming
│
├── lib/
│   ├── types.ts                    # Tất cả TypeScript interfaces
│   ├── constants.ts                # Configuration constants
│   ├── prompts.ts                  # System prompts cho tất cả LLM tasks
│   ├── errors.ts                   # Custom error classes
│   ├── messaging.ts                # Chrome messaging helpers
│   ├── cache-manager.ts            # Cache CRUD với URL normalization
│   ├── cache-db.ts                 # IndexedDB wrapper
│   ├── token-estimator.ts          # Token counting, cost estimation, context checking
│   ├── pipeline-builder.ts         # Pipeline assembly và reconciliation
│   ├── run-guard.ts                # Stale-run guard (monotonic token để cancel race)
│   ├── segment-planner.ts          # Dynamic segment sizing dựa trên token budget
│   ├── segment-persistence.ts      # Segment save payload builder
│   ├── exporter.ts                 # Cache export (JSON) functionality
│   ├── format.ts                   # Number formatting utilities
│   ├── text-utils.ts               # Text processing utilities
│   ├── topic-utils.ts              # Topic utility functions
│   ├── detector.ts                 # XenForo version detection
│   ├── llm/                        # LLM provider adapters
│   │   ├── types.ts                # LLMProvider interface
│   │   ├── factory.ts              # Provider factory
│   │   ├── openai-adapter.ts       # OpenAI-compatible API adapter
│   │   ├── claude-adapter.ts       # Anthropic Claude API adapter
│   │   ├── gemini-adapter.ts       # Google Gemini API adapter
│   │   ├── summarizer.ts           # Core summarization logic (map-reduce)
│   │   ├── retry.ts                # Retry logic for rate limits
│   │   ├── utils.ts                # LLM utilities
│   │   └── cost-estimator.ts       # Cost estimation
│   └── scrapers/                   # Forum scrapers
│       ├── types.ts                # TopicScraper interface
│       ├── xf1-scraper.ts          # XenForo 1.x scraper
│       ├── xf2-scraper.ts          # XenForo 2.x scraper
│       ├── page-loader.ts          # Multi-page loading
│       ├── thread-status.ts        # Thread status detection
│       ├── article-extractor.ts    # News article extraction
│       └── news-detector.ts        # News vs discussion detection
│
├── docs/architecture/              # Architecture documentation (12 files)
│   ├── summarization.md            # Map-reduce pipeline
│   ├── scraping.md                 # Scraping mechanism
│   ├── knowledge.md                # Knowledge extraction
│   ├── opinions.md                 # Opinion analysis
│   ├── research.md                 # Q&A / Research flow
│   ├── thread-analysis.md          # Thread analysis pipeline
│   ├── topic-hub.md                # Topic Hub view
│   ├── messaging.md                # Chrome messaging architecture
│   ├── cache.md                    # Caching layer
│   ├── cost-estimator.md           # LLM cost estimation
│   ├── dark-mode.md                # Dark mode implementation
│   └── common-components.md        # Shared UI components
│
├── tests/
│   ├── unit/                       # 14 unit test files
│   ├── e2e/                        # 6 end-to-end test files
│   ├── fixtures/                   # Mock data generators
│   ├── mocks/                      # Mock providers & factories
│   └── utils/                      # Test helpers
│
├── planning/                       # Feature planning docs với Decision Logs
├── review/                         # Code review reports (tier 1/2/3)
├── template/                       # Templates cho bug report, review, self-review
├── .taskmaster/                    # Task Master AI — PRDs & workflow docs
├── wxt.config.ts                   # WXT + manifest configuration
├── vitest.config.ts                # Vitest test configuration
├── package.json                    # Dependencies & scripts
├── tsconfig.json                   # TypeScript config
├── STYLE_GUIDE.md                  # UI styling conventions
└── .env.example                    # API key template
```

## Kiến trúc / Architecture

### Map-Reduce Pipeline
Topic lớn được tự động chia thành các chunk phù hợp với context window của LLM. Mỗi chunk được tóm tắt riêng, sau đó kết quả được merge đệ quy (tree-reduce) cho đến khi đạt tóm tắt cuối cùng.

### Strategy Pattern
- **Scrapers:** XenForo 1.x và 2.x implement chung interface `TopicScraper`
- **LLM Providers:** OpenAI, Claude, Gemini implement chung interface `LLMProvider`

### Fire-and-Forget Messaging
LLM tasks được dispatch qua `START_LLM_TASK` — response ngay lập tức, sau đó progress/result được gửi qua `LLM_PROGRESS` và `LLM_RESULT`. Tránh timeout Chrome message channel cho các tác vụ dài.

### Service Worker Keepalive
Ping định kỳ `browser.storage.sync.get('')` giữ background service worker sống trong quá trình LLM hoạt động dài.

### JSON Repair
Parser robust xử lý LLM output bị lỗi: unescaped quotes, backtick fences, invalid escape sequences, NBSP characters.

## Data Models

### CachedTopic
Entity chính lưu trong IndexedDB:
- `url`, `title`, `version` (xf1/xf2)
- `posts: ScrapedPost[]` — raw scraped data
- `summary`, `opinions`, `overallSummary`, `summaryJson`
- `segments: TopicSegment[]` — cho topic dài
- `knowledgeEntries`, `knowledgeChunks` — kiến thức trích xuất
- `researchHistory: ResearchEntry[]` — lịch sử Q&A
- `threadAnalysis: ThreadAnalysisJSON` — phân tích sâu
- `totalPosts`, `totalPages`, `summarizedPostCount`, `lastPostNumber`
- `cachedAt`, `llmConfig`, `bookmarked`, `topicType`

### SummaryJSON
Output tóm tắt có cấu trúc: `{ summary, opinions[], conclusion }`

### ThreadAnalysisJSON
Phân tích thread sâu: `{ overview, userProfiles[], debateStreams[], combats[], timeline[], notableComments[], conclusion, wuxia }`

### KnowledgeEntry
`{ id, title, content, tags[], source: { author, postNumber, timestamp }, extractedAt, saved }`

## Development

### Scripts

```bash
npm run dev          # Dev mode với hot reload
npm run build        # Production build
npm run compile      # Type check (vue-tsc --noEmit)
```

### Workflow

Dự án sử dụng **Task Master** để quản lý task với:
- 3-tier review system (Sonnet quick/standard, Opus deep)
- Planning files trong `planning/` với Decision Logs
- Review files trong `review/` với standardized templates
- Self-review trước khi commit

### Biến môi trường / Environment Variables

Xem `.env.example` để biết danh sách đầy đủ các biến hỗ trợ:

| Biến | Mô tả |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_API_KEY` | Google Gemini API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OLLAMA_BASE_URL` | Ollama base URL |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint |

## Documentation

**Architecture:**
- [Summarization (Map-Reduce)](docs/architecture/summarization.md)
- [Scraping](docs/architecture/scraping.md)
- [Knowledge Extraction](docs/architecture/knowledge.md)
- [Opinion Analysis](docs/architecture/opinions.md)
- [Research / Q&A](docs/architecture/research.md)
- [Thread Analysis](docs/architecture/thread-analysis.md)
- [Topic Hub](docs/architecture/topic-hub.md)
- [Messaging Architecture](docs/architecture/messaging.md)
- [Cache Layer](docs/architecture/cache.md)
- [Cost Estimator](docs/architecture/cost-estimator.md)
- [Dark Mode](docs/architecture/dark-mode.md)
- [Common Components](docs/architecture/common-components.md)

**Other:**
- [Style Guide](STYLE_GUIDE.md)
- [Example Summary](EXAMPLE_SUMMARY.md)

## License

MIT
