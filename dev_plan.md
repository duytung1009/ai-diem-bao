## Bản thiết kế hoàn chỉnh — XenForo Topic Summarizer - Project AI Điểm báo

### 1. Tech Stack

| Layer | Lựa chọn |
|---|---|
| Extension | Manifest V3 |
| UI (Side Panel) | Vue 3 + Vite + TypeScript |
| Styling | Tailwind CSS (hoặc UnoCSS cho nhẹ hơn) |
| Storage | `chrome.storage.local` (cached summaries) |
| LLM calls | Background service worker → fetch trực tiếp |
| Build | Vite + CRXJS plugin (hoặc vite-plugin-web-extension) |

### 2. XenForo Version Detection

Tự động nhận diện bằng cách kiểm tra các dấu hiệu trên DOM:

| Signal | XenForo 1.x | XenForo 2.x |
|---|---|---|
| Post container | `li.message` hoặc `.messageList .message` | `article.message` |
| Content wrapper | `.messageContent .messageText` | `.message-body .bbWrapper` |
| Meta tag / JS object | `XenForo._baseUrl` | `XF.config` hoặc `<html[data-app="public"]>` |
| Pagination | `.PageNav` | `.pageNav` |

Logic detect:

```typescript
function detectXenForoVersion(): 'xf1' | 'xf2' | 'unknown' {
  if (document.querySelector('html[data-app]') || typeof XF !== 'undefined')
    return 'xf2';
  if (document.querySelector('#XenForo') || typeof XenForo !== 'undefined')
    return 'xf1';
  // fallback: kiểm tra DOM structure
  if (document.querySelector('article.message')) return 'xf2';
  if (document.querySelector('li.message .messageText')) return 'xf1';
  return 'unknown';
}
```

Sau đó load scraper tương ứng qua **Strategy Pattern** — mỗi version có class scraper riêng implement chung 1 interface.

### 3. Kiến trúc chi tiết

```
ai-diem-bao/
├── src/
│   ├── manifest.json                 # Manifest V3
│   ├── background/
│   │   ├── index.ts                  # Service worker entry
│   │   ├── llm/
│   │   │   ├── types.ts              # LLMProvider interface
│   │   │   ├── openai-adapter.ts     # OpenAI / compatible
│   │   │   ├── claude-adapter.ts     # Anthropic API
│   │   │   └── factory.ts            # Provider factory
│   │   ├── summarizer.ts             # Chunking + map-reduce logic
│   │   └── cache-manager.ts          # Read/write cached summaries
│   │
│   ├── content/
│   │   ├── index.ts                  # Content script entry
│   │   ├── detector.ts               # XF version detection
│   │   ├── scrapers/
│   │   │   ├── types.ts              # Scraper interface
│   │   │   ├── xf1-scraper.ts        # XenForo 1.x
│   │   │   └── xf2-scraper.ts        # XenForo 2.x
│   │   └── page-loader.ts            # Multi-page fetching
│   │
│   ├── sidepanel/                    # Vue app
│   │   ├── App.vue
│   │   ├── main.ts
│   │   ├── views/
│   │   │   ├── SummaryView.vue       # Tóm tắt chính
│   │   │   ├── OpinionsView.vue      # Phân tích luồng ý kiến
│   │   │   ├── ResearchView.vue      # Tra cứu mở rộng
│   │   │   └── SettingsView.vue      # Cấu hình API
│   │   ├── components/
│   │   │   ├── LoadingAnimation.vue   # Ảnh động loading
│   │   │   ├── CacheIndicator.vue     # Chỉ báo cache cũ/mới
│   │   │   ├── TopicMeta.vue          # Hiển thị info topic
│   │   │   └── ExportButton.vue
│   │   └── composables/
│   │       ├── useLLM.ts
│   │       ├── useCache.ts
│   │       └── useScraper.ts
│   │
│   └── shared/
│       ├── types.ts                   # Shared types
│       ├── constants.ts
│       └── messaging.ts              # Chrome message helpers
│
├── public/
│   ├── icons/
│   └── loading.gif                   # Ảnh loading dễ thương
│
├── vite.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

### 4. Local Cache Design

**Storage key format:**

```typescript
interface CachedTopic {
  topicUrl: string;         // URL gốc (bỏ query params)
  topicTitle: string;
  forumVersion: 'xf1' | 'xf2';
  scrapedAt: number;        // timestamp lúc scrape
  totalPosts: number;       // số posts tại thời điểm scrape
  totalPages: number;
  posts: ScrapedPost[];     // raw data đã scrape
  summaries: {
    main?: string;          // tóm tắt chính
    opinions?: string;      // phân tích luồng ý kiến
    research?: string;      // tra cứu mở rộng
  };
  llmConfig: {              // config LLM lúc gen (để biết regen nếu đổi model)
    provider: string;
    model: string;
  };
}
```

**Cache key:** Dùng `topicUrl` (normalized, bỏ page number và query string) làm key chính.

**Chỉ báo cache cũ — logic:**

```typescript
interface CacheFreshness {
  status: 'fresh' | 'stale' | 'outdated';
  reason?: string;
  scrapedAt: Date;
  age: string;                    // "2 giờ trước", "3 ngày trước"
  currentPostCount?: number;      // nếu detect được trên trang hiện tại
  cachedPostCount: number;
}

function evaluateFreshness(cached: CachedTopic, currentPostCount?: number): CacheFreshness {
  const ageMs = Date.now() - cached.scrapedAt;
  const ageHours = ageMs / (1000 * 60 * 60);

  // Có posts mới → stale
  if (currentPostCount && currentPostCount > cached.totalPosts) {
    return { status: 'stale', reason: `Có ${currentPostCount - cached.totalPosts} bài viết mới` };
  }
  // Quá 24h → stale
  if (ageHours > 24) {
    return { status: 'stale', reason: 'Dữ liệu đã quá 24 giờ' };
  }
  // Quá 7 ngày → outdated
  if (ageHours > 168) {
    return { status: 'outdated', reason: 'Dữ liệu đã quá 7 ngày' };
  }
  return { status: 'fresh' };
}
```

**UI indicator trên CacheIndicator.vue:**

- 🟢 **Fresh** — "Tóm tắt từ 2 giờ trước · 45 bài viết" → dùng luôn
- 🟡 **Stale** — "Có 12 bài viết mới kể từ lần tóm tắt trước (3 ngày trước)" → nút "Cập nhật"
- 🔴 **Outdated** — "Dữ liệu đã quá cũ (15 ngày trước)" → khuyến nghị chạy lại

Khi user chọn "Cập nhật", extension có thể **chỉ scrape các posts mới** (từ post cuối cùng đã cache) thay vì scrape lại toàn bộ — tiết kiệm thời gian và token.

### 5. Data Flow hoàn chỉnh

```
User mở topic XenForo
        │
        ▼
Content Script: detect XF version → chọn scraper
        │
        ▼
Kiểm tra cache (chrome.storage.local)
        │
   ┌────┴─────┐
   │ Có cache │ → Hiển thị kết quả cũ + CacheIndicator
   │          │   User chọn "Cập nhật" nếu muốn
   └────┬─────┘
        │ Không có / User muốn cập nhật
        ▼
Scrape posts (trang hiện tại → multi-page nếu cần)
        │
        ▼
Content Script → message → Background SW
        │
        ▼
Background: chunk posts → gửi LLM (map-reduce)
        │
        ▼
Nhận kết quả → lưu cache → gửi về Side Panel
        │
        ▼
Side Panel (Vue): render summary, opinions, research
```

### 6. Kế hoạch triển khai (cập nhật)

**Phase 1 — Skeleton + Basic Flow (tuần 1)**
- Project scaffold: Vite + Vue 3 + TS + Manifest V3
- Content script: XF version detection + XF2 scraper (single page)
- Settings page: form API config, lưu `chrome.storage.sync`
- OpenAI-compatible adapter
- Basic summary: scrape → gửi LLM → hiển thị kết quả trên side panel
- Loading animation

**Phase 2 — Cache + Multi-page + XF1 (tuần 2)**
- XF1 scraper
- Multi-page scraping với progress
- Local cache system + freshness indicator
- Incremental update (chỉ scrape posts mới)

**Phase 3 — Analysis Features (tuần 3)**
- Claude adapter
- Opinion analysis (prompt chuyên biệt)
- Chunking / map-reduce cho topic dài
- Token estimation trước khi chạy

**Phase 4 — Research + Polish (tuần 4)**
- Web search / keyword suggestions
- Export (markdown, copy)
- Error handling, retry logic
- Custom prompt templates
- README cho GitHub

**Phase 7 — Timeline Loading Indicator**
- Thay thế ProgressIndicator bằng StepTimeline dạng vertical timeline
- Hiển thị toàn bộ các step cần thực hiện ngay từ đầu
- 3 trạng thái: ✓ done (xanh), ⏳ running (loading + ETA), ○ pending (xám)
- Pipeline steps cho từng workflow: summarize, knowledge extract, research, opinion analysis
- Background gửi steps definition cùng với LLM_PROGRESS
- Cập nhật useLLM, useSummarize, các Views

---

**Phase 5 — Help Tab + Onboarding Guide**
- Tab "Hướng dẫn" với nội dung text-only, chia sections:
  + Setup LLM Provider: 1.1 Local LLM (khuyến nghị), 1.2 Gemini Free Tier (có note warning rate limit), 1.3 API Pay-per-request (có note chi phí)
  + Flow tóm tắt (xem chủ đề → chọn → tóm tắt)
  + Sau tóm tắt (tổng hợp kiến thức, tra cứu)
- Button `?` cạnh tab Cài đặt để truy cập
- Route `/help` + `HelpView.vue`
