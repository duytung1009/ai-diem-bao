# Simplify: F26 Code Cleanup + Type Error Fixes

## Scope

Cleanup sau khi implement F26 (LLM cost guard + true cancel). Bao gồm: loại bỏ dead code, extract shared utility, sửa type errors ẩn trong F26.

## Self-review Results

- Issues found: 9
- Issues fixed: 9
- Remaining: none

## Changes (commit `b7bf166`)

### Code Reuse

**Extract `mergeAbortSignals` → `lib/llm/utils.ts`**
Hàm này bị copy-paste identically vào cả 3 adapter (`claude-adapter.ts`, `openai-adapter.ts`, `gemini-adapter.ts`). Extract ra file riêng, import lại từng adapter.

### Dead Code Removed

- `looksLikeTruncatedJson` trong `openai-adapter.ts` — defined nhưng không được gọi ở đâu (leftover từ fix-openai-truncated-json, superseded bởi `finishReason === 'length'` check)
- `estimateSummarizeSegmentCalls` trong `cost-estimator.ts` — exported nhưng không được import hay gọi ở đâu (Phase B stub chưa implement)

### Comments Cleaned Up

- Xóa "what" comment + F26 task-reference trên `activeLLMTasks` trong `background/index.ts`
- Xóa "for F26" tag trong JSDoc header của `cost-estimator.ts`

### Efficiency

- `estimatedExtractApiCalls` computed trong `KnowledgeView.vue`: gate bằng `!isLoading.value` — bỏ qua O(N) `planKnowledgeChunks` scan khi đang extract (warning không hiển thị lúc đó)

### Bug Fixes (phát hiện qua type-check)

- **`chunkPosts` function missing declaration** (`lib/llm/summarizer.ts`): JSDoc comment nuốt mất `*/` và `function chunkPosts(` — toàn bộ function params bị parse là plain text, `chunkPosts` không tồn tại
- **`updateSummary` thiếu `signal` param** (`lib/llm/summarizer.ts`): background gọi với 6 args nhưng signature chỉ có 5; thêm `signal?: AbortSignal` và wire qua cả hai call paths
- **Stray `}` trong `lib/types.ts`** line 259: thừa một `}` sau `ThreadAnalysisJSON` interface
- **`ThreadAnalysisJSON.overview.keyFacts: readonly string[]`** (`lib/types.ts`): `DeepReadonly<CachedTopic>` làm `string[]` thành `readonly string[]` nhưng type khai báo là `string[]` → type error ở `TopicHubView.vue`
- **Missing `threadAnalysis` cast trong `TopicHubView.vue`**: các field `posts`, `segments`, `summaryJson`... đã có cast `as X`, nhưng `threadAnalysis` từ `DeepReadonly<CachedTopic>` không được cast → type error; thêm `threadAnalysis: updated.threadAnalysis as ThreadAnalysisJSON | undefined` + import `ThreadAnalysisJSON`

## Files Changed

- `lib/llm/utils.ts` — mới tạo
- `lib/llm/claude-adapter.ts`, `gemini-adapter.ts`, `openai-adapter.ts` — import từ utils, bỏ local duplicate
- `lib/llm/cost-estimator.ts` — xóa dead export, sửa JSDoc
- `lib/llm/summarizer.ts` — fix `chunkPosts` declaration, add `signal` to `updateSummary`
- `lib/types.ts` — xóa stray `}`, sửa `keyFacts` type
- `entrypoints/background/index.ts` — xóa comment
- `entrypoints/sidepanel/views/KnowledgeView.vue` — gate `estimatedExtractApiCalls`
- `entrypoints/sidepanel/views/TopicHubView.vue` — add `threadAnalysis` cast + import
