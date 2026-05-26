# Feature 30 — Knowledge Extraction: Resume on Chunk Failure

## Overview

Khi trích xuất kiến thức multi-chunk và một chunk bị lỗi `INCOMPLETE_RESPONSE` (max_tokens), hiện tại toàn bộ flow abort và user mất progress. Feature này cho phép:

1. **Salvage partial entries** từ truncated JSON của chunk bị lỗi (best effort)
2. **Continue** sang các chunk tiếp theo thay vì abort toàn bộ flow
3. **Mark chunk failed** trong cache — resume lần sau skip qua chunk đó
4. **Reduce phase chạy bình thường** với data từ tất cả chunk (kể cả partial)
5. **Hiển thị warning** sau khi hoàn thành: bao nhiêu chunk bị truncate

## Goals

- Không mất data từ chunk đã extract thành công khi 1 chunk thất bại
- Flow hoàn tất (có thể với partial data) thay vì abort giữa chừng
- Resume lần sau (khi user tăng max_tokens) chỉ retry chunk bị fail, không re-extract chunk đã xong
- Không thay đổi behavior với các loại lỗi khác (network, auth, rate limit) — vẫn abort như cũ

## Root Cause Analysis

```
Adapter (claude/openai): stop_reason === 'max_tokens'
  → throw LLMError(INCOMPLETE_RESPONSE)   ← partial text bị DROP ở đây

background/index.ts catch:
  → sendMessage LLM_RESULT { error: err.message }  ← không có partial text

useKnowledge.ts:
  → await result  throws
  → catch(err): error.value = err.message  ← toàn bộ flow abort
  → persistChunks KHÔNG được gọi cho chunk này
```

Chunk N bị lỗi → `knowledgeChunks` trong cache chỉ có chunks 0..N-1. Resume sau đó bắt đầu lại từ `startPostNumber` của chunk N — nhưng cùng setting → fail lại.

## Requirements

### A. Carry partial text through LLMError

Thêm `partialText?: string` vào `LLMError`:

```typescript
// lib/errors.ts
export class LLMError extends Error {
  constructor(
    public readonly code: LLMErrorCode,
    message?: string,
    public readonly status?: number,
    public readonly partialText?: string,   // NEW: text trước khi bị cắt
  ) { ... }
}
```

Cập nhật adapters:

```typescript
// openai-adapter.ts
if (finishReason === 'length') {
  throw new LLMError(
    LLMErrorCode.INCOMPLETE_RESPONSE,
    undefined,
    undefined,
    content,   // pass partial text
  );
}

// claude-adapter.ts
if (stopReason === 'max_tokens') {
  throw new LLMError(
    LLMErrorCode.INCOMPLETE_RESPONSE,
    undefined,
    undefined,
    content,   // pass partial text
  );
}

// gemini-adapter.ts — tương tự khi finishReason === 'MAX_TOKENS'
```

### B. Background: salvage partial entries

Trong `background/index.ts`, case `extract_knowledge_chunk`:

```typescript
case 'extract_knowledge_chunk': {
  try {
    const raw = await extractKnowledgeChunk(...);
    result = { entries: parseKnowledgeEntries(raw), truncated: false };
  } catch (err) {
    if (err instanceof LLMError && err.code === LLMErrorCode.INCOMPLETE_RESPONSE && err.partialText) {
      // Attempt salvage: parse what we have
      let salvaged: KnowledgeEntry[] = [];
      try { salvaged = parseKnowledgeEntries(err.partialText); } catch { /* empty */ }
      result = { entries: salvaged, truncated: true };
      // Don't rethrow — treat as partial success
    } else {
      throw; // re-throw all other errors
    }
  }
  break;
}
```

`parseKnowledgeEntries` đã xử lý truncated JSON khá tốt (flat array, filter từng entry) — nếu JSON bị cắt giữa một entry thì entry đó bị drop, các entry trước đó vẫn parse được.

### C. Thêm `failed` flag vào KnowledgeChunk

```typescript
// lib/types.ts
export interface KnowledgeChunk {
  index: number;
  startPostNumber: number;
  endPostNumber: number;
  entries: KnowledgeEntry[];
  extractedAt: number;
  complete?: boolean;
  failed?: boolean;       // NEW: true = chunk bị truncate/lỗi, entries là partial
}
```

### D. useKnowledge: continue-on-truncation

Trong vòng lặp chunk của `handleExtract()`:

```typescript
const llmResult = await result;
if (knowledgeGuard.isStale(guardId)) return;
pl.markDone(segId);   // mark done ngay cả khi truncated

const wasTruncated = !!(llmResult as { truncated?: boolean }).truncated;
const chunkEntries = enrichEntries(
  ((llmResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [],
);

const chunkRecord: KnowledgeChunk = {
  index: newChunks.length,
  startPostNumber: chunkPosts[0].postNumber,
  endPostNumber: chunkPosts[chunkPosts.length - 1].postNumber,
  entries: chunkEntries,
  extractedAt: Date.now(),
  complete: isLastChunk ? (chunkTokens >= budget * 0.8) : true,
  failed: wasTruncated || undefined,   // NEW
};
newChunks.push(chunkRecord);
await persistChunks(newChunks, guardId, topicUrl);

if (wasTruncated) {
  truncatedChunkCount++;   // track for final warning
  pl.markFailed(segId);   // optional: UI step màu vàng thay vì xanh
  // Continue to next chunk — don't abort
}
```

Lỗi KHÔNG phải `INCOMPLETE_RESPONSE` (network, auth, v.v.) vẫn throw như cũ → abort → `catch(err)` → `error.value`.

### E. computeKnowledgeResumeState: skip failed chunks

```typescript
function computeKnowledgeResumeState() {
  const chunks = cachedTopic.value?.knowledgeChunks ?? [];
  if (chunks.length === 0) return { startFromPostNumber: 0, existingChunks: [] };

  // Tìm chunk đầu tiên bị failed để biết "bắt đầu resume từ đâu"
  const firstFailedIdx = chunks.findIndex(c => c.failed);

  if (firstFailedIdx === -1) {
    // Không có failed chunk — resume bình thường (bài mới)
    const lastChunk = chunks[chunks.length - 1];
    if (!lastChunk.complete) {
      return { startFromPostNumber: lastChunk.startPostNumber, existingChunks: chunks.slice(0, -1) };
    }
    return { startFromPostNumber: lastChunk.endPostNumber + 1, existingChunks: [...chunks] };
  }

  // Có failed chunk: resume từ startPostNumber của chunk bị fail đầu tiên,
  // giữ nguyên tất cả chunk trước đó (kể cả các failed chunk trước firstFailed nếu có)
  return {
    startFromPostNumber: chunks[firstFailedIdx].startPostNumber,
    existingChunks: chunks.slice(0, firstFailedIdx),  // drop failed + mọi thứ sau đó
  };
}
```

Khi resume: re-extract từ `startPostNumber` của chunk fail, với setting mới (user đã tăng max_tokens). Data các chunk trước giữ nguyên.

### F. PipelineStep: trạng thái 'warning'

Thêm status mới cho step bị truncate:

```typescript
// lib/types.ts
export type PipelineStepStatus = 'pending' | 'running' | 'done' | 'error' | 'warning';
```

`markFailed(stepId)` → status `'warning'` (vàng), không phải `'error'` (đỏ) — vì chunk vẫn có partial data, flow không dừng.

Trong `StepTimeline.vue`: icon ⚠ màu vàng cho status `'warning'`.

### G. UI Warning sau khi hoàn thành

Sau khi reduce phase xong, nếu `truncatedChunkCount > 0`:

```
⚠ X chunk bị cắt ngắn (max_tokens). Kết quả có thể thiếu một số entries.
  → Tăng "Max output tokens" trong Cài đặt rồi bấm "Trích xuất lại" để retry.
```

Warning này hiển thị inline dưới progress bar, persistent (không tự dismiss). Có nút "Trích xuất lại" → trigger `handleExtract()` lại (resume sẽ tự skip các chunk đã done, retry failed chunks).

Nút "Trích xuất lại" chỉ hiện khi có `knowledgeChunks` với `failed: true` trong cache.

## Technical Considerations

**Affected files:**
- `lib/errors.ts` — thêm `partialText?` vào `LLMError`
- `lib/llm/openai-adapter.ts` — pass content vào error
- `lib/llm/claude-adapter.ts` — pass content vào error
- `lib/llm/gemini-adapter.ts` — pass content vào error
- `lib/types.ts` — thêm `failed?` vào `KnowledgeChunk`, thêm `'warning'` vào `PipelineStepStatus`
- `entrypoints/background/index.ts` — salvage partial entries từ `INCOMPLETE_RESPONSE`
- `entrypoints/sidepanel/composables/useKnowledge.ts` — continue-on-truncation, update resume state
- `entrypoints/sidepanel/components/StepTimeline.vue` — render warning step
- `entrypoints/sidepanel/views/KnowledgeView.vue` — hiển thị warning + nút retry

**`parseKnowledgeEntries` với truncated JSON:**
JSON bị cắt giữa chừng có thể ở 3 dạng:
1. Cắt giữa một entry field → entry đó invalid, bị filter → partial entries OK
2. Cắt giữa array → `JSON.parse` fail → hiện `repairUnescapedQuotes` cũng fail → return `[]`
3. Cắt sau `]` của entry cuối nhưng trước `}` wrapper → parse fail với wrapped format

Case 2 và 3 khá phổ biến. Cần thêm một bước "partial array rescue" vào `parseKnowledgeEntries`:

```typescript
// Nếu JSON.parse fail hoàn toàn, thử cắt text tại `}` cuối cùng trong mảng
function tryRescuePartialArray(text: string): unknown[] {
  // Tìm `[` đầu tiên, sau đó scan backward từ cuối tìm `}` hợp lệ, thêm `]`
  const openBracket = text.indexOf('[');
  if (openBracket === -1) return [];
  for (let i = text.length - 1; i > openBracket; i--) {
    if (text[i] === '}') {
      try {
        return JSON.parse(text.slice(openBracket, i + 1) + ']') as unknown[];
      } catch { continue; }
    }
  }
  return [];
}
```

Thêm bước này vào cuối `parseKnowledgeEntries` khi các parse trước đó fail.

**Gemini adapter:** Gemini hiện xử lý MAX_TOKENS khác (throw string message, không phải LLMError trực tiếp). Cần kiểm tra lại và đồng nhất pattern.

**`pl.markFailed` vs `pl.markDone`:** Nếu không muốn thêm `markFailed` vào pipeline, có thể dùng `markDone` cho tất cả và chỉ track `truncatedChunkCount` local để hiển thị warning. Pipeline step vẫn hiện "done" (xanh). Đơn giản hơn.

## Test Plan

- Mock chunk N trả về truncated JSON (fake `INCOMPLETE_RESPONSE`) → verify chunk N+1 vẫn chạy
- Verify `knowledgeChunks` trong cache có `failed: true` cho chunk N sau khi flow xong
- Resume sau đó: verify chỉ chunk N trở đi được re-extract, chunk 0..N-1 giữ nguyên
- Với `partialText` có entries hợp lệ → verify salvaged entries xuất hiện trong kết quả
- Với `partialText` bị cắt hoàn toàn (empty array) → verify flow vẫn hoàn tất, không crash
- Test gemini adapter: `MAX_TOKENS` finish reason → partial text được carry through

## Decision Log

### Quyết định 1: Continue-on-truncation vs Abort-and-resume
- **Đã chọn:** Continue — save failed chunk và tiếp tục chunk tiếp theo
- **Lý do:** User nhận được kết quả đầy đủ hơn (chỉ thiếu entries từ chunk bị fail) thay vì phải restart hoàn toàn. Các chunk sau chunk bị fail vẫn extract được bình thường.
- **Đã cân nhắc nhưng loại:**
  - Abort toàn bộ khi có 1 chunk fail → loại vì mất data tất cả chunk sau
  - Retry chunk ngay lập tức với số bài ít hơn → loại vì phức tạp, cần split logic, và user chưa có cơ hội tăng max_tokens
- **Điều kiện thay đổi:** Nếu user feedback là partial results gây confusing → thêm option "strict mode" abort on any failure.

### Quyết định 2: Partial array rescue trong parseKnowledgeEntries
- **Đã chọn:** Thêm fallback rescue scan backward
- **Lý do:** Salvage entries từ truncated JSON tăng giá trị của feature này đáng kể. Implementation đơn giản, worst case return `[]` như cũ.
- **Điều kiện thay đổi:** Nếu rescue tạo ra entries corrupt → disable rescue, accept empty on parse fail.

### Quyết định 3: `warning` PipelineStepStatus vs giữ nguyên `done`
- **Đã chọn:** Giữ nguyên `done` cho step bị truncate, chỉ thêm warning banner sau khi hoàn thành
- **Lý do:** Đơn giản hơn, không cần sửa StepTimeline. Warning banner rõ ràng hơn một icon nhỏ trên step.
- **Điều kiện thay đổi:** Nếu cần thêm `warning` status cho use case khác → có thể thêm sau.

### Quyết định 4: Resume drop failed chunks vs keep và skip trong reduce
- **Đã chọn:** Resume drop failed + all after, re-extract từ `startPostNumber` của chunk fail đầu tiên
- **Lý do:** Đơn giản nhất. Các chunk sau failed chunk có thể đã extract với data chính xác — nhưng khi resume với max_tokens mới, toàn bộ từ điểm fail trở đi sẽ được chunk lại với budget tốt hơn. Không nên giữ chunks có boundary cũ sau khi re-chunk.
- **Điều kiện thay đổi:** Nếu topic rất dài và chỉ 1 chunk fail giữa chừng → thím có thể muốn giữ chunk sau. Để sau xem feedback.
