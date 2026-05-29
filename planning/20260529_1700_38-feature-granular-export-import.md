# Feature 38: Granular Export/Import — Chia sẻ tóm tắt & kiến thức theo thread

## Overview

Hiện tại chỉ có một nút "Xuất dữ liệu" trong Settings để export toàn bộ cache (bulk). Feature này thêm **export nhỏ theo từng thread**, gồm 3 loại: tóm tắt, kiến thức (tab kiến thức), và sổ tay. Mỗi loại có nút export ngay tại chỗ trong UI. Import vẫn qua Settings nhưng nhận diện được các file nhỏ này.

**Mục tiêu dài hạn:** tạo hệ sinh thái chia sẻ — người dùng có thể post file `.json` lên forum/GitHub, người khác download về và import trực tiếp vào extension, không cần tự dùng LLM tóm tắt lại.

## Goals

- Export tóm tắt của 1 thread → file `*_summary.json`
- Export kiến thức (KnowledgeEntry[]) của 1 thread → file `*_knowledge.json`
- Export mục đã lưu ở sổ tay (NotebookEntry[]) theo nhóm thread → file `*_notebook.json`
- Import 3 loại trên qua flow hiện tại (Settings) với skip/overwrite
- Nút export đặt inline ngay tại nơi hiển thị nội dung tương ứng

## Requirements

### A. lib/exporter.ts — Thêm export granular

Mở rộng `CacheExport` — hợp nhất notebook vào cùng format (app chưa release, không cần backward compat):
```ts
export interface CacheExport {
  exportedAt: string;
  version: string;
  scope?: 'full' | 'summary' | 'knowledge' | 'notebook';  // undefined = 'full'
  topicCount: number;
  topics: ExportedTopic[];
  notebookEntries?: NotebookEntry[];  // chỉ có khi scope = 'notebook'
}
```

Không tạo `NotebookExport` riêng — tích hợp vào `CacheExport` luôn. `IMPORT_CACHE` handler xử lý cả notebook entries.

Thêm 3 builder functions:
- `buildSummaryExport(topic: CachedTopic): CacheExport` — chỉ lấy summary fields, bỏ posts/knowledge/chunks
- `buildKnowledgeExport(topic: CachedTopic): CacheExport` — chỉ lấy knowledgeEntries/knowledgeChunks, bỏ posts/summary
- `buildNotebookExport(entries: NotebookEntry[], topicMeta: { url: string; title: string }[]): NotebookExport`

**Summary export fields** — chỉ `summary` + `overallSummary` + metadata cơ bản. Không có segments, posts, hay knowledge (user có thể tự summary lại từ posts đã scrape nếu cần chi tiết hơn):
```ts
{
  url, title, topicType, version, cachedAt, llmConfig,
  totalPosts, forumPostCount, summarizedPostCount, totalPages,
  summary, overallSummary,
  lastPostNumber,
}
```

**Knowledge export fields** (bỏ: `posts`, `summary`, `opinions`, `overallSummary`, `summaryJson`, `segments`, `threadAnalysis`, `researchHistory`):
```ts
{
  url, title, topicType, version, cachedAt, llmConfig,
  totalPosts, lastPostNumber, totalPages,
  knowledgeEntries, knowledgeChunks, lastKnowledgePostNumber, excludedKnowledgePostNumbers,
}
```

Helper: `downloadJson(payload: object, filename: string)` — tạo Blob JSON, trigger download. Tách riêng vì cả 3 loại dùng chung.

### B. lib/importer.ts — Thêm import notebook

Thêm:
```ts
import type { NotebookExport } from './exporter';
export function validateNotebookExport(raw: unknown): NotebookExport
export function isNotebookExport(raw: unknown): boolean  // check scope === 'notebook'
export function isCacheExport(raw: unknown): boolean     // check có topics[]
```

`validateNotebookExport`:
- Kiểm tra `scope === 'notebook'`
- Kiểm tra `entries` là array
- Normalize từng NotebookEntry (url, title, content, tags, v.v. — dùng cùng pattern với `normalizeTopic`)

Import conflict cho notebook: dùng `id` của NotebookEntry làm key để detect duplicate.

### C. entrypoints/background/index.ts — Mở rộng IMPORT_CACHE

Không thêm `IMPORT_NOTEBOOK` — mở rộng `IMPORT_CACHE` để xử lý `notebookEntries` nếu có trong payload:

```ts
case 'IMPORT_CACHE':
  // payload: { topics: ExportedTopic[], notebookEntries?: NotebookEntry[], conflictMode }
  // Xử lý topics như cũ
  // Nếu notebookEntries có: import vào notebookDb với cùng conflict logic (dùng entry.id làm key)
  // Trả về ImportResult tổng hợp (imported = topicsImported + notebookImported)
```

### E. entrypoints/sidepanel/components/ExportButton.vue — Thêm "Xuất JSON tóm tắt"

Thêm 1 option mới vào dropdown hiện có:
- "Xuất JSON tóm tắt" → gọi `buildSummaryExport(topic)` → `downloadJson(payload, `${safeName}_summary.json`)`

Dropdown hiện có: Sao chép Markdown | Sao chép văn bản | Tải file .md
→ Thêm: **Tải JSON tóm tắt** (có thể thêm divider trước nó)

### F. entrypoints/sidepanel/views/KnowledgeView.vue — Thêm nút export kiến thức

Thêm nút **"Xuất JSON"** vào header area của KnowledgeView (cùng hàng với các filter/action buttons hiện có), chỉ hiển thị khi `entries.value.length > 0`.

Click → `buildKnowledgeExport(cachedTopic.value)` → `downloadJson(...)`.

Filename: `${safeName}_knowledge.json`.

### G. entrypoints/sidepanel/views/NotebookView.vue — Thêm nút export theo nhóm

NotebookView hiển thị entries nhóm theo topic (`groupedEntries`). Thêm nút export nhỏ vào header của mỗi nhóm topic:

```html
<button @click="exportGroup(group)" title="Xuất nhóm này">
  <!-- icon download nhỏ -->
</button>
```

`exportGroup(group)`:
- Lấy `entries` của group đó
- Lấy `topicMeta` (url + title)
- `buildNotebookExport(entries, [topicMeta])` → `downloadJson(...)`
- Filename: `${safeName}_notebook.json`

### H. entrypoints/sidepanel/views/SettingsView.vue — Nhận diện scope khi import

Sửa flow import hiện tại:
1. Parse JSON
2. Kiểm tra `isNotebookExport(raw)` → dùng `validateNotebookExport` → gửi `IMPORT_NOTEBOOK`
3. Ngược lại → `validateCacheExport` → gửi `IMPORT_CACHE` (như hiện tại)
4. Message kết quả phân biệt: "Đã nhập X mục kiến thức" vs "Đã nhập X topic"

## Technical Considerations

**Affected files:**
- `lib/exporter.ts` — thêm scope field, 3 builder functions, downloadJson helper
- `lib/importer.ts` — thêm validateNotebookExport, isNotebookExport, isCacheExport
- `lib/types.ts` — thêm MessageType
- `entrypoints/background/index.ts` — thêm IMPORT_NOTEBOOK handler
- `entrypoints/sidepanel/components/ExportButton.vue` — thêm option JSON
- `entrypoints/sidepanel/views/KnowledgeView.vue` — thêm export button
- `entrypoints/sidepanel/views/NotebookView.vue` — thêm export per group
- `entrypoints/sidepanel/views/SettingsView.vue` — branch import theo scope

**`downloadJson` helper** — đặt trong `lib/exporter.ts` hoặc tách riêng `lib/download-utils.ts`. Dùng chung cho tất cả loại export:
```ts
export function downloadJson(payload: object, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
```

**Backward compatibility:** File export từ feature này vẫn import được bình thường vào flow cũ nếu scope = 'summary'/'knowledge' (vì `validateCacheExport` chỉ cần `topics[]` và `version`). Scope mới chỉ dùng để phân loại — không break existing.

**NotebookEntry dedup khi import:** Dùng `id` (uuid) làm key. Conflict skip: `notebookDbGet(entry.id)` — nếu đã có thì skip. Conflict overwrite: `notebookDbPut(entry)` trực tiếp.

**File size:** Summary JSON của 1 thread có thể lớn nếu có nhiều segments. Không gzip ở bước này — để đơn giản. User tự zip trước khi share nếu cần.

**Sổ tay export — nhóm theo topic vs. toàn bộ:** Chỉ export theo nhóm (per group trong NotebookView). Không cần "export toàn bộ sổ tay" ở giai đoạn này.

## Implementation Notes

Thứ tự implement:
1. `lib/exporter.ts` — thêm types + builders + downloadJson
2. `lib/importer.ts` — thêm notebook validator
3. `lib/types.ts` + `background/index.ts` — IMPORT_NOTEBOOK handler
4. `ExportButton.vue` — option JSON tóm tắt (ít thay đổi nhất)
5. `KnowledgeView.vue` — nút export
6. `NotebookView.vue` — nút export per group
7. `SettingsView.vue` — branch import

## Test Plan

- Export tóm tắt 1 thread → file `*_summary.json` → xóa topic → import lại → tóm tắt xuất hiện đủ trong SummaryView
- Export kiến thức 1 thread → file `*_knowledge.json` → xóa topic → import lại → KnowledgeView hiển thị đủ entries
- Export nhóm sổ tay → file `*_notebook.json` → xóa entries → import lại → NotebookView hiển thị lại
- Import với conflict skip: entry đã có giữ nguyên bản cũ
- Import với conflict overwrite: entry đã có bị replace
- Import file `*_summary.json` bằng extension đã có topic đó: conflict mode hoạt động đúng
- File JSON tóm tắt không chứa raw posts hay knowledge (kiểm tra size hợp lý)

## Decision Log

### Quyết định 1: Dùng chung format CacheExport hay tạo format mới?

- **Đã chọn:** Dùng chung `CacheExport` (thêm `scope` field) cho summary và knowledge; tạo `NotebookExport` riêng cho notebook
- **Lý do:** Summary và knowledge đều là subset của `ExportedTopic` — importer hiện tại đã handle optional fields. Notebook khác hoàn toàn (NotebookEntry không nằm trong CachedTopic) nên cần format riêng.
- **Đã cân nhắc nhưng loại:**
  - Tạo 3 format hoàn toàn riêng biệt — loại vì duplicate code không cần thiết cho summary/knowledge
  - Dùng chung 1 format cho cả notebook — loại vì NotebookEntry là DB riêng, shape khác, ép vào CacheExport sẽ awkward
- **Điều kiện thay đổi:** Nếu cần validate strict theo scope thì thêm schema versioning

### Quyết định 2: Đặt nút export ở đâu trong KnowledgeView?

- **Đã chọn:** Header area của KnowledgeView, cùng hàng với action buttons, chỉ hiện khi có entries
- **Lý do:** Consistent với pattern của app — actions ở header. Không cần per-entry export button vì knowledge của 1 thread luôn export cùng nhau.
- **Đã cân nhắc nhưng loại:**
  - Per-segment export — loại vì granular quá, người dùng chủ yếu muốn share toàn bộ kiến thức của 1 thread
  - Đặt trong Settings — loại vì quá xa, mất context
- **Điều kiện thay đổi:** Nếu có yêu cầu export từng segment riêng thì thêm sau

### Quyết định 3: NotebookView export theo group hay toàn bộ?

- **Đã chọn:** Export theo group (per topic)
- **Lý do:** Mục đích là chia sẻ kiến thức của 1 thread. Export toàn bộ sổ tay thì quá personal, không phù hợp để share.
- **Đã cân nhắc nhưng loại:**
  - Export toàn bộ sổ tay — loại vì lẫn lộn nhiều thread, khó share
  - Export từng entry riêng lẻ — loại vì granular quá, thêm noise vào UI
- **Điều kiện thay đổi:** Có thể thêm "Export toàn bộ sổ tay" vào Settings sau nếu có nhu cầu

### Quyết định 4: downloadJson helper — đặt ở đâu?

- **Đã chọn:** Đặt trong `lib/exporter.ts`
- **Lý do:** Tất cả export logic đã ở đây, không cần thêm file riêng cho 1 hàm nhỏ
- **Điều kiện thay đổi:** Nếu download logic phức tạp hơn (gzip, stream) thì tách ra
