# Tài liệu kiến trúc — AI Điểm Báo

Thư mục này chứa tài liệu mô tả chi tiết các cơ chế hoạt động chính của extension.

## Mục lục

### [architecture/](./architecture/) — Kiến trúc & Cơ chế

| File | Mô tả |
|------|--------|
| [scraping.md](./architecture/scraping.md) | Cơ chế scraping (detect forum, đọc bài viết, chunked scraping, rate limiting) |
| [summarization.md](./architecture/summarization.md) | Cơ chế tóm tắt (map-reduce pipeline, prompts, segment mode, chunking) |
| [knowledge.md](./architecture/knowledge.md) | Cơ chế tab Kiến thức (chunked extraction, resume, saved entries, merge strategy) |

<!-- Bổ sung thêm khi có tài liệu mới:
| [cache.md](./architecture/cache.md) | Cơ chế cache (IndexedDB, freshness evaluation, auto-update) |
| [topic-hub.md](./architecture/topic-hub.md) | Cơ chế danh sách chủ đề (store, search/sort, realtime status) |
| [opinions.md](./architecture/opinions.md) | Cơ chế phân tích ý kiến (opinion analysis, supporter bars) |
| [research.md](./architecture/research.md) | Cơ chế tra cứu (research prompt, article extraction) |
| [dark-mode.md](./architecture/dark-mode.md) | Cơ chế dark mode (useTheme, class-based, system follow) |
| [messaging.md](./architecture/messaging.md) | Cơ chế messaging (typed messages, fire-and-forget pattern) |
-->
