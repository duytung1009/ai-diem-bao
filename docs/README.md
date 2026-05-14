# Tài liệu kiến trúc — AI Điểm Báo

Thư mục này chứa tài liệu mô tả chi tiết các cơ chế hoạt động chính của extension.

## Mục lục

### [architecture/](./architecture/) — Kiến trúc & Cơ chế

| File | Mô tả |
|------|--------|
| [scraping.md](./architecture/scraping.md) | Cơ chế scraping (detect forum, page-loader, rate limiting, incremental, news detection) |
| [summarization.md](./architecture/summarization.md) | Cơ chế tóm tắt (map-reduce pipeline, JSON repair, segment/dynamic mode, tree-reduce) |
| [knowledge.md](./architecture/knowledge.md) | Cơ chế tab Kiến thức (chunked extraction, resume, merge strategy, search/filter) |
| [cache.md](./architecture/cache.md) | Cơ chế cache (IndexedDB schema, CRUD, URL normalization, freshness, migration) |
| [messaging.md](./architecture/messaging.md) | Cơ chế messaging (typed messages, fire-and-forget pattern, keepalive, ETA) |
| [topic-hub.md](./architecture/topic-hub.md) | Cơ chế Topic Hub (useTopicStore, search/sort, realtime status, delete) |
| [thread-analysis.md](./architecture/thread-analysis.md) | Cơ chế Thread Analysis (8 sections, prompt, UI rendering, copy text) |
| [opinions.md](./architecture/opinions.md) | Cơ chế phân tích ý kiến (opinions trong SummaryJSON, supporter bars, author dedup) |
| [research.md](./architecture/research.md) | Cơ chế tra cứu (research prompt, article extraction, news detection, chunked research) |
| [dark-mode.md](./architecture/dark-mode.md) | Cơ chế dark mode (useTheme, class-based, system follow, CSS variables) |
| [cost-estimator.md](./architecture/cost-estimator.md) | Cơ chế cost estimation (pricing table, cost guard, ETA stats) |
| [common-components.md](./architecture/common-components.md) | Các shared components (ConfirmInline, AccordionItem, ProgressIndicator, v.v.) |

### [testing/](./testing/) — Test Infrastructure

| File | Mô tả |
|------|--------|
| [testing-overview.md](./testing/testing-overview.md) | Tổng quan test infrastructure, mock system, conventions, coverage |
