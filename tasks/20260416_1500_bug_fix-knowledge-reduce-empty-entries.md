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

## Follow-up Fix: Token Estimation Underestimation

**Problem (discovered after testing with 27-chunk topic on Qwen3.5 16384):**

Tree-reduce split 27 chunks into 2 groups, but group 1 still overflowed: `{prompt_tokens: 16156}` out of 16384 — leaving only 228 tokens for output.

**Root cause:** `estimateTokens` uses `text.length / 3.5` which underestimates Vietnamese/JSON by **~1.35–1.40×** (measured from actual LLM usage stats):
- Sample 1: 42223 chars → estimated 12064, actual 16156 → ratio 1.339
- Sample 2: 30859 chars → estimated 8817, actual 12036 → ratio 1.365

With 27 chunks totaling ~70000 chars, `estimateTokens` returned ~20000 tokens. At `usableTokens ≈ 10012`, `groupCount = ceil(20000/10012) = 2` — just barely, sitting right on the boundary. Groups of 14 chunks → actual ~16156 tokens → overflow.

**Fix:** Apply `× 1.4` correction factor to `totalTokens` before budget check:
```ts
const totalTokens = estimateTokens(JSON.stringify(allPartial)) * 1.4;
```

Corrected estimate = 28000 → `groupCount = ceil(28000/10012) = 3` → groups of 9 chunks → actual ~9500 tokens per group → ~6800 tokens remaining for output.

## Self-review Results

- Issues found: 3
- Issues fixed: 3
- Remaining: none

## Files Changed

- `entrypoints/sidepanel/views/KnowledgeView.vue` — `runReducePhase`, thêm imports (`getContextLimit`, `KNOWLEDGE_REDUCE_PROMPT`, `CONTEXT_USAGE_RATIO`, `RESPONSE_BUFFER_TOKENS`, `MAP_REDUCE_CHUNK_DELAY_MS`)
