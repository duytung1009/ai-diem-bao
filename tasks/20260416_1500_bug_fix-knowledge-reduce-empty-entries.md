# Fix: Knowledge Reduce Returns Empty Entries (234-page Topic)

## Problem

Sau khi trích xuất kiến thức một topic 234 trang (27 chunks tích lũy qua nhiều lần chạy), kết quả không được hiển thị — tab vẫn hiện nút "Trích xuất kiến thức". Event `SAVE_CACHED_TOPIC` với `knowledgeChunks: 27 items` quan sát được, nhưng entries không xuất hiện.

## Root Cause

`runReducePhase` gửi toàn bộ 27 chunks × ~20 entries (~540 entries, ~50K tokens) trong **một lần gọi** `reduce_knowledge_chunks`. Với model context window nhỏ (local LLM, ≤32K tokens), input vượt ngưỡng → LLM trả về output bị cắt hoặc không parse được → `parseKnowledgeEntries` trả về `[]`.

Hậu quả:
1. `entries.value = []` được set — button hiện lại
2. `SAVE_CACHED_TOPIC` với `knowledgeEntries: []` **ghi đè dữ liệu cũ** (vì `[]` không phải `null`/`undefined`, operator `??` trong background không fallback về existing entries)
3. Không có error message — thất bại âm thầm

## Fix

**File: `entrypoints/sidepanel/views/KnowledgeView.vue`**

### 1. Tree-reduce cho reduce phase lớn

Trước khi gọi reduce, ước tính token của toàn bộ entries:
- `totalTokens = estimateTokens(JSON.stringify(allPartial))`
- Nếu `totalTokens > usableTokens` (budget = `contextLimit × 0.75 − promptOverhead`): chia `allPartial` thành nhóm, reduce từng nhóm độc lập, sau đó final reduce trên kết quả các nhóm
- Mỗi batch call có cancel guard + rate-limit delay

### 2. Guard empty result

Nếu `finalEntries.length === 0` sau reduce → throw error với message tiếng Việt thay vì silently set `entries.value = []` và overwrite IDB.

## Self-review Results

- Issues found: 2
- Issues fixed: 2
- Remaining: none

## Files Changed

- `entrypoints/sidepanel/views/KnowledgeView.vue` — `runReducePhase`, thêm imports (`getContextLimit`, `KNOWLEDGE_REDUCE_PROMPT`, `CONTEXT_USAGE_RATIO`, `RESPONSE_BUFFER_TOKENS`, `MAP_REDUCE_CHUNK_DELAY_MS`)
