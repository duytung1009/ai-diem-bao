# Common Components

> Cập nhật: 2026-05-25

## Tổng quan

Extension có 11 reusable UI components trong `entrypoints/sidepanel/components/`. Dưới đây là mô tả các component chính ngoài những component đã được documentation riêng.

## Component Reference

### `ConfirmInline.vue`

Inline confirmation dialog — thay thế cho pattern inline confirm ở SummaryView và KnowledgeView.

**Props:** `message`, `confirmLabel`, `cancelLabel`

```
┌──────────────────────────────────────┐
│ Dự kiến ~8 lượt gọi API. Tiếp tục?  │
│         [Hủy]  [Tiếp tục]           │
└──────────────────────────────────────┘
```

**Emits:** `confirm`, `cancel`
**Style:** block layout, dùng design tokens `btn`, `card`. Không phải modal overlay.

### `AccordionItem.vue`

Collapsible section với toggle icon.

**Props:** `title`, `defaultOpen?`

```
▶ Tiêu đề          (click → expand)
  Nội dung bên trong
```

**Slot:** default (content inside)

### `ProgressIndicator.vue`

Unified progress indicator cho scraping + LLM phases (F17).

**Props:**
| Prop | Type | Mục đích |
|---|---|---|
| `scrapeProgress` | `{currentPage, totalPages, postsScraped} \| null` | Progress scraping |
| `llmProgress` | `{step, totalSteps, message} \| null` | Progress LLM |
| `simpleLoadingText` | `string \| null` | Text loading đơn giản |
| `isScraping` | `boolean` | Đang scrape |
| `cancelLabel` | `string` | Label nút Hủy |

**Logic:**
- Nếu có `scrapeProgress` → hiển thị progress bar + "Đang tải trang N/M... (X bài)"
- Nếu có `llmProgress` → hiển thị "Đang xử lý phần N/M..." + ETA
- Nếu `simpleLoadingText` → hiển thị text + spinner
- Cancel button gọi emit `cancel`

### `CacheIndicator.vue`

Hiển thị trạng thái cache của topic.

**Props:** `topic: CachedTopic`

```
Đã tóm tắt 95/120 bài • 2 giờ trước
```

- Freshness label: "Vừa xong" / "N phút trước" / "N giờ trước" / "Hôm qua" / "N ngày trước"
- Post count: `summarizedPostCount / totalPosts`
- Partial indicator nếu `summarizedPostCount < totalPosts`
- Click → menu "Làm mới"

### `LoadingSpinner.vue`

Simple SVG spinner.

**Props:** `size?` (default: `'md'`)

Sizes: `sm` (4), `md` (6), `lg` (8) — Tailwind width/height classes.

### `ErrorDisplay.vue`

Hiển thị lỗi với retry button.

**Props:** `error: string`, `retryLabel?` (default: "Thử lại")

```
┌─ ⚠️ ──────────────────────────┐
│ Không thể kết nối đến LLM API  │
│           [Thử lại]            │
└────────────────────────────────┘
```

**Emits:** `retry`

### `MarkdownContent.vue`

Render Markdown string an toàn.

```typescript
import { marked } from 'marked';
import DOMPurify from 'dompurify';
```

**Props:** `content: string`
**Flow:** Markdown → `marked.parse()` → HTML → `DOMPurify.sanitize()` → template `v-html`

### `ExportButton.vue`

Export topic kết quả. Hỗ trợ 3 format:
- Copy Markdown
- Copy plain text
- Download `.md` file

**Props:** `summaryText: string`, `topicTitle: string`

**Menu:**
```
[ Xuất ▼ ]
├── Copy Markdown
├── Copy Text
└── Tải .md
```

### `SummaryContent.vue`

Render tóm tắt chính với SummaryJSON structured display.

**Props:** `summary`, `summaryJson`, `title`, `totalPosts`, `totalPages`

Hiển thị:
- Summary text (Markdown)
- Opinions list với supporter count bars
- Conclusion

### `TopicMeta.vue`

Thông tin topic — dùng ở `App.vue` (bên trên sub-tab bar, shared cho tất cả detail tabs: summary/knowledge/analysis/research) và `TopicHubView.vue` (card).

**Props:**
| Prop | Type |
|---|---|
| `topic` | `CachedTopic` |
| `livePostCount` | `number \| null` |
| `isSummarizing` | `boolean` |
| `showDelete?` | `boolean` |
| `showUrl?` | `boolean` |

**Display:**
- Title + news badge
- Metadata row (author, post count, page count)
- Summary status (none/in-progress/partial/done) với màu sắc
- Cached timestamp (relative format)
- Xóa button (conditional)
- URL button (conditional)

## Navigation Structure (Phase 9)

### Top-level Tabs

```
[Thớt]  [Sổ tay]  [Cài đặt]  [?]
```

- **Thớt** — active cho routes: `/`, `/summary`, `/knowledge`, `/analysis`, `/research`
- **Sổ tay** — `/notebook`
- **Cài đặt** — `/settings`
- **?** — `/help`

### Sub-tab Bar (trong tab Thớt, khi chọn thớt)

```
[← Danh sách]  [Tóm tắt]  [Kiến thức]  [Phân tích]  [Tra cứu]
```

Sub-tab bar được render trong `App.vue`, hiển thị khi `isTopicDetailRoute && hasSelectedTopic`. Mỗi sub-tab navigate đến route tương ứng: `/` (hub), `/summary`, `/knowledge`, `/analysis`, `/research`.

### Views Map

| View | Route | Composable |
|------|-------|------------|
| `TopicHubView.vue` | `/` | `useTopicStore` |
| `SummaryView.vue` | `/summary` | `useSummarize` |
| `KnowledgeView.vue` | `/knowledge` | `useKnowledge` |
| `AnalysisView.vue` | `/analysis` | `useThreadAnalysis` |
| `ResearchView.vue` | `/research` | `useLLM` + `useOptimisticUpdate` |
| `NotebookView.vue` | `/notebook` | `useNotebook` |
| `SettingsView.vue` | `/settings` | — |
| `HelpView.vue` | `/help` | — |
