# Fix: Knowledge Extraction Timeout — Map-Reduce

## Objective & Scope

**Bug:** Nút "Trích xuất kiến thức" hiện loading ~21 phút ETA, sau đó loading biến mất và nút hiện lại (silent fail).

**Root cause:** `extractKnowledge()` gửi **tất cả posts trong 1 API call**. Mỗi adapter có hard timeout 120s (`config.timeoutMs ?? 120000`). Với topic lớn, LLM cần nhiều hơn 2 phút → request bị abort → error "Kết nối LLM quá thời gian" → KnowledgeView hiển thị error nhưng nút cũng hiện lại đồng thời.

**So sánh:** `summarizeTopic()` dùng map-reduce khi vượt context — chia nhỏ thành chunks, mỗi chunk 1 API call riêng → mỗi call ngắn → không timeout.

**Fix:** Áp dụng map-reduce pattern cho `extractKnowledge()`, tận dụng `chunkPosts()` đã có.

---

## Affected Modules

| File | Action |
|------|--------|
| `lib/prompts.ts` | **THÊM** — `KNOWLEDGE_CHUNK_PROMPT` (map) + `KNOWLEDGE_REDUCE_PROMPT` (reduce) |
| `lib/llm/summarizer.ts` | **SỬA** — `extractKnowledge()` thêm map-reduce path |
| `entrypoints/background/index.ts` | **SỬA** — `parseKnowledgeEntries()` handle merged array |

**KHÔNG thay đổi:** `KnowledgeView.vue`, `useLLM.ts`, `types.ts`, background task routing

---

## Implementation Steps

### Step 1: Thêm prompts cho map-reduce knowledge extraction

File: `lib/prompts.ts`

**KNOWLEDGE_CHUNK_PROMPT** (map phase — extract từ 1 chunk posts):
- Giống `KNOWLEDGE_EXTRACT_PROMPT` nhưng:
  - Bỏ giới hạn "tối đa 20 entries" (mỗi chunk trả ít hơn, tổng merge sau)
  - Thêm note: "Đây là một phần của topic, có thể có thêm bài viết ở phần khác"
  - Output: JSON array entries

**KNOWLEDGE_REDUCE_PROMPT** (reduce phase — merge partial entries):
- Input: nhiều JSON arrays entries từ các chunks
- Nhiệm vụ: Merge, dedup (kiến thức trùng hoặc tương tự), ưu tiên entry chi tiết hơn
- Giữ tối đa 20 entries cuối cùng
- Output: JSON array entries (cùng format)

### Step 2: Thêm map-reduce path vào `extractKnowledge()`

File: `lib/llm/summarizer.ts`

Hiện tại:
```typescript
export async function extractKnowledge(posts, title, config, onProgress, customPrompts) {
  // Truncate nếu vượt context → 1 API call
  const response = await provider.summarize([topicContextPost, ...postsToUse], systemPrompt);
  return response.content;
}
```

Sau khi sửa:
```typescript
export async function extractKnowledge(posts, title, config, onProgress, customPrompts) {
  const provider = createProvider(config);
  const systemPrompt = customPrompts?.knowledge || KNOWLEDGE_EXTRACT_PROMPT;

  const contextCheck = willExceedContext(posts, config.model, estimateTokens(systemPrompt));

  if (!contextCheck.exceeds) {
    // Direct — topic nhỏ, 1 call đủ
    onProgress?.('Đang trích xuất kiến thức...');
    const topicContextPost = { author: 'CONTEXT', content: `Topic: ${title}`, ... };
    const response = await provider.summarize([topicContextPost, ...posts], systemPrompt);
    return response.content;
  }

  // Map-reduce — topic lớn
  const mapPrompt = KNOWLEDGE_CHUNK_PROMPT;
  const chunks = chunkPosts(posts, config.model, mapPrompt, contextCheck.chunksNeeded);
  const total = chunks.length + 1; // +1 reduce

  // Map: extract entries từ mỗi chunk
  const partialResults: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Đang trích xuất phần ${i + 1}/${chunks.length}...`, i + 1, total);
    const topicContextPost = { author: 'CONTEXT', content: `Topic: ${title}`, ... };
    const response = await provider.summarize([topicContextPost, ...chunks[i]], mapPrompt);
    partialResults.push(response.content);
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 100));
  }

  // Reduce: merge entries
  onProgress?.('Đang gộp kiến thức...', chunks.length + 1, total);
  const combinedText = partialResults
    .map((r, i) => `--- Phần ${i + 1} ---\n${r}`)
    .join('\n\n');

  const reducePost = [{ author: 'PARTIAL_ENTRIES', content: combinedText, ... }];
  const reduceResponse = await provider.summarize(reducePost, KNOWLEDGE_REDUCE_PROMPT);
  return reduceResponse.content;
}
```

**Lưu ý:** `chunkPosts()` đã là private function trong `summarizer.ts` → truy cập trực tiếp, không cần export.

### Step 3: Update `parseKnowledgeEntries()` — defensive parsing

File: `entrypoints/background/index.ts`

Hiện tại đã handle JSON array tốt. Chỉ cần đảm bảo:
- Nếu reduce trả về nested array (ít khả năng) → flatten
- `.slice(0, 20)` đã có → giới hạn entries

Thêm flatten logic:
```typescript
let parsed = JSON.parse(text);
if (Array.isArray(parsed)) {
  // Flatten in case of nested arrays
  parsed = parsed.flat();
}
```

---

## Edge Cases

1. **Topic nhỏ (vừa 1 call):** Đi thẳng path direct, không map-reduce → hành vi giữ nguyên
2. **Chunks = 1:** `chunkPosts` trả 1 chunk → map phase 1 call + reduce phase 1 call. Reduce vẫn chạy để đảm bảo format nhất quán. Có thể optimize skip reduce nếu chỉ 1 chunk — nhưng không cần thiết vì 1 chunk đã fit context → `contextCheck.exceeds` sẽ = false → đi path direct.
3. **Reduce output vượt context:** Rất unlikely — knowledge entries rất compact so với raw posts. Không cần recursive reduce.
4. **LLM trả JSON không hợp lệ ở map phase:** Reduce phase nhận raw text, vẫn cố merge. Nếu reduce cũng fail → `parseKnowledgeEntries` trả `[]` → KnowledgeView hiện empty state.
5. **Custom prompt:** Nếu user có custom knowledge prompt → dùng cho direct path. Map phase dùng `KNOWLEDGE_CHUNK_PROMPT` built-in (custom prompt không áp dụng cho chunk vì format khác).

---

## Test Plan

1. **Topic nhỏ (<= context limit):** Trích xuất kiến thức → hoạt động bình thường, 1 call, không timeout
2. **Topic lớn (> context limit):** Trích xuất kiến thức → hiện progress "Đang trích xuất phần 1/N..." → "Đang gộp kiến thức..." → entries hiển thị
3. **Cancel giữa chừng:** ProgressIndicator không có nút Cancel cho knowledge → N/A (task chạy đến xong hoặc lỗi)
4. **Error handling:** Tắt mạng giữa map phase → error hiện trên ErrorDisplay
5. **Entries count:** Kết quả cuối cùng <= 20 entries
6. **Type check:** `npx vue-tsc --noEmit` pass
7. **Build:** `npm run build` pass

---

## Rollback Plan

Revert 2-3 file changes. `extractKnowledge()` quay về single-call path. Không ảnh hưởng các feature khác.

---

## Decision Log

### QD1: Map-reduce thay vì tăng timeout
- **Đã chọn:** Map-reduce pattern (giống `summarizeTopic`)
- **Lý do:** Fix triệt để — mỗi API call ngắn, fit trong timeout 120s. Topic bất kỳ kích thước đều hoạt động.
- **Đã cân nhắc nhưng loại:**
  - Tăng timeout lên 10-15 phút — workaround, vẫn fail với topic rất lớn, UX kém (user chờ rất lâu 1 call)
  - Streaming response — phức tạp hơn, adapters chưa support streaming
- **Điều kiện thay đổi:** Nếu LLM providers hỗ trợ streaming response natively

### QD2: 2 prompts riêng cho map/reduce thay vì reuse prompt hiện tại
- **Đã chọn:** `KNOWLEDGE_CHUNK_PROMPT` (map) + `KNOWLEDGE_REDUCE_PROMPT` (reduce)
- **Lý do:** Map prompt cần bỏ giới hạn 20 entries (mỗi chunk ít entries hơn); Reduce prompt cần instructions merge/dedup (khác hẳn extract từ raw posts)
- **Đã cân nhắc nhưng loại:**
  - Reuse `KNOWLEDGE_EXTRACT_PROMPT` cho cả map và reduce — reduce sẽ nhận JSON entries thay vì raw posts, cần instructions khác
- **Điều kiện thay đổi:** Nếu prompt quá dài gây tốn token → cân nhắc simplify

### QD3: Custom prompt chỉ áp dụng cho direct path
- **Đã chọn:** Custom knowledge prompt (`customPrompts?.knowledge`) chỉ dùng khi topic fit 1 call
- **Lý do:** Map-reduce cần format output cụ thể (JSON array) để reduce phase parse được. Custom prompt có thể yêu cầu format khác → break pipeline.
- **Điều kiện thay đổi:** Nếu user feedback cần custom prompt cho topic lớn → thêm `customPrompts?.knowledgeChunk` và `customPrompts?.knowledgeReduce`

---

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. Topic nhỏ → trích xuất kiến thức thành công (direct path)
3. Topic lớn (>= 100 bài) → trích xuất thành công với progress bar (map-reduce path)
4. Entries có đúng format: title, content, tags, source
5. Không quá 20 entries
6. Không timeout (mỗi API call < 120s)
