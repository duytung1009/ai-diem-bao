# Bug Fix: Knowledge Extraction Timeout — Map-Reduce

**Date:** 2026-04-10  
**Plan:** `planning/20260401_1123_fix-knowledge-extraction-timeout.md`

## What Was Fixed

`extractKnowledge()` gửi tất cả posts trong 1 API call → timeout 120s với topic lớn (silent fail, spinner biến mất, nút hiện lại).

**Fix:** Áp dụng map-reduce pattern (giống `summarizeTopic`):
- Topic nhỏ (fit context): 1 call trực tiếp — hành vi không đổi
- Topic lớn (vượt context): chunk → map phase (extract từng phần) → reduce phase (merge + dedup)

## Files Changed

| File | Change |
|------|--------|
| `lib/prompts.ts` | Thêm `KNOWLEDGE_CHUNK_PROMPT` (map) + `KNOWLEDGE_REDUCE_PROMPT` (reduce) |
| `lib/llm/summarizer.ts` | Rewrite `extractKnowledge()` — thêm map-reduce path; import 2 prompt mới |
| `entrypoints/background/index.ts` | `parseKnowledgeEntries()`: thêm `.flat()` để handle nested array |

## Self-review Results

- Issues found: 0
- Issues fixed: 0
- Remaining: none

## Verification

- `npx vue-tsc --noEmit` — pass
- `npm run build` — pass (398.64 kB)
