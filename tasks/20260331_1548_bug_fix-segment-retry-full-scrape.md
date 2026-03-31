# Bug Fix: Segment mode retry triggers full-topic scrape

**Date:** 2026-03-31 15:48
**Severity:** High
**File changed:** `entrypoints/sidepanel/views/SummaryView.vue`

## Bug Description

Khi đang tóm tắt chủ đề theo từng đoạn (segment mode), nếu có lỗi xảy ra và user nhấn "Retry" trong `ErrorDisplay`, hàm `handleSummarize(false)` được gọi thay vì `handleSummarizeSegment(activeSegmentIndex)`. Kết quả: scraper đọc toàn bộ trang của chủ đề (ví dụ 150 trang) thay vì chỉ đọc các trang trong segment hiện tại (ví dụ 20 trang).

## Root Cause

`ErrorDisplay @retry="handleSummarize(false)"` ở line 895 không có guard cho segment mode. `handleSummarize(false)` không có kiểm tra `isSegmentMode` bên trong — nó luôn gọi `scrapeInChunks(tabId, url, 1, totalPages)` (toàn bộ topic) khi không có cached posts.

## Fix

Thêm hàm `handleRetry()` phân luồng dựa vào mode:
- Segment mode + có segment đang active → gọi `handleSummarizeSegment(activeSegmentIndex)`
- Normal mode → gọi `handleSummarize(false)`

Thay `@retry="handleSummarize(false)"` bằng `@retry="handleRetry"`.

## Self-review Results
- Issues found: 1
- Issues fixed: 1
- Remaining: none
