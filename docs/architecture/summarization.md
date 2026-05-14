# Cơ chế Tóm tắt (Summarization)

> Cập nhật: 2026-04-10

## Tổng quan

Extension hỗ trợ 6 loại xử lý LLM:

| Task type | Hàm gọi | Prompt chính | Map prompt | Reduce prompt |
|-----------|---------|-------------|------------|---------------|
| `summarize` | `summarizeTopic()` | `SUMMARY_PROMPT` | `CHUNK_SUMMARY_PROMPT` | `SUMMARY_PROMPT` |
| `summarize_incremental` | `updateSummary()` | `INCREMENTAL_UPDATE_PROMPT` | `CHUNK_SUMMARY_PROMPT` | `REDUCE_SUMMARY_PROMPT` |
| `analyze_opinions` | `analyzeOpinions()` | `OPINION_ANALYSIS_PROMPT` | `OPINION_CHUNK_PROMPT` | `OPINION_ANALYSIS_PROMPT` |
| `research` | `researchTopic()` | `RESEARCH_PROMPT` | `CHUNK_SUMMARY_PROMPT` | `RESEARCH_PROMPT` |
| `extract_knowledge` | `extractKnowledge()` | `KNOWLEDGE_EXTRACT_PROMPT` | — | — |
| `summarize_segments` | `summarizeSegments()` | `REDUCE_SUMMARY_PROMPT` | — | — |

Tất cả prompts nằm trong `lib/prompts.ts`.

---

## Fire-and-Forget LLM Pattern

Tất cả LLM calls đều theo pattern **fire-and-forget** để tránh message channel timeout:

```
Sidepanel                    Background (service worker)
    │                               │
    │  START_LLM_TASK {taskId}      │
    │ ────────────────────────────→ │
    │  {started: true}              │ ← responds immediately
    │ ←──────────────────────────── │
    │                               │ ← processLLMTask() chạy async
    │                               │   keepalive: setInterval(20s ping)
    │  LLM_PROGRESS {taskId, ...}   │
    │ ←──────────────────────────── │ ← sau mỗi map step
    │  LLM_PROGRESS ...             │
    │ ←──────────────────────────── │
    │  LLM_RESULT {taskId, data}    │
    │ ←──────────────────────────── │ ← khi xong (hoặc lỗi)
```

**Tại sao cần pattern này:**
- Chrome message channel timeout ~5 phút
- LLM call lớn (map-reduce) có thể mất 10–30 phút
- `START_LLM_TASK` trả về ngay → giải phóng channel
- Background dùng `setInterval` ping mỗi 20s để tránh service worker bị terminate

### Keepalive

```typescript
const keepalive = setInterval(() => {
  void browser.storage.sync.get(''); // no-op ping
}, KEEPALIVE_INTERVAL_MS); // = 20_000ms

processLLMTask(taskId, taskType, payload)
  .finally(() => clearInterval(keepalive));
```

---

## `useLLM` Composable

Module-level singleton (không re-create giữa các component mount):

```
useLLM()
  ├── activeTasks: Map<taskId, LLMTaskState>
  ├── startTask(taskType, payload, onComplete?) → taskId
  ├── createTask(taskType, payload) → { taskId, result: Promise<LLMResultMessage> }
  ├── summarize(posts) → createTask('summarize', posts)
  ├── summarizeIncremental(prev, newPosts) → createTask(...)
  ├── summarizeSegmentsTask(summaries) → createTask('summarize_segments', ...)
  ├── analyzeOpinions(posts) → createTask(...)
  ├── researchTopic(posts, question) → createTask(...)
  └── extractKnowledge(posts, title) → createTask(...)
```

**`LLMTaskState` per task:**
```typescript
{
  taskId, taskType,
  status: 'running' | 'done' | 'error',
  progress: { step, totalSteps, message } | null,
  elapsedMs, estimatedTotalMs,  // cho ETA display
  result, error, stats,
  onComplete?: (result: LLMResultMessage) => void,
}
```

**Listener đăng ký 1 lần duy nhất** (module-level `listenerRegistered` flag):
```typescript
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'LLM_PROGRESS') handleProgress(message.payload);
  if (message.type === 'LLM_RESULT') handleResult(message.payload);
});
```

### ETA estimation

`useLLM` tự ước lượng thời gian hoàn thành dựa trên:
1. **Model speed stats** — lưu trong `storage.sync` sau mỗi lần LLM xong, key = model name
2. **Token estimate** — `estimateTokens(text)` trên payload
3. **Fallback** — `tokens × FALLBACK_MS_PER_TOKEN` nếu chưa có stats

---

## `useSummarize` Composable

Tách từ SummaryView.vue, chứa toàn bộ logic scraping + LLM orchestration:

**State refs:**
| Ref | Kiểu | Mục đích |
|-----|------|----------|
| `summary` | `string` | Nội dung tóm tắt hiện tại |
| `summaryJson` | `SummaryJSON \| null` | Parsed JSON từ summary (Feature 15) |
| `error` | `string` | Lỗi hiển thị trên UI |
| `isScraping` | `boolean` | Đang scrape (show cancel button) |
| `scrapeProgress` | `{cur, total, cnt} \| null` | Progress cho ProgressIndicator |
| `simpleLoadingText` | `string` | Text loading đơn giản (không có progress) |
| `llmTaskId` | `string \| null` | ID task LLM đang chạy (null = không chạy) |
| `pendingPosts` | `ScrapedPost[] \| null` | Posts chờ confirm trước khi gửi LLM |
| `segmentSummaries` | `TopicSegment[]` | Mảng segment theo index |
| `activeSegmentIndex` | `number \| null` | Segment đang xem |
| `cacheFreshness` | `CacheFreshness \| null` | Độ tươi của cache |

**Non-reactive:**
| Biến | Mục đích |
|------|----------|
| `scrapeAbortCtrl` | `AbortController` để cancel scraping |
| `activeSummarizeId` | Stale guard counter (xem bên dưới) |

---

## Stale Guard Pattern

Khi user navigate giữa topics trong lúc LLM đang chạy:

```typescript
const thisId = ++activeSummarizeId; // tăng mỗi lần start
store.setSummarizing(topic.url);

// ... await LLM ...

if (thisId !== activeSummarizeId) {
  // User đã navigate away → chỉ save cache, không update UI
  await saveTopic(...).catch(() => {});
  return;
}

// An toàn → update UI
summary.value = summaryText;
```

`++activeSummarizeId` trong `handleCancel` và đầu `loadTopicData` sẽ invalidate mọi LLM callback cũ.

---

## Pipeline Map-Reduce

Khi topic quá lớn để gửi một lần cho LLM (vượt context limit), pipeline tự động chuyển sang map-reduce:

```
Posts[] → chunkPosts() → Chunk 1, 2, ..., N
                            ↓ map (CHUNK_SUMMARY_PROMPT)
                         Partial 1, 2, ..., N
                            ↓ reduce (REDUCE_SUMMARY_PROMPT / SUMMARY_PROMPT)
                         Final Summary
```

### Map phase (`CHUNK_SUMMARY_PROMPT`)

Mỗi chunk được tóm tắt theo cấu trúc cố định:

```markdown
### Nội dung chính
Tóm tắt sự kiện, thông tin, câu hỏi chính (2-4 câu).

### Quan điểm và tác giả
- **Quan điểm A**: Mô tả. Tác giả: Tên1, Tên2.
- **Quan điểm B**: Mô tả. Tác giả: Tên3.

### Điểm đáng chú ý
Thông tin bổ sung (nếu có).
```

**Nguyên tắc thiết kế:**
- Cấu trúc cố định (không free-form) → output đồng nhất giữa các chunks
- BẮT BUỘC giữ tên tác giả → reduce phase có đủ data để đếm `(N người ủng hộ)`
- 300 từ/chunk → đủ chi tiết để reduce phase không mất thông tin

### Reduce phase (`REDUCE_SUMMARY_PROMPT`)

Gộp các partial summaries thành output cuối cùng theo format:

```markdown
## Tóm tắt
2-3 đoạn ngắn.

## Quan điểm nổi bật
### Tên quan điểm (N người ủng hộ)
Nội dung chi tiết.

## Kết luận
Đồng thuận hoặc bất đồng chính.
```

### Recursive reduce

Nếu tổng partial summaries vẫn vượt context, pipeline tự chunk lại và reduce đệ quy:

```
Partial 1..N → chunkPosts() → Group A, B
                                 ↓ reduce
                              Sub-partial A, B
                                 ↓ reduce
                              Final Summary
```

Progress callback thông báo từng step: "Tóm tắt phần 1/5...", "Gộp kết quả..."

---

## Các mode tóm tắt

### Normal mode

- Topic ≤ `segmentSize` trang (mặc định 20, configurable)
- Scrape tất cả trang → gửi LLM (direct hoặc map-reduce tự động)

### Segment mode (fixed)

- Topic > `segmentSize` trang (mặc định 20, configurable trong Settings)
- Chia thành segments (mỗi segment = `segmentSize` trang)
- Mỗi segment tóm tắt riêng → lưu `TopicSegment` vào cache
- Sau khi ≥2 segments xong → "Tóm tắt tổng quan" qua `summarize_segments` task
- `summarize_segments` dùng tree-reduce (`reduceSegmentSummaries`) với `REDUCE_SUMMARY_PROMPT` — tự động thêm levels nếu segments quá nhiều (xem section "Tóm tắt tổng quan")
- Chỉ hoạt động khi `config.dynamicSegments = false`

**Segment index:** sequential, 0-based
- Pages 1-20 → index 0, pages 21-40 → index 1, ...
- `segmentSummaries[index]` lưu `TopicSegment | null` cho từng segment

### Dynamic segment mode (Feature 23)

Khi `config.dynamicSegments = true` (mặc định), segment boundaries được tính theo **token budget** thay vì fixed page count:

**Budget tính toán:**
```
budget = floor(contextLimit × CONTEXT_USAGE_RATIO) - systemPromptTokens - RESPONSE_BUFFER_TOKENS
```

- `CONTEXT_USAGE_RATIO` = 0.75 (dùng 75% context window)
- `RESPONSE_BUFFER_TOKENS` = 2000
- `systemPromptTokens` = `estimateTokens(customPrompt || SUMMARY_PROMPT)` — dùng actual prompt text
- `contextLimit` = `getContextLimit(model, config.contextWindow)` — hỗ trợ override

**Luồng `autoSummarizeDynamic()`:**
```
Scrape page 1 → tích lũy tokens → ...page N
  ├── tokens > budget → cắt segment, gửi LLM tóm tắt
  │     ├── save segment (complete: true) vào IDB
  │     └── tiếp tục scrape pages tiếp
  ├── hết pages, tokens > 0 → segment cuối
  │     └── save segment (complete: false nếu topic đang mở)
  └── Sau khi xong → "Tóm tắt tổng quan" nếu ≥2 segments (tree-reduce)
```

**Resume state (`computeResumeState()`):**
- Nếu có segments đã xong trong `segmentSummaries`:
  - Last segment `complete: false` → resume từ `startPage` của nó, giữ posts đã scrape
  - Last segment `complete: true` → resume từ `endPage + 1`
- Re-run "Tóm tắt toàn bộ" **không reset** segments đã hoàn thành

**Segment states (UI):**
| Trạng thái | Dot color | Ý nghĩa |
|------------|-----------|----------|
| Có summary + complete | Xanh (green) | Hoàn tất |
| Có summary + incomplete | Vàng cam (amber) | Có thể có bài mới |
| Đã scrape, chưa summarize | Vàng (yellow) | Chờ LLM |
| Chưa scrape | Xám | Chưa xử lý |

**`handleSegmentUpdate()` (khi topic có thêm pages):**
- Dynamic mode: gọi `computeResumeState()` → `autoSummarizeDynamic(resume)`
- Fixed mode: giữ logic cũ (so sánh `endPage`)

### Incremental mode

- Topic đã tóm tắt trước đó + có bài mới
- Chỉ scrape từ `cachedTotalPages + 1` trở đi
- Gửi `[BẢN TÓM TẮT CŨ]` kèm bài mới cho LLM cập nhật

---

## LLM Output Parsing (`parseSummaryJSON`)

LLM không đảm bảo trả về JSON hợp lệ 100%. `parseSummaryJSON` dùng multi-layer strategy để tối đa khả năng parse thành công:

```
raw LLM output
  │
  ├─ Strip wrapping: ```json...``` hoặc `...` (single backtick)
  │
  ├─ Pre-processing (trước JSON.parse):
  │    ├─ NBSP (\u00A0) → space  ← tránh fail ở structural position
  │    └─ Invalid escape sequences (\N, \T, ...) → strip backslash
  │
  ├─ JSON.parse() — happy path
  │
  └─ Fallback: repairUnescapedQuotes() + JSON.parse()
       ├─ Escape raw newlines (\n → \\n, \r → \\r) inside string values
       ├─ Escape raw tabs (\t → \\t) inside string values
       └─ Escape unescaped " inside string values (heuristic: " closing
          only if followed by , } ] : or whitespace+EOF)
```

### Các lỗi LLM phổ biến đã được xử lý

| Lỗi | Ví dụ | Cách xử lý |
|-----|-------|------------|
| Code fence | ` ```json\n{...}\n``` ` | Strip fence trước khi parse |
| Single backtick | `` `{...}` `` | Strip backtick trước khi parse |
| NBSP structural | `{\u00A0"key":...}` | Replace NBSP → space (pre-process) |
| Invalid escape | `"text \N value"` | Strip backslash (pre-process) |
| Raw newline in string | `"para1\npara2"` (literal) | Escape → `\\n` (repair) |
| Raw tab in string | `"col1\tcol2"` (literal) | Escape → `\\t` (repair) |
| Unescaped inner quote | `"mục đích "cắm" tài sản"` | Escape → `\\"` (repair heuristic) |

**Validation:** sau parse, kiểm tra `summary` (string) + `opinions` (array) + `conclusion` (string). Thiếu bất kỳ field nào → trả `null`.

---

## Tóm tắt tổng quan (`summarizeSegments`)

Sau khi tất cả segments đã được tóm tắt riêng, `summarizeSegments()` gộp chúng thành một bản tóm tắt chung.

### Tree-reduce (`reduceSegmentSummaries`)

Thay vì 2-level cố định, hàm dùng **đệ quy tree-reduce** — số levels tự động điều chỉnh theo số segments và context limit:

```
N summaries → fit trong context? → LLM call (done)
            → vượt context?      → chia thành K nhóm
                                    mỗi nhóm → LLM call → intermediate
                                    [intermediate₁, ..., intermediateK]
                                    → gọi lại đệ quy
```

**Ví dụ với 16K context, ~500 tokens/segment summary, ~1500 tokens/intermediate (sau LLM reduce):**

> **Lưu ý:** Thực tế, usable content window ≈ 16K × 0.75 − 2.5K overhead ≈ 9.5K tokens. Số levels thực tế phụ thuộc vào intermediate size (LLM response); con số dưới đây dùng giá trị ước tính điển hình (~1500 tokens/intermediate).

| Segments | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
|----------|---------|---------|---------|---------|---------|
| ≤ 19 | direct (1 call) | — | — | — | — |
| 100 | 6 nhóm × ~17 → 6 intermediates (~9K) | direct | — | — | — |
| 1000 | 53 nhóm × ~19 → 53 inter. (~79.5K) | 9 nhóm × ~6 → 9 inter. (~13.5K) | 2 nhóm × ~5 → 2 inter. (~3K) | direct | — |
| 10000 | 527 nhóm → 527 inter. (~790K) | 84 nhóm → 84 inter. (~126K) | 14 nhóm → 14 inter. (~21K) | 3 nhóm → 3 inter. (~4.5K) | direct |

Tổng LLM calls ≈ O(N/k) (geometric series), không phải O(log N). Số levels ≈ O(log\u2096 N).

Với topic dài nhất thực tế (~1000 trang, ~50 segments), tree-reduce chỉ cần 1–2 levels.

### Cross-reference authors

Trước mỗi reduce call, `buildAuthorCrossReference()` tìm tác giả xuất hiện ở ≥2 segments và prepend vào combined content:

```
=== TÁC GIẢ XUẤT HIỆN Ở NHIỀU PHẦN ===
- UserA: Phần 1 ('Quan điểm X'), Phần 3 ('Quan điểm Y')
```

LLM sẽ biết đây là cùng một người → tránh đếm trùng supporter count.

**Lưu ý:** Cross-reference hoạt động local trong từng reduce call. Với tree-reduce nhiều levels, tác giả xuất hiện ở nhiều groups khác nhau có thể không được ghi nhận là cùng người cho đến level merge cuối cùng.

### Post-processing

Sau reduce, `deduplicateSupporters()` loại trùng tên supporter trong mỗi opinion (case-insensitive) làm safety net.

---

## Chunking strategy (`chunkPosts`)

```typescript
chunkPosts(posts, model, mapPrompt, suggestedChunks?, contextWindowOverride?)
```

- Nếu có `suggestedChunks`: chia đều tokens thành N buckets (không greedy fill)
- Buffer `RESPONSE_BUFFER_TOKENS` (= 2000) cho prompt overhead
- Clamp: mỗi chunk ≤ context limit - buffer
- `contextWindowOverride` được truyền từ `config.contextWindow` xuống `getContextLimit()`

---

## Token estimation

- `estimateTokens(text)` — ước lượng token count (mixed Vietnamese/English: ~3.5 chars/token)
- `willExceedContext(posts, model, systemPromptLength, responseBuffer, contextWindowOverride?)` — check + tính `chunksNeeded`
- `getContextLimit(model, contextWindowOverride?)` — context window per model
- `calculateSegmentBudget(model, systemPromptTokens, responseBuffer?, contextWindowOverride?)` — budget cho dynamic segment
- Kết quả được hiển thị cho user trước khi confirm tóm tắt (token count + estimated cost)

### Context window override

`LLMConfig.contextWindow` cho phép user override context limit cho model bất kỳ (đặc biệt LLM local/custom).

**Luồng ưu tiên trong `getContextLimit()`:**
1. `contextWindowOverride` (nếu > 0) → dùng giá trị user set
2. `PRICING_TABLE[model].contextLimit` → lookup theo tên model đã biết
3. Fallback `128000` → cho model không có trong bảng

**Ảnh hưởng:**
- Dynamic segment budget (`calculateSegmentBudget`) — quyết định bao nhiêu trang/segment
- Map-reduce chunking (`chunkPosts`, `willExceedContext`) — quyết định cần bao nhiêu chunks
- Recursive reduce check — khi combined partial summaries vượt context
- Knowledge extraction truncation — giới hạn số posts gửi cho LLM

**Cấu hình:** Settings tab → "Context window (tokens)" (input số, 0 hoặc trống = tự động)

---

## Custom prompts

User có thể thay thế 3 prompts qua Settings:
- `customPrompts.summary` → thay `SUMMARY_PROMPT`
- `customPrompts.opinions` → thay `OPINION_ANALYSIS_PROMPT`
- `customPrompts.research` → thay `RESEARCH_PROMPT`

**Lưu ý:** `CHUNK_SUMMARY_PROMPT` và `REDUCE_SUMMARY_PROMPT` KHÔNG cho user tùy chỉnh — chúng là phần nội bộ của pipeline map-reduce.

---

## Cấu hình LLM (`LLMConfig`)

| Field | Mặc định | Mô tả |
|-------|----------|-------|
| `provider` | `'openai'` | Provider: openai, custom, claude, gemini |
| `model` | `'gpt-4o-mini'` | Tên model |
| `temperature` | `0.3` | Nhiệt độ sampling |
| `maxTokens` | `4096` | Giới hạn output tokens (LLM trả về tối đa bao nhiêu token) |
| `contextWindow` | `undefined` | Override context window (tokens); `undefined`/`0` = tự động theo `PRICING_TABLE` hoặc 128K |
| `timeoutMs` | `120000` | Timeout cho mỗi LLM call |
| `scrapeDelayMs` | `2000` | Delay giữa các request scrape |
| `segmentSize` | `20` | Số trang/segment (chỉ dùng khi `dynamicSegments = false`) |
| `dynamicSegments` | `true` | Tự động chia segment theo token budget |

**`maxTokens` vs `contextWindow`:**
- `maxTokens` = giới hạn **output** (response length) → tăng nếu tóm tắt bị cắt ngắn
- `contextWindow` = giới hạn **input** (prompt + posts) → ảnh hưởng segment size, chunking, map-reduce decisions

---

## Flow tóm tắt đầy đủ (Normal mode)

```
handleSummarize(incremental)
  │
  ├── [scraping: xem scraping.md]
  │
  ├── enrichWithNewsArticles()  ← news detection (optional)
  │
  ├── saveTopic(posts)          ← Feature 16: lưu sớm tránh re-scrape
  │
  └── pendingPosts = posts → (chờ user confirm nếu token estimate cần)

confirmSummarize()
  │
  ├── thisId = ++activeSummarizeId
  ├── store.setSummarizing(topic.url)
  │
  ├── [incremental] summarizeIncremental(oldSummary, newPosts)
  │         └── createTask('summarize_incremental', ...)
  │               └── sendMessage('START_LLM_TASK', {taskId, ...})
  │                     → LLM_PROGRESS events → ProgressIndicator
  │                     → LLM_RESULT event → resolve Promise
  │
  ├── [normal] summarize(posts)
  │         └── createTask('summarize', posts)
  │
  ├── [stale guard] if (thisId !== activeSummarizeId) → save + return
  │
  ├── summary.value = summaryText
  ├── store.updateSelectedTopic(...)
  └── SAVE_CACHED_TOPIC
```

---

## Testing

Toàn bộ luồng summarization được test qua **11 E2E tests** + **18 unit tests**:

| Test file | Coverage |
|-----------|----------|
| `tests/e2e/summarize-single-segment.test.ts` | Topic nhỏ → 1 LLM call, không map-reduce |
| `tests/e2e/summarize-multi-segment.test.ts` | Topic lớn (500-1000 posts) → map-reduce, tree-reduce |
| `tests/e2e/update-summary-no-segments.test.ts` | Cập nhật từ summary cũ + ít posts mới → direct call |
| `tests/e2e/update-summary-with-segments.test.ts` | Cập nhật từ multi-segment + nhiều posts mới → có thể map-reduce |
| `tests/e2e/update-summary-segment-transition.test.ts` | Transition: direct → map-reduce khi posts mới vượt context |
| `tests/e2e/edge-cases.test.ts` | Abort signal, invalid JSON, empty posts, recursive reduce overflow |
| `tests/unit/summarizer-parse.test.ts` | parseSummaryJSON: fenced JSON, NBSP, unescaped quotes, raw newlines |
| `tests/unit/summarizer-dedup.test.ts` | deduplicateSupporters: case-insensitive, Vietnamese names |

Xem chi tiết tại [docs/testing/testing-overview.md](../testing/testing-overview.md).
