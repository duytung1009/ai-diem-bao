# Cơ chế LLM Cost Estimation

> Cập nhật: 2026-04-29

## Tổng quan

Cost estimator ước lượng số lượng API calls và chi phí trước khi user chạy các tác vụ LLM tốn kém. Hiển thị warning dialog nếu vượt ngưỡng.

## `cost-estimator.ts`

### `estimateAutoSummarizeCalls()`

```typescript
estimateAutoSummarizeCalls(totalPages, budgetTokens, avgTokensPerPage = 3000): number
```

1. `pagesPerSegment = max(1, floor(budgetTokens / avgTokensPerPage))`
2. `segmentCount = ceil(totalPages / pagesPerSegment)`
3. `reduceCalls = segmentCount > 1 ? ceil(log2(segmentCount)) : 0`
4. `return segmentCount + reduceCalls`

Ví dụ: topic 100 trang, budget 12000 tokens → 5 segments + 3 reduce = 8 calls

### `estimateExtractCalls()`

```typescript
estimateExtractCalls(chunkCount: number): number
return chunkCount + (chunkCount > 1 ? 1 : 0)
```

### `estimateSummarizeSegmentCalls()`

```typescript
estimateSummarizeSegmentCalls(chunksNeeded: number): number
return chunksNeeded + (chunksNeeded > 1 ? 1 : 0)
```

## Cost Guard (F26)

### Trigger

Trước khi chạy auto-summarize hoặc knowledge extraction, `useSummarize` gọi cost estimator:

```typescript
const estimatedCalls = estimateAutoSummarizeCalls(totalPages, budget);
if (estimatedCalls > LLM_WARN_THRESHOLD_CALLS) { // default: 5
  showConfirmDialog(`Ước tính ~${estimatedCalls} calls LLM. Tiếp tục?`);
}
```

### Warning Dialog (`ConfirmInline.vue`)

Hiển thị inline confirmation (không modal overlay):
- Message: "Dự kiến ~N lượt gọi API..."
- Nút [Hủy] / [Tiếp tục]
- Budget details (tokens, cost ước tính)

## Pricing Table

Trong `token-estimator.ts`:

| Model | Context | Input/1K | Output/1K |
|---|---|---|---|
| gpt-4o-mini | 128K | $0.150 | $0.600 |
| gpt-4o | 128K | $2.500 | $10.00 |
| claude-sonnet-4 | 200K | $3.000 | $15.00 |
| claude-haiku-3.5 | 200K | $0.800 | $4.00 |
| gemini-2.5-flash | 1M | $0.150 | $0.600 |
| gemini-2.5-pro | 1M | $1.250 | $5.00 |

Cost = `(inputTokens * inputPrice + outputTokens * outputPrice) / 1000`

## ETA Estimation (`useLLM`)

Speed stats được lưu sau mỗi LLM call:

```typescript
interface ModelSpeedStats {
  model: string;
  tokensPerSecond: number;
  samples: number;
  lastUpdated: number;
}
```

- Lưu trong `storage.sync` key `model-speed-stats`
- `getETA(inputTokens, model)` → `inputTokens / tokensPerSecond * 1000`
- Fallback: `inputTokens * FALLBACK_MS_PER_TOKEN` (20ms/token)
