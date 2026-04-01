# Cơ chế Tóm tắt (Summarization)

> Cập nhật: 2026-04-01

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

### Segment mode

- Topic > `segmentSize` trang
- Chia thành segments (mỗi segment = `segmentSize` trang)
- Mỗi segment tóm tắt riêng → lưu `TopicSegment` vào cache
- Sau khi ≥2 segments xong → "Tóm tắt tổng quan" qua `summarize_segments` task
- `summarize_segments` dùng `REDUCE_SUMMARY_PROMPT` để gộp segment summaries (không phải raw posts)

**Segment index:** sequential, 0-based
- Pages 1-20 → index 0, pages 21-40 → index 1, ...
- `segmentSummaries[index]` lưu `TopicSegment | null` cho từng segment

### Incremental mode

- Topic đã tóm tắt trước đó + có bài mới
- Chỉ scrape từ `cachedTotalPages + 1` trở đi
- Gửi `[BẢN TÓM TẮT CŨ]` kèm bài mới cho LLM cập nhật

---

## Chunking strategy (`chunkPosts`)

```typescript
chunkPosts(posts, model, mapPrompt, suggestedChunks?)
```

- Nếu có `suggestedChunks`: chia đều tokens thành N buckets (không greedy fill)
- Buffer `RESPONSE_BUFFER_TOKENS` (= 2000) cho prompt overhead
- Clamp: mỗi chunk ≤ context limit - buffer

---

## Token estimation

- `estimateTokens(text)` — ước lượng token count (tiếng Việt: ~1.5 chars/token)
- `willExceedContext(posts, model)` — check + tính `chunksNeeded`
- `getContextLimit(model)` — context window per model
- Kết quả được hiển thị cho user trước khi confirm tóm tắt (token count + estimated cost)

---

## Custom prompts

User có thể thay thế 3 prompts qua Settings:
- `customPrompts.summary` → thay `SUMMARY_PROMPT`
- `customPrompts.opinions` → thay `OPINION_ANALYSIS_PROMPT`
- `customPrompts.research` → thay `RESEARCH_PROMPT`

**Lưu ý:** `CHUNK_SUMMARY_PROMPT` và `REDUCE_SUMMARY_PROMPT` KHÔNG cho user tùy chỉnh — chúng là phần nội bộ của pipeline map-reduce.

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
