# Batch Plan: JSON Output + Persist Scraping Data

**Ngày:** 2026-03-30
**Features:**
- Feature 15: Chuẩn hóa output tóm tắt từ Markdown → JSON, bổ sung quote bài viết cho từng quan điểm
- Feature 16: Lưu dữ liệu scraping để tránh scrape lại khi tóm tắt bị lỗi/hủy

---

## Dependency Graph

```
Feature 16 (Persist Scraping)     Feature 15 (JSON Output)
         │                                │
         ├─ CachedTopic.posts (đã có)     ├─ lib/prompts.ts
         ├─ SummaryView.vue               ├─ lib/types.ts (SummaryJSON)
         ├─ cache-manager.ts              ├─ lib/llm/summarizer.ts
         └─ background/index.ts           ├─ SummaryContent.vue
                                          ├─ SummaryView.vue
                                          └─ background/index.ts
```

**Shared touchpoints:** `SummaryView.vue`, `background/index.ts`, `CachedTopic` type
**Conflicts:** Cả hai đều sửa `confirmSummarize()` trong SummaryView — implement tuần tự, Feature 16 trước.

---

## Implementation Order

**Feature 16 trước → Feature 15 sau**

Lý do:
1. Feature 16 đơn giản hơn (~80 LOC), ít risk
2. Feature 16 đảm bảo posts luôn available trong cache → Feature 15 có thể rely vào đó khi cần re-summarize
3. Feature 15 thay đổi LLM output format (breaking change cho parsing) — cần Feature 16 ổn định trước để rollback dễ

---

## Feature 16: Persist Scraping Data

### Objective & Scope

Lưu posts vào IndexedDB ngay sau khi scrape xong (trước khi gửi LLM), để:
- User cancel/LLM timeout → không cần scrape lại
- "Tóm tắt lại" luôn có posts sẵn (đã fix một phần ở `fix-wrong-post-count-display`, nhưng chỉ khi đã tóm tắt thành công lần đầu)

### Hiện trạng

- `handleSummarize()`: scrape → set `pendingPosts` → user confirm → `confirmSummarize()` gửi LLM → success → `SAVE_CACHED_TOPIC` (bao gồm posts)
- **Vấn đề:** Nếu LLM fail hoặc user cancel giữa chừng, posts chưa được save → lần sau phải scrape lại
- `CachedTopic.posts` đã có trong type — chỉ cần save sớm hơn

### Affected Modules

- `entrypoints/sidepanel/views/SummaryView.vue` — `handleSummarize()`, `handleSummarizeSegment()`
- `entrypoints/background/index.ts` — `SAVE_CACHED_TOPIC` handler (đã có merge logic)

### Implementation Steps

1. **SummaryView.vue — `handleSummarize()`** (sau khi scrape xong, trước return):
   ```typescript
   // Lưu posts vào cache ngay sau scrape, trước khi chờ user confirm
   if (posts.length > 0) {
     const topic = store.selectedTopic.value!;
     await sendMessage('SAVE_CACHED_TOPIC', {
       url: topic.url,
       title: topic.title,
       version: topic.version,
       posts: incremental ? [...(cachedTopic.value?.posts ?? []), ...posts] : posts,
       totalPages: pageCount,
       totalPosts: posts.filter(p => p.postNumber > 0).length,
     }).catch(() => {}); // silent — best effort
     // Refresh cachedTopic để confirmSummarize() dùng đúng
     cachedTopic.value = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url) ?? cachedTopic.value;
   }
   ```

2. **SummaryView.vue — `handleSummarizeSegment()`** (tương tự, sau scrape segment):
   - Save segment posts vào cache ngay sau scrape, trước khi gửi LLM

3. **Không cần sửa background** — `SAVE_CACHED_TOPIC` handler đã merge partial updates, giữ nguyên `summary` và `segments` nếu không có trong payload mới

### Edge Cases

- **Incremental scrape:** Merge posts cũ + mới trước khi save
- **News detection posts** (postNumber < 0): Phải include trong save
- **Race condition:** User cancel rồi scrape lại nhanh → `SAVE_CACHED_TOPIC` merge idempotent, OK
- **Cache size:** Posts đã lưu trong IndexedDB (không giới hạn 8MB như storage.local cũ), OK

### Test Plan

- [ ] Scrape topic 4 trang → cancel trước confirm → mở lại → "Tóm tắt" dùng cached posts, không scrape lại
- [ ] Scrape → LLM fail (invalid API key) → retry → dùng cached posts
- [ ] Incremental: có cache 4 trang → topic giờ 6 trang → incremental scrape 2 trang → posts merge đúng
- [ ] Segment mode: scrape segment → cancel → segment posts đã lưu

### Rollback Plan

Xóa early-save block — logic quay về như cũ (save chỉ khi LLM thành công).

---

## Feature 15: JSON Output + Quote bài viết

### Objective & Scope

Chuyển LLM output từ Markdown tự do sang JSON có cấu trúc, bổ sung trường `quotes` (trích dẫn gốc từ bài viết) cho mỗi quan điểm. UI render từ JSON thay vì parse regex.

### Hiện trạng

**Output hiện tại** (Markdown, parse bằng regex trong SummaryContent.vue):
```markdown
## Tóm tắt
Nội dung chính...

## Quan điểm nổi bật
### Ủng hộ A (5 người ủng hộ)
Chi tiết quan điểm...

## Kết luận
...
```

**Vấn đề:**
- Regex parse `### ` + `(N người)` không robust — LLM có thể output format hơi khác
- Không có trích dẫn gốc từ bài viết → user không verify được thông tin
- Không thể thêm metadata (confidence, author list) dễ dàng

### Target Output Format (JSON)

```typescript
interface SummaryJSON {
  summary: string;           // Tóm tắt chính (2-3 đoạn, plain text hoặc markdown nhẹ)
  opinions: OpinionItem[];   // Quan điểm nổi bật
  conclusion: string;        // Kết luận
}

interface OpinionItem {
  title: string;             // Tên quan điểm
  description: string;       // Mô tả chi tiết (2-3 câu)
  supporters: string[];      // Danh sách tên tác giả
  quotes: QuoteItem[];       // Trích dẫn gốc (1-3 trích dẫn tiêu biểu)
}

interface QuoteItem {
  author: string;            // Tên tác giả
  postNumber: number;        // Số bài viết (#N)
  text: string;              // Nội dung trích dẫn (1-2 câu)
}
```

### Affected Modules

| File | Thay đổi |
|------|----------|
| `lib/types.ts` | Thêm `SummaryJSON`, `OpinionItem`, `QuoteItem` interfaces |
| `lib/prompts.ts` | Rewrite SUMMARY_PROMPT, CHUNK_SUMMARY_PROMPT, REDUCE_SUMMARY_PROMPT → yêu cầu JSON output |
| `lib/llm/summarizer.ts` | Parse + validate JSON output; fallback nếu LLM trả Markdown |
| `entrypoints/background/index.ts` | Return parsed JSON trong `LLM_RESULT` |
| `SummaryContent.vue` | Render từ `SummaryJSON` object thay vì regex parse Markdown |
| `SummaryView.vue` | Handle cả JSON (mới) và string (cũ, backward compat) |
| `CachedTopic` | `summary: string \| SummaryJSON` (hoặc thêm `summaryJson?` field) |

### Implementation Steps

#### Step 1: Types (`lib/types.ts`)

Thêm `SummaryJSON`, `OpinionItem`, `QuoteItem` interfaces (như trên).

Thêm field vào `CachedTopic`:
```typescript
summaryJson?: SummaryJSON;  // Structured output (Feature 15+)
// Giữ `summary: string` cho backward compatibility
```

#### Step 2: Prompts (`lib/prompts.ts`)

**SUMMARY_PROMPT** (cho topic nhỏ, single-pass):
```
Nhiệm vụ: Tóm tắt topic và trả về kết quả dạng JSON.

BẮT BUỘC:
- Output PHẢI là JSON hợp lệ, KHÔNG có text nào khác
- Trích dẫn (quotes) PHẢI là câu nguyên văn từ bài viết, kèm số bài (#N)
- Mỗi quan điểm PHẢI có ít nhất 1 trích dẫn
- Tuyệt đối không dùng dấu " trong nội dung text — dùng ' thay thế

{
  "summary": "Tóm tắt nội dung chính (2-3 đoạn, dưới 300 từ)",
  "opinions": [
    {
      "title": "Tên quan điểm",
      "description": "Mô tả chi tiết (2-3 câu)",
      "supporters": ["Tên tác giả 1", "Tên tác giả 2"],
      "quotes": [
        {"author": "Tên", "postNumber": 5, "text": "Trích dẫn nguyên văn"}
      ]
    }
  ],
  "conclusion": "Kết luận hoặc đồng thuận chung"
}
```

**CHUNK_SUMMARY_PROMPT** (map phase — mỗi chunk):
- Cùng format JSON nhưng giới hạn 200 từ cho `summary`
- `quotes` bắt buộc — đây là phase giữ chi tiết

**REDUCE_SUMMARY_PROMPT** (reduce phase — gộp chunks):
- Input: mảng JSON từ map phase
- Output: JSON gộp — merge supporters cùng quan điểm, chọn quotes tiêu biểu nhất (max 3 mỗi opinion)
- Yêu cầu: loại bỏ trùng lặp, đếm tổng supporters

#### Step 3: Summarizer (`lib/llm/summarizer.ts`)

Thêm helper functions:

```typescript
function parseSummaryJSON(raw: string): SummaryJSON | null {
  // 1. Trim whitespace, xử lý markdown code fences (```json...```)
  // 2. Try JSON.parse
  // 3. Validate structure (có summary, opinions array, conclusion)
  // 4. Return null nếu invalid
}

function markdownFallback(raw: string): SummaryJSON {
  // Parse Markdown output (như SummaryContent.vue hiện tại) → SummaryJSON
  // Dùng khi LLM trả Markdown thay vì JSON
}
```

Sửa `summarizeTopic()`:
```typescript
const response = await provider.summarize(posts, systemPrompt);
const json = parseSummaryJSON(response.content);
// Return JSON string nếu parse thành công, hoặc raw markdown nếu không
return json ? JSON.stringify(json) : response.content;
```

Sửa `summaryChunks()`:
- Map phase: parse JSON từ mỗi chunk → giữ structured data
- Reduce phase: truyền mảng JSON chunks cho reduce prompt (thay vì `--- Phần N ---` text)

#### Step 4: Background (`entrypoints/background/index.ts`)

`processLLMTask()`: không cần thay đổi lớn — summarizer trả string, background forward nguyên.

`SAVE_CACHED_TOPIC`: thêm merge logic cho `summaryJson` field.

#### Step 5: SummaryContent.vue (render)

Rewrite để accept cả hai format:

```typescript
const props = defineProps<{
  content: string;
  json?: SummaryJSON;     // Nếu có → render trực tiếp
}>();
```

- Nếu `json` prop: render trực tiếp từ structured data
  - `summary` → MarkdownContent
  - `opinions[]` → AccordionItem, mỗi item có:
    - Title + supporter count badge
    - Description (MarkdownContent)
    - **Quotes section** (MỚI): blockquote style, mỗi quote có author + `#postNumber` link
    - Supporter bar (giữ nguyên)
  - `conclusion` → MarkdownContent
- Nếu không có `json`: fallback regex parse (backward compat cho cache cũ)

#### Step 6: SummaryView.vue

- `confirmSummarize()`: parse LLM result → `SummaryJSON` nếu valid
- Save cả `summary` (raw string) và `summaryJson` (parsed) vào cache
- Pass `summaryJson` prop xuống `SummaryContent`

#### Step 7: Backward Compatibility

- Cache cũ chỉ có `summary: string` → `SummaryContent` fallback regex parse
- `summaryJson` = optional field, không break existing cache entries
- `INCREMENTAL_UPDATE_PROMPT`: giữ Markdown (cho đến phase sau) — chỉ full summarize dùng JSON

### Edge Cases

- **LLM trả Markdown thay JSON:** `parseSummaryJSON()` return null → dùng `markdownFallback()` → vẫn render OK
- **JSON có quote sai postNumber:** UI hiện `#N` — nếu N không tồn tại, vô hại (không link đến bài)
- **Quotes rỗng:** Nếu LLM không trả quotes → render opinion không có blockquote, vẫn OK
- **Custom prompts:** User custom prompt có thể override JSON format → fallback parse
- **Map-reduce recursive reduce:** Intermediate JSON cần stable format — validate ở mỗi reduce step
- **Segment mode:** Mỗi segment summary cũng dùng JSON → `TopicSegment.summary` giữ raw string, thêm `TopicSegment.summaryJson?`

### Test Plan

- [ ] Topic nhỏ (<context): single-pass → JSON output → render đúng
- [ ] Topic lớn (>context): map-reduce → JSON merge → render đúng
- [ ] LLM trả Markdown (fallback): render vẫn OK
- [ ] Cache cũ (Markdown only): mở lại → render bằng regex fallback
- [ ] Quotes hiển thị đúng: author, #postNumber, nội dung
- [ ] Quan điểm có supporter bar + count đúng
- [ ] Dark mode: quotes blockquote style đúng màu
- [ ] Custom prompt: vẫn hoạt động (fallback nếu output không phải JSON)

### Rollback Plan

- Xóa `summaryJson` field usage → revert SummaryContent.vue về regex parse
- Revert prompts → Markdown format
- Cache entries với `summaryJson` vẫn có `summary` string → không mất data

---

## Decision Log

### Quyết định 1: Thêm `summaryJson` field thay vì đổi `summary` type
- **Đã chọn:** Thêm `summaryJson?: SummaryJSON` mới, giữ `summary: string` nguyên
- **Lý do:** Backward compatible với cache cũ; incremental migration; rollback dễ
- **Đã cân nhắc nhưng loại:**
  - `summary: string | SummaryJSON` — union type phức tạp, mọi consumer phải type-check
  - Xóa `summary`, chỉ dùng `summaryJson` — break cache cũ, cần migration
- **Điều kiện thay đổi:** Khi 100% cache entries đã có `summaryJson`, có thể deprecate `summary`

### Quyết định 2: Persist posts ngay sau scrape (Feature 16)
- **Đã chọn:** `SAVE_CACHED_TOPIC` ngay sau scrape, trước user confirm
- **Lý do:** Idempotent (SAVE handler merge), không break existing flow, giải quyết root cause re-scrape
- **Đã cân nhắc nhưng loại:**
  - Lưu vào storage riêng (scraped-posts store) — thêm complexity, phải cleanup
  - Lưu vào localStorage — size limit 5MB
- **Điều kiện thay đổi:** Nếu posts quá lớn gây IndexedDB quota issues

### Quyết định 3: JSON output có fallback Markdown
- **Đã chọn:** `parseSummaryJSON()` + `markdownFallback()` dual-path
- **Lý do:** LLM không 100% reliable output JSON; custom prompts có thể override format; cache cũ là Markdown
- **Đã cân nhắc nhưng loại:**
  - Chỉ JSON, không fallback — brittle, custom prompts break
  - Post-process Markdown thành JSON bằng code (không dùng LLM) — khó parse robust
- **Điều kiện thay đổi:** Khi sử dụng model có structured output API (Gemini JSON mode, OpenAI function calling)

### Quyết định 4: Quotes lấy từ LLM trích dẫn, không match bằng code
- **Đã chọn:** Yêu cầu LLM trích dẫn nguyên văn kèm postNumber trong JSON output
- **Lý do:** LLM đã đọc toàn bộ posts → biết context để chọn quote tiêu biểu; code match chỉ làm keyword search
- **Đã cân nhắc nhưng loại:**
  - Code-based quote matching (TF-IDF/fuzzy search) — thêm dependency, không hiểu ngữ cảnh
  - User chọn quote thủ công — UX phức tạp
- **Điều kiện thay đổi:** Nếu LLM hallucinate quotes quá nhiều → cần verify bằng code
