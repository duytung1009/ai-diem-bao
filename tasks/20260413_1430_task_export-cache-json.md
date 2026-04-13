# Task: Export Cache to JSON

**Date:** 2026-04-13 14:30  
**Type:** Feature (small utility)  
**Files changed:** 2 (+1 new)

## Objective

Cho phép user xuất toàn bộ dữ liệu đã cache (tóm tắt + kiến thức) ra file JSON để tự import vào MCP server hoặc các giải pháp AI agent bên ngoài.

## Changes

### `lib/exporter.ts` (NEW)
- `buildCacheExport(topics: CachedTopic[]): CacheExport` — strip heavy fields, build export payload
- Strip: `posts` (raw scrape), `knowledgeChunks` (pre-reduce intermediate)
- Giữ: `summary`, `opinions`, `overallSummary`, `summaryJson`, `segments` (không posts), `knowledgeEntries`, `researchHistory`
- Export schema: `{ exportedAt, version: '1.0', topicCount, topics[] }`
- Types: `ExportedTopic`, `ExportedSegment`, `CacheExport`

### `entrypoints/sidepanel/views/SettingsView.vue`
- Import `buildCacheExport` từ `@/lib/exporter`
- Thêm `exporting` ref
- Thêm `exportCache()`: GET_ALL_CACHED_TOPICS → build → Blob → download `ai-diem-bao-export-YYYY-MM-DD.json`
- Thêm button "Xuất dữ liệu (JSON)" trong Cache section (ngay trên "Xóa tất cả cache"), disabled khi đang xử lý

## Self-review Results
- Issues found: 0
- Issues fixed: 0
- Remaining: none

## Notes

Đây là Option B trong thiết kế Export → MCP. User tự handle file JSON sau khi download; không cần Native Messaging hay bridge phức tạp. Schema `version: '1.0'` để sau này MCP server có thể detect breaking changes.
