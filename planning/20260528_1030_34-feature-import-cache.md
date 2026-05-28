# Feature 34: Import dữ liệu từ file JSON

## Overview

Thêm tính năng **nhập dữ liệu** vào tab Settings, cho phép người dùng import file `.json` được export bởi tính năng "Xuất dữ liệu" hiện có. Sau khi import, các topic từ file sẽ xuất hiện trong danh sách như thể được tóm tắt bình thường — đầy đủ summary, opinions, segments, knowledge, v.v.

Mục tiêu: hỗ trợ chuyển dữ liệu giữa thiết bị, backup/restore, và chia sẻ cache giữa người dùng.

## Goals

- Import thành công file JSON đúng format `CacheExport` v1.0 vào IndexedDB
- Báo kết quả rõ ràng: bao nhiêu topic imported / skipped / failed
- Hỗ trợ conflict mode: **Skip** (giữ bản cũ) hoặc **Ghi đè** (lấy bản mới)
- Validate file trước khi import — reject sớm nếu sai format, version không hỗ trợ
- Không crash nếu file thiếu field optional

## Requirements

### A. lib/importer.ts (mới)

- Định nghĩa `ImportConflictMode = 'skip' | 'overwrite'`
- Định nghĩa `ImportResult { total, imported, skipped, failed, errors: string[] }`
- Hàm `validateCacheExport(raw: unknown): CacheExport` — throw nếu không hợp lệ:
  - Kiểm tra `version === '1.0'`
  - Kiểm tra `topics` là array
  - Kiểm tra mỗi topic có `url` và `title` (bắt buộc)
- Hàm `mapExportedTopic(t: ExportedTopic): CachedTopic` — map các trường:
  - `version`: default `'unknown'`
  - `posts`: `[]` (không có raw posts trong export)
  - `lastPostNumber`: `0`
  - `knowledgeChunks`: `undefined`
  - Tất cả trường còn lại: lấy từ ExportedTopic as-is (url, title, topicType, cachedAt, llmConfig, totalPosts, summarizedPostCount, totalPages, bookmarked, summary, opinions, overallSummary, summaryJson, segments, knowledgeEntries, researchHistory)
  - `segments`: map `ExportedSegment → TopicSegment` — bổ sung `posts: []`, `complete: true`

### B. lib/types.ts

- Thêm `'IMPORT_CACHE'` vào union `MessageType`

### C. entrypoints/background/index.ts

- Thêm case `'IMPORT_CACHE'`:
  - Payload: `{ topics: ExportedTopic[], conflictMode: ImportConflictMode }`
  - Với mỗi topic:
    - `conflictMode === 'skip'`: kiểm tra `dbGet(topic.url)` — nếu đã có thì tăng `skipped`, bỏ qua
    - `conflictMode === 'overwrite'`: gọi `dbPut(mapped)` trực tiếp
    - Bắt lỗi per-topic, tăng `failed` và push error message vào array
  - Trả về `ImportResult`

### D. entrypoints/sidepanel/views/SettingsView.vue

- Thêm `<input type="file" accept=".json" ref="fileInput" class="hidden">` trong template
- Thêm nút **"Nhập dữ liệu (JSON)"** cạnh nút "Xuất dữ liệu"
- Thêm UI chọn conflict mode — radio buttons hoặc select nhỏ: "Giữ bản cũ (skip)" / "Ghi đè"
  - Conflict mode chỉ hiển thị khi người dùng đã chọn file (hoặc luôn hiển thị, đặt default `skip`)
- Flow:
  1. User click nút → trigger `fileInput.click()`
  2. `onChange` → đọc file bằng `FileReader`, parse JSON, gọi `sendMessage('IMPORT_CACHE', { topics, conflictMode })`
  3. Trong khi chờ: hiển thị spinner / text "Đang nhập..."
  4. Khi xong: hiển thị toast/alert kết quả: `"Đã nhập X topic (bỏ qua Y, lỗi Z)"`
  5. Refresh cache size sau khi import
- State mới: `importing = ref(false)`, `importResult = ref<ImportResult | null>(null)`, `conflictMode = ref<'skip' | 'overwrite'>('skip')`

## Technical Considerations

**Affected files:**
- `lib/importer.ts` — tạo mới
- `lib/types.ts` — thêm MessageType
- `lib/exporter.ts` — không cần sửa, chỉ re-export types nếu cần
- `entrypoints/background/index.ts` — thêm case handler
- `entrypoints/sidepanel/views/SettingsView.vue` — thêm UI

**Mapping ExportedSegment → TopicSegment:**
```ts
{
  startPage: s.startPage,
  endPage: s.endPage,
  posts: [],          // không có trong export
  complete: true,     // đây là segment đã hoàn chỉnh từ export
  summary: s.summary,
  summaryJson: s.summaryJson,
  postCount: s.postCount,
  summarizedAt: s.summarizedAt,
}
```

**File validation edge cases:**
- File không phải JSON → `JSON.parse` throw → catch, hiển thị lỗi "File không đúng định dạng JSON"
- `version` khác `'1.0'` → hiển thị cảnh báo nhưng vẫn cho import (forward-compat graceful)
- Topic thiếu `url` hoặc `title` → skip topic đó, log vào `errors[]`
- `topics` array rỗng → trả về kết quả với `total: 0`, không báo lỗi

**Performance:**
- Import serial (từng topic một) qua background worker là đủ — không cần batch
- File lớn (nhiều topic) vẫn ổn vì mỗi `dbPut` là async

**No new permissions needed** — dùng `<input type="file">` browser standard, không cần File System Access API.

## Implementation Notes

- Tách logic import vào `lib/importer.ts` riêng, đối xứng với `lib/exporter.ts`
- Background handler nên dùng `Promise.allSettled` để không dừng lại khi một topic lỗi
- Conflict mode default là `'skip'` — an toàn hơn cho user lần đầu import
- Sau khi import xong, gọi `refreshCacheSize()` để cập nhật UI storage indicator
- Nút "Nhập dữ liệu" nằm trong cùng khối "Cache local" với nút "Xuất dữ liệu" — UI nhất quán

## Test Plan

- Export toàn bộ cache → xóa sạch cache → import lại → kiểm tra topics xuất hiện đầy đủ trong hub
- Import file với conflict mode `skip`: topic đã có phải giữ nguyên bản cũ
- Import file với conflict mode `overwrite`: topic đã có phải bị replace
- Import file JSON sai format: phải hiển thị lỗi, không crash
- Import file với một topic thiếu `url`: topic đó bị skip, các topic còn lại import bình thường
- Import file rỗng (`topics: []`): hiển thị "Đã nhập 0 topic"
- Kiểm tra storage indicator cập nhật đúng sau import

## Decision Log

### Quyết định 1: Nơi xử lý import — background worker hay sidepanel trực tiếp?

- **Đã chọn:** Xử lý qua background worker (`IMPORT_CACHE` message)
- **Lý do:** Tất cả DB operations đều đi qua background worker (pattern hiện tại của codebase). Sidepanel không nên gọi IndexedDB trực tiếp — tránh race condition với background worker và đảm bảo consistency.
- **Đã cân nhắc nhưng loại:**
  - Sidepanel gọi `dbPut` trực tiếp — loại vì vi phạm pattern kiến trúc, background worker là single writer cho DB
- **Điều kiện thay đổi:** Nếu sau này sidepanel được phép truy cập DB trực tiếp thì có thể simplify

### Quyết định 2: Conflict mode UI — chọn trước hay confirm sau?

- **Đã chọn:** Chọn conflict mode trước khi chọn file (select/radio luôn hiển thị, default `skip`)
- **Lý do:** UX rõ ràng hơn — user biết mình đang làm gì trước khi chọn file. Tránh modal confirm bổ sung.
- **Đã cân nhắc nhưng loại:**
  - Hỏi conflict mode chỉ khi detect có conflict thực sự — loại vì phức tạp hơn, cần 2 round-trip (scan trước, rồi hỏi, rồi import thật)
- **Điều kiện thay đổi:** Nếu UX test cho thấy users bối rối với option này thì đơn giản hóa xuống "luôn skip"

### Quyết định 3: Validate version — strict hay graceful?

- **Đã chọn:** Graceful — cảnh báo nếu version khác `'1.0'` nhưng vẫn cho import
- **Lý do:** File export hiện tại là `'1.0'`; trong tương lai nếu format thay đổi thì xử lý sau. Strict reject sẽ làm khó user không cần thiết.
- **Đã cân nhắc nhưng loại:**
  - Reject hard nếu version != '1.0' — loại vì quá conservative, user sẽ bị stuck nếu dùng version mới hơn
- **Điều kiện thay đổi:** Khi có breaking change trong export format thì cần xử lý migration thực sự
