# Bug Fix: Knowledge Dynamic Entry Cap

**Date:** 2026-04-17  
**Type:** Bug fix / improvement

## Problem

`KNOWLEDGE_REDUCE_PROMPT` hard-coded `Tối đa 20 entries` cho cả bước intermediate reduce lẫn final reduce. Với thread dài hàng trăm trang (ví dụ 234 trang = 27 chunks), kết quả luôn bị cắt về 20 entries — quá ít để đại diện cho lượng kiến thức thực sự trong thread.

## Root Cause

`KNOWLEDGE_REDUCE_PROMPT` là một string constant với cap cố định `20`, không có cơ chế scale theo kích thước thread.

## Fix

Đổi `KNOWLEDGE_REDUCE_PROMPT` từ string constant sang function `buildKnowledgeReducePrompt(cap: number)` và tính cap động:

```
finalCap = min(150, max(20, chunks.length × 3))
```

| Chunks | Cap trước | Cap sau |
|--------|-----------|---------|
| 1–6    | 20        | 20      |
| 10     | 20        | 30      |
| 27     | 20        | 81      |
| 50     | 20        | 150     |

Cap chỉ áp dụng cho **final reduce call** (bước gộp cuối cùng). Intermediate batch reduces giữ nguyên default (20 per group), vì 20 × groupCount entries là đủ material cho final reduce.

## Files Changed

- `lib/prompts.ts` — `KNOWLEDGE_REDUCE_PROMPT` → `buildKnowledgeReducePrompt(cap: number): string`
- `lib/llm/summarizer.ts` — `reduceKnowledgeChunks` thêm `entryCap?: number` param; dùng `buildKnowledgeReducePrompt(entryCap ?? 20)`
- `entrypoints/background/index.ts` — extract `entryCap` từ payload, truyền vào `reduceKnowledgeChunks`
- `entrypoints/sidepanel/composables/useLLM.ts` — `reduceKnowledgeChunksTask` thêm `entryCap?` param
- `entrypoints/sidepanel/views/KnowledgeView.vue` — tính `finalCap`, truyền vào final reduce call; cập nhật `promptOverhead` dùng `buildKnowledgeReducePrompt(finalCap)`

## Self-review Results

- Issues found: 0
- Issues fixed: 0
- Remaining: none

Type check: ✅ clean (`npx vue-tsc --noEmit`)
