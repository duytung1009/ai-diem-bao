# Cơ chế Tóm tắt (Summarization)

## Tổng quan

Extension hỗ trợ 4 loại xử lý LLM:

| Loại | Prompt chính | Map prompt | Reduce prompt |
|------|-------------|------------|---------------|
| Tóm tắt topic | `SUMMARY_PROMPT` | `CHUNK_SUMMARY_PROMPT` | `SUMMARY_PROMPT` |
| Cập nhật tóm tắt | `INCREMENTAL_UPDATE_PROMPT` | `CHUNK_SUMMARY_PROMPT` | `REDUCE_SUMMARY_PROMPT` |
| Phân tích ý kiến | `OPINION_ANALYSIS_PROMPT` | `OPINION_CHUNK_PROMPT` | `OPINION_ANALYSIS_PROMPT` |
| Tra cứu | `RESEARCH_PROMPT` | `CHUNK_SUMMARY_PROMPT` | `RESEARCH_PROMPT` |

Tất cả prompts nằm trong `lib/prompts.ts`.

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
- 300 từ/chunk (thay vì 200) → đủ chi tiết để reduce phase không mất thông tin

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

Reduce prompt nhận biết input format từ map phase ("mỗi phần có mục Nội dung chính, Quan điểm và tác giả, Điểm đáng chú ý") → hướng dẫn LLM cách gộp tác giả và đếm supporters.

### Recursive reduce

Nếu tổng partial summaries vẫn vượt context, pipeline tự chunk lại và reduce đệ quy:

```
Partial 1..N → chunkPosts() → Group A, B
                                 ↓ reduce
                              Sub-partial A, B
                                 ↓ reduce
                              Final Summary
```

---

## Các mode tóm tắt

### Normal mode
- Topic < `segmentSize` trang (mặc định 20)
- Scrape tất cả trang → gửi LLM (direct hoặc map-reduce)

### Segment mode
- Topic > `segmentSize` trang
- Chia thành segments (mỗi segment = `segmentSize` trang)
- Mỗi segment tóm tắt riêng → lưu `TopicSegment` vào cache
- Sau khi ≥2 segments xong → "Tóm tắt tổng quan" gộp các segment summaries

### Incremental mode
- Topic đã tóm tắt trước đó + có bài mới
- Chỉ scrape trang mới → gửi kèm `[BẢN TÓM TẮT CŨ]` cho LLM cập nhật

---

## Chunking strategy (`chunkPosts`)

```typescript
chunkPosts(posts, model, mapPrompt, suggestedChunks?)
```

- Nếu có `suggestedChunks`: chia đều tokens thành N buckets (không greedy fill)
- Buffer 2000 tokens cho prompt overhead
- Clamp: mỗi chunk ≤ context limit - buffer (không bao giờ vượt)

---

## Token estimation

- `estimateTokens(text)` — ước lượng token count (tiếng Việt: ~1.5 chars/token)
- `willExceedContext(posts, model)` — check + tính `chunksNeeded`
- `getContextLimit(model)` — context window per model

---

## Custom prompts

User có thể thay thế 3 prompts qua Settings:
- `customPrompts.summary` → thay `SUMMARY_PROMPT`
- `customPrompts.opinions` → thay `OPINION_ANALYSIS_PROMPT`
- `customPrompts.research` → thay `RESEARCH_PROMPT`

**Lưu ý:** `CHUNK_SUMMARY_PROMPT` và `REDUCE_SUMMARY_PROMPT` KHÔNG cho user tùy chỉnh — chúng là phần nội bộ của pipeline map-reduce.
