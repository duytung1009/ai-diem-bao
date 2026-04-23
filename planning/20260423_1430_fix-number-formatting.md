# Fix: Format số có dấu phân cách hàng nghìn

## Overview
Tất cả số lớn hiển thị trong UI (số bài viết, số trang, v.v.) cần có dấu phân cách hàng nghìn để dễ đọc (ví dụ: 4656 → 4,656). Hiện tại các số này hiển thị thô không format.

## Goals
- Thêm utility `formatNumber(n)` dùng chung cho toàn bộ sidepanel
- Áp dụng format cho tất cả chỗ hiển thị số lượng bài viết, số trang trong UI

## Requirements

### lib/ — Utility function
- Tạo hoặc thêm vào `lib/format.ts`: hàm `formatNumber(n: number): string` dùng `n.toLocaleString('vi-VN')` (dấu chấm làm thousands separator, phù hợp tiếng Việt)
- Export từ file này để các component import

### entrypoints/sidepanel/components/TopicMeta.vue
- `{{ topic.totalPosts }}` → `{{ formatNumber(topic.totalPosts) }}`
- `{{ topic.totalPages }}` → `{{ formatNumber(topic.totalPages) }}`
- `{{ summarizedPostCount }}/{{ topic.totalPosts }}` → `{{ formatNumber(summarizedPostCount) }}/{{ formatNumber(topic.totalPosts) }}`
- `Đã tóm tắt {{ summarizedPostCount }} bài` → dùng formatNumber

### entrypoints/sidepanel/views/TopicHubView.vue
- `{{ store.activeTabDetect.value.postCount }} bài viết` (line ~299)
- `{{ topic.summarizedPostCount ?? topic.totalPosts }}/{{ topic.totalPosts }} bài` (line ~368)
- `{{ topic.totalPosts }} bài` (line ~370)

### entrypoints/sidepanel/views/SummaryView.vue
- `{{ segmentSummaries[0].postCount }} bài viết` (line ~343)
- `{{ segmentSummaries[activeSegmentIndex].postCount }} bài viết` (line ~486)

### entrypoints/sidepanel/components/ProgressIndicator.vue
- `${p.postsScraped} bài` trong computed message (line ~97) — dùng formatNumber trong JS

## Technical Considerations
- Dùng `toLocaleString('vi-VN')` → format chuẩn Việt Nam (dấu chấm: 4.656)
- Nếu muốn dùng dấu phẩy kiểu quốc tế thì dùng `toLocaleString('en-US')` (4,656) — quyết định trong Decision Log
- `formatNumber` chỉ áp dụng cho số nguyên (bài viết, trang); không áp dụng cho phần trăm hay số segment
- Import trực tiếp trong `<script setup>` của mỗi component, không cần composable

## Implementation Notes
1. Tạo `lib/format.ts` với hàm `formatNumber`
2. Import và dùng trong từng component — không cần thay đổi props hay store
3. Trong ProgressIndicator (TS string template), gọi `formatNumber()` trong computed

## Test Plan
- Build `npm run build` phải pass
- Type check `npx vue-tsc --noEmit` phải clean
- Mở sidepanel với topic có > 999 bài → kiểm tra số hiển thị đúng format

## Decision Log

### Quyết định 1: Dùng vi-VN hay en-US locale
- **Đã chọn:** `toLocaleString('en-US')` → dấu phẩy (4,656)
- **Lý do:** Dấu phẩy phổ biến hơn trong context tech/internet; dấu chấm của vi-VN dễ nhầm với dấu thập phân
- **Đã cân nhắc nhưng loại:**
  - `vi-VN` (dấu chấm: 4.656) — loại vì dễ nhầm dấu thập phân
- **Điều kiện thay đổi:** Nếu user prefer vi-VN thì đổi locale string là xong

### Quyết định 2: Tạo file mới hay thêm vào file có sẵn
- **Đã chọn:** Tạo `lib/format.ts` mới
- **Lý do:** Không có file utils hiện tại phù hợp; giữ concerns tách biệt
- **Đã cân nhắc nhưng loại:**
  - Thêm vào `lib/prompts.ts` hay `lib/errors.ts` — không liên quan
