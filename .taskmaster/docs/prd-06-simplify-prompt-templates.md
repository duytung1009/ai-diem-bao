<context>
# Overview

Hiện tại hệ thống Prompt Templates trong Settings yêu cầu người dùng cấu hình quá nhiều prompt (7 templates) cho chỉ 4 tính năng chính. Điều này gây nhầm lẫn và tăng ma sát khi tùy chỉnh.

**Vấn đề cụ thể:**
- Tab Tóm tắt cần 3 prompt riêng biệt: `summary` (topic nhỏ), `chunkSummaryPrompt` (map phase), `reduceSummaryPrompt` (reduce phase)
- Tab Kiến thức dùng 1 prompt `knowledge` nhưng hệ thống internally dùng thêm `knowledgeChunkPrompt` và `knowledgeReducePrompt` (hardcoded, không customizable)
- Người dùng không cần phân biệt giữa map/reduce/direct phase — họ chỉ muốn "1 prompt cho Tóm tắt, 1 prompt cho Kiến thức"

**Giải pháp:** Giảm từ 7 prompt templates xuống còn **4 prompt templates** (1 cho mỗi tab: Tóm tắt, Kiến thức, Tra cứu, Phân tích) bằng cách sử dụng placeholder động trong prompt để hệ thống tự động sinh biến thể cho từng phase.

**Giá trị mang lại:**
- UX đơn giản hơn 43% (7 → 4 tabs trong Settings)
- Người dùng chỉ cần viết 1 prompt duy nhất cho mỗi tính năng
- Backward compatible với prompt đã lưu trước đó
- Giữ nguyên khả năng tùy biến cao cấp thông qua placeholder

# Core Features

## Feature 1: Placeholder System cho Prompt Templates

**What it does:**
Cho phép người dùng sử dụng các placeholder động trong prompt template. Hệ thống sẽ tự động thay thế giá trị phù hợp tùy theo ngữ cảnh (direct/map/reduce phase).

**Placeholders hỗ trợ:**
- `{wordCap}` — Số từ tối đa cho tóm tắt (hệ thống tự điền: 500 cho direct/final, 300 cho chunk)
- `{entryCap}` — Số entry tối đa cho kiến thức (hệ thống tự điền theo maxTokens)
- `{isChunk}` — `"true"` nếu đang xử lý 1 phần của topic lớn, `"false"` nếu đang gộp cuối
- `{authorCrossRef}` — Bảng đối chiếu tác giả xuất hiện ở nhiều phần (chỉ có ở reduce phase, rỗng ở các phase khác)

**Why it's important:**
- Loại bỏ nhu cầu viết nhiều prompt cho cùng 1 tính năng
- Giữ nguyên flexibility cho power users muốn tùy chỉnh sâu
- Prompt không dùng placeholder vẫn hoạt động bình thường (backward compatible)

**How it works:**
- Hàm `resolvePrompt()` trong `lib/prompts.ts` nhận base prompt + mode + params
- Thay thế placeholder bằng giá trị thực tế trước khi gửi cho LLM
- Nếu prompt không chứa placeholder, dùng nguyên văn (fallback)

## Feature 2: Đơn giản hóa CustomPrompts Interface

**What it does:**
Loại bỏ 2 keys `chunkSummaryPrompt` và `reduceSummaryPrompt` khỏi interface `CustomPrompts`. Chỉ giữ lại 5 keys: `summary`, `opinions`, `knowledge`, `research`, `threadAnalysis`.

**Why it's important:**
- Giảm complexity của data model
- Đơn giản hóa UI Settings từ 6 tabs → 4 tabs
- Dễ maintain codebase hơn

## Feature 3: Migration tự động cho prompts đã lưu

**What it does:**
Tự động migrate custom prompts đã lưu từ format cũ (7 keys) sang format mới (5 keys) trong lần đầu chạy sau update.

**Migration logic:**
- Nếu user có `chunkSummaryPrompt` hoặc `reduceSummaryPrompt` → merge nội dung vào `summary` prompt (ưu tiên `summary` làm base)
- Lưu flag `promptsMigratedV2 = true` vào storage để không migrate lại
- Prompt cũ vẫn hoạt động trong quá trình migration (zero downtime)

# User Experience

## User Personas

1. **User phổ thông** — Chỉ muốn tùy chỉnh prompt cơ bản, không quan tâm map/reduce/phase
2. **Power user** — Muốn kiểm soát chi tiết output LLM ở từng phase, sẵn sàng dùng placeholder

## Key User Flows

### Flow 1: User phổ thông tùy chỉnh prompt Tóm tắt
1. Mở Settings → Tab "Prompt Templates"
2. Chọn tab "Tóm tắt" (chỉ còn 1 tab, không còn "Tóm tắt phần", "Gộp tóm tắt")
3. Nhập prompt tùy chỉnh (không cần placeholder)
4. Nhấn "Lưu" → Xong

### Flow 2: Power user dùng placeholder
1. Mở Settings → Tab "Tóm tắt"
2. Nhấn "Xem template mẫu" → Copy prompt có sẵn placeholder
3. Chỉnh sửa prompt theo nhu cầu, giữ nguyên `{wordCap}`, `{isChunk}`...
4. Nhấn "Lưu" → Xong

### Flow 3: User xem prompt mặc định
1. Mở Settings → Tab "Tóm tắt"
2. Nhấn "Xem prompt mặc định" → Xem full prompt gốc
3. Có thể copy để làm base cho prompt tùy chỉnh

## UI/UX Considerations

- **SettingsView.vue**: Giảm từ 6 tabs xuống 4 tabs: `Tóm tắt`, `Kiến thức`, `Tra cứu`, `Phân tích`
- **Template mẫu**: Thêm button "Chèn template mẫu" cho mỗi tab, chèn prompt có placeholder
- **Tooltip giải thích**: Hover vào placeholder → hiển thị giải thích ngắn gọn
- **Validation cảnh báo**: Nếu prompt không có placeholder → hiển thị info "Prompt này sẽ dùng cho mọi trường hợp. Dùng placeholder để tùy chỉnh theo ngữ cảnh."
</context>
<PRD>
# Technical Architecture

## System Components

### 1. Prompt Resolver (`lib/prompts.ts`)

Thêm hàm mới `resolvePrompt()` xử lý placeholder replacement:

```typescript
interface PromptResolveOptions {
  mode: 'direct' | 'map' | 'reduce';
  wordCap?: number;
  entryCap?: number;
  authorCrossRef?: string;
}

function resolvePrompt(
  templateKey: 'summary' | 'knowledge',
  customPrompt: string | undefined,
  options: PromptResolveOptions,
): string
```

**Logic:**
1. Lấy base prompt: `customPrompt || DEFAULT_PROMPT[templateKey]`
2. Thay `{wordCap}` → `options.wordCap` (default: 500)
3. Thay `{entryCap}` → `options.entryCap` (default: 20)
4. Thay `{isChunk}` → `options.mode === 'map' ? 'true' : 'false'`
5. Thay `{authorCrossRef}` → `options.authorCrossRef || ''`
6. Nếu prompt không chứa placeholder → trả về nguyên văn

### 2. Updated CustomPrompts Interface (`lib/types.ts`)

```typescript
export interface CustomPrompts {
  summary?: string;
  opinions?: string;
  research?: string;
  knowledge?: string;
  threadAnalysis?: string;
  // REMOVED: chunkSummaryPrompt, reduceSummaryPrompt
}
```

### 3. Summarizer Updates (`lib/llm/summarizer.ts`)

Cập nhật tất cả các hàm đang dùng `chunkSummaryPrompt`/`reduceSummaryPrompt` để dùng `resolvePrompt()` thay thế:

**Hàm `summarizeTopic()`:**
- Direct mode: `resolvePrompt('summary', customPrompts?.summary, { mode: 'direct', wordCap: 500 })`
- Map phase: `resolvePrompt('summary', customPrompts?.summary, { mode: 'map', wordCap: 300 })`
- Reduce phase: `resolvePrompt('summary', customPrompts?.summary, { mode: 'reduce', wordCap: 500, authorCrossRef: crossRef })`

**Hàm `updateSummary()`:**
- Tương tự `summarizeTopic()`

**Hàm `summaryChunks()`:**
- Map phase: dùng `resolvePrompt('summary', ..., { mode: 'map' })`
- Reduce phase: dùng `resolvePrompt('summary', ..., { mode: 'reduce' })`

**Hàm `reduceSegmentSummaries()`:**
- Reduce phase: dùng `resolvePrompt('summary', ..., { mode: 'reduce' })`

**Hàm `extractKnowledge()`:**
- Direct: `resolvePrompt('knowledge', customPrompts?.knowledge, { mode: 'direct', entryCap: computed })`

**Hàm `extractKnowledgeChunk()`:**
- Map: `resolvePrompt('knowledge', customPrompts?.knowledge, { mode: 'map', entryCap: computed })`

**Hàm `reduceKnowledgeChunks()`:**
- Reduce: `resolvePrompt('knowledge', customPrompts?.knowledge, { mode: 'reduce', entryCap: computed })`

### 4. Migration Layer (`lib/cache-manager.ts` hoặc `entrypoints/background/index.ts`)

Thêm migration function chạy khi extension startup:

```typescript
async function migratePromptsV2(): Promise<void> {
  const migrated = await browser.storage.sync.get('promptsMigratedV2');
  if (migrated.promptsMigratedV2) return;

  const oldPrompts = await browser.storage.sync.get('custom-prompts');
  if (!oldPrompts['custom-prompts']) {
    await browser.storage.sync.set({ promptsMigratedV2: true });
    return;
  }

  const prompts = oldPrompts['custom-prompts'] as Record<string, string>;
  const newPrompts: CustomPrompts = {};

  // Keep existing 5 keys
  for (const key of ['summary', 'opinions', 'research', 'knowledge', 'threadAnalysis']) {
    if (prompts[key]) newPrompts[key] = prompts[key];
  }

  // Merge chunk/reduce prompts into summary if they exist
  if (prompts.chunkSummaryPrompt || prompts.reduceSummaryPrompt) {
    const baseSummary = prompts.summary || SUMMARY_PROMPT;
    const chunkPart = prompts.chunkSummaryPrompt || '';
    const reducePart = prompts.reduceSummaryPrompt || '';

    // If user had different prompts, append guidance
    if (chunkPart && chunkPart !== baseSummary) {
      newPrompts.summary = baseSummary + '\n\n[Ghi chú từ prompt "Tóm tắt phần" cũ:]\n' + chunkPart;
    }
    if (reducePart && reducePart !== baseSummary) {
      newPrompts.summary = (newPrompts.summary || baseSummary) + '\n\n[Ghi chú từ prompt "Gộp tóm tắt" cũ:]\n' + reducePart;
    }
  }

  await browser.storage.sync.set({
    'custom-prompts': newPrompts,
    promptsMigratedV2: true,
  });
}
```

### 5. SettingsView.vue Updates

**Thay đổi UI:**
- Giảm tabs từ 6 → 4: `['summary', 'knowledge', 'research', 'threadAnalysis']`
- Thêm `promptTabLabels`: `{ summary: 'Tóm tắt', knowledge: 'Kiến thức', research: 'Tra cứu', threadAnalysis: 'Phân tích' }`
- Thêm button "Chèn template mẫu" cho mỗi tab
- Thêm tooltip giải thích placeholder

**Template mẫu cho tab Tóm tắt:**
```
Bạn là công cụ tóm tắt thảo luận diễn đàn. Chỉ trả về JSON.

Nhiệm vụ: Đọc các bài viết và tóm tắt thành JSON có cấu trúc.
{isChunk, select,
  true {Đây là một phần của topic lớn — giữ đủ chi tiết để gộp sau.}
  false {Bạn nhận nhiều bản tóm tắt từ các phần. Hãy gộp thành 1 JSON hoàn chỉnh.}
  other {}
}

BẮT BUỘC:
- Output PHẢI là JSON hợp lệ
- Giữ bản tóm tắt dưới {wordCap} từ
{authorCrossRef}

Trả về JSON:
{
  "summary": "...",
  "opinions": [...],
  "conclusion": "..."
}
```

**Template mẫu cho tab Kiến thức:**
```
Bạn là trợ lý AI trích xuất kiến thức từ thảo luận diễn đàn.

Nhiệm vụ: Đọc các bài viết và trích xuất kiến thức hữu ích.
{isChunk, select,
  true {Đây là một phần của topic — trích xuất tối đa {entryCap} entry.}
  false {Bạn nhận nhiều danh sách kiến thức từ các phần. Hãy merge, dedup và chọn lọc thành 1 danh sách cuối cùng, tối đa {entryCap} entry.}
  other {Trích xuất tối đa {entryCap} entry.}
}

BẮT BUỘC:
- Output PHẢI là JSON array hợp lệ
- Tags từ danh sách: 'kinh nghiệm', 'mẹo', 'cảnh báo', 'thống kê', 'so sánh', 'hướng dẫn', 'đánh giá', 'tài nguyên'

Trả về JSON array:
[
  {
    "title": "...",
    "content": "...",
    "tags": [...],
    "category": "...",
    "source": { "author": "...", "postNumber": N }
  }
]
```

## Data Models

### CustomPrompts (updated)
```typescript
export interface CustomPrompts {
  summary?: string;
  opinions?: string;
  research?: string;
  knowledge?: string;
  threadAnalysis?: string;
}
```

### Storage Keys
- `custom-prompts` → `CustomPrompts` object (trong `browser.storage.sync`)
- `promptsMigratedV2` → `boolean` (flag migration)

## APIs and Integrations

Không có API mới. Chỉ refactor internal code.

## Infrastructure Requirements

Không thay đổi infrastructure.

# Development Roadmap

## Phase 1 — Foundation (Prompt Resolver + Types)

**Scope:** Tạo nền tảng cho placeholder system

1. Cập nhật `CustomPrompts` interface trong `lib/types.ts` — xóa `chunkSummaryPrompt`, `reduceSummaryPrompt`
2. Thêm hàm `resolvePrompt()` trong `lib/prompts.ts` với logic placeholder replacement
3. Thêm template mẫu cho Summary và Knowledge vào `lib/prompts.ts` (export const)
4. Viết unit test cho `resolvePrompt()` (test các trường hợp: có placeholder, không có placeholder, partial placeholder)

## Phase 2 — Summarizer Integration

**Scope:** Cập nhật tất cả hàm trong `lib/llm/summarizer.ts` để dùng `resolvePrompt()`

1. `summarizeTopic()` — dùng `resolvePrompt('summary', ...)` cho direct/map/reduce
2. `updateSummary()` — dùng `resolvePrompt('summary', ...)`
3. `summaryChunks()` — dùng `resolvePrompt('summary', ...)` cho map/reduce
4. `reduceSegmentSummaries()` — dùng `resolvePrompt('summary', ...)` cho reduce
5. `extractKnowledge()` — dùng `resolvePrompt('knowledge', ...)`
6. `extractKnowledgeChunk()` — dùng `resolvePrompt('knowledge', ...)`
7. `reduceKnowledgeChunks()` — dùng `resolvePrompt('knowledge', ...)`
8. Xóa các hàm builder cũ không còn dùng: `buildChunkSummaryPrompt`, `buildReduceSummaryPrompt`, `buildKnowledgeExtractPrompt`, `buildKnowledgeChunkPrompt`, `buildKnowledgeReducePrompt` (hoặc giữ lại làm fallback nội bộ)
9. Xóa các const prompt không còn customizable: `CHUNK_SUMMARY_PROMPT`, `REDUCE_SUMMARY_PROMPT`, `KNOWLEDGE_EXTRACT_PROMPT`, `KNOWLEDGE_CHUNK_PROMPT` (giữ làm default cho `resolvePrompt()`)

## Phase 3 — Migration Layer

**Scope:** Tự động migrate custom prompts đã lưu

1. Thêm `migratePromptsV2()` trong `entrypoints/background/index.ts`
2. Gọi migration khi extension startup (trong `background/index.ts` entry point)
3. Test migration với các trường hợp:
   - User có cả 7 prompts → merge đúng
   - User chỉ có `summary` → giữ nguyên
   - User chưa có prompt nào → skip
   - User đã migrate rồi → skip (idempotent)

## Phase 4 — SettingsView UI Update

**Scope:** Cập nhật UI Settings để phản ánh thay đổi

1. Giảm tabs từ 6 → 4 trong `SettingsView.vue`
2. Cập nhật `activePromptTab` type
3. Cập nhật `defaultPrompts` object
4. Cập nhật `promptTabLabels`
5. Thêm button "Chèn template mẫu" cho mỗi tab
6. Thêm tooltip giải thích placeholder (dùng `title` attribute hoặc custom tooltip)
7. Thêm info banner: "Prompt này dùng cho mọi trường hợp. Dùng placeholder để tùy chỉnh theo ngữ cảnh."

## Phase 5 — Cleanup & Verification

**Scope:** Dọn dẹp code cũ, verify toàn bộ flow

1. Xóa import không còn dùng trong các file
2. Chạy `npm run compile` — fix tất cả type errors
3. Test manual flow:
   - Tóm tắt topic nhỏ (direct mode)
   - Tóm tắt topic lớn (map-reduce mode)
   - Cập nhật summary (incremental mode)
   - Trích xuất kiến thức topic nhỏ
   - Trích xuất kiến thức topic lớn (chunked)
   - Migration từ prompt cũ
4. Build production: `npm run build`

# Logical Dependency Chain

```
Phase 1 (Foundation)
    ↓
Phase 2 (Summarizer Integration) — phụ thuộc Phase 1 (cần resolvePrompt())
    ↓
Phase 3 (Migration Layer) — có thể làm song song Phase 2
    ↓
Phase 4 (SettingsView UI) — phụ thuộc Phase 1 (cần types mới)
    ↓
Phase 5 (Cleanup & Verification) — phụ thuộc tất cả phase trước
```

**Thứ tự ưu tiên để có MVP nhanh:**
1. Phase 1 → Có resolver hoạt động
2. Phase 2 → Summarizer dùng resolver → backend hoạt động
3. Phase 4 → UI cập nhật → user thấy thay đổi
4. Phase 3 → Migration → backward compatible
5. Phase 5 → Cleanup → production ready

# Risks and Mitigations

## Risk 1: Prompt cũ không có placeholder hoạt động sai

**Mô tả:** User đã lưu prompt tùy chỉnh không chứa placeholder. Khi hệ thống gọi `resolvePrompt()`, prompt có thể thiếu thông tin ngữ cảnh (wordCap, isChunk...).

**Giảm thiểu:**
- `resolvePrompt()` chỉ thay thế placeholder nếu tồn tại trong prompt
- Nếu không có placeholder → dùng prompt nguyên văn (backward compatible 100%)
- Thêm info banner trong Settings cảnh báo user về lợi ích của placeholder

## Risk 2: Migration làm mất prompt đã lưu

**Mô tả:** Quá trình merge `chunkSummaryPrompt` và `reduceSummaryPrompt` vào `summary` có thể tạo prompt không mong muốn.

**Giảm thiểu:**
- Migration chỉ append ghi chú, không overwrite prompt `summary` gốc
- Backup prompt cũ vào `custom-prompts-backup-v1` trước khi migrate
- Migration idempotent — chạy lại không gây hại
- User có thể reset về default bất cứ lúc nào

## Risk 3: Placeholder syntax xung đột với nội dung prompt

**Mô tả:** User viết prompt có chứa text trùng với placeholder (ví dụ: "wordCap là gì?").

**Giảm thiểu:**
- Placeholder dùng format `{tên}` — ít khả năng xung đột với text thường
- Nếu xảy ra, user có thể escape bằng cách dùng `{{wordCap}}` (sẽ không bị replace)
- Documentation rõ ràng về placeholder syntax

## Risk 4: Breaking change với các file import prompt cũ

**Mô tả:** Các file khác ngoài summarizer có thể import `CHUNK_SUMMARY_PROMPT`, `buildChunkSummaryPrompt`...

**Giảm thiểu:**
- Giữ lại export các const/function cũ (deprecated) trong `lib/prompts.ts`
- Thêm JSDoc `@deprecated` warning
- Xóa hoàn toàn ở version sau (semver major)

# Appendix

## Current Prompt Count (Before)

| Tab | Prompt Keys | Count |
|---|---|---|
| Tóm tắt | `summary`, `chunkSummaryPrompt`, `reduceSummaryPrompt` | 3 |
| Kiến thức | `knowledge` | 1 |
| Tra cứu | `research` | 1 |
| Phân tích | `threadAnalysis` | 1 |
| **Tổng** | | **6 customizable + 1 hardcoded** |

## Target Prompt Count (After)

| Tab | Prompt Keys | Count |
|---|---|---|
| Tóm tắt | `summary` | 1 |
| Kiến thức | `knowledge` | 1 |
| Tra cứu | `research` | 1 |
| Phân tích | `threadAnalysis` | 1 |
| **Tổng** | | **4** |

## Placeholder Reference

| Placeholder | Type | Description | Default Value |
|---|---|---|---|
| `{wordCap}` | number | Số từ tối đa cho tóm tắt | 500 (direct/reduce), 300 (map) |
| `{entryCap}` | number | Số entry tối đa cho kiến thức | Computed from maxTokens |
| `{isChunk}` | string | `"true"` nếu đang xử lý 1 phần | `"false"` (direct/reduce) |
| `{authorCrossRef}` | string | Bảng đối chiếu tác giả | `""` (empty, chỉ có ở reduce) |

## Files to Modify

1. `lib/types.ts` — Update `CustomPrompts` interface
2. `lib/prompts.ts` — Add `resolvePrompt()`, template samples
3. `lib/llm/summarizer.ts` — Replace all prompt usage with `resolvePrompt()`
4. `entrypoints/background/index.ts` — Add migration function
5. `entrypoints/sidepanel/views/SettingsView.vue` — Update UI tabs, add template buttons
6. `entrypoints/sidepanel/composables/useSummarize.ts` — Update token estimation if needed
7. `entrypoints/sidepanel/views/SummaryView.vue` — Update token estimation if needed
8. `entrypoints/sidepanel/views/KnowledgeView.vue` — Update token estimation if needed

## Files to Keep (No Changes)

- `lib/llm/factory.ts`
- `lib/llm/utils.ts`
- `lib/llm/cost-estimator.ts`
- `lib/llm/retry.ts`
- `lib/cache-manager.ts`
- `lib/cache-db.ts`
- `lib/messaging.ts`
- `lib/constants.ts` (except possibly add new constants for template samples)
- All content scripts
- All other views/components
</PRD>
