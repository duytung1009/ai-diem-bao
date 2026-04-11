# Review: Feature 24 — Dynamic Chunks for Knowledge Extraction

[DRAFT_PENDING_OPUS]

### Metadata
- **Files reviewed:** `lib/types.ts`, `lib/llm/summarizer.ts`, `entrypoints/background/index.ts`, `entrypoints/sidepanel/composables/useLLM.ts`, `entrypoints/sidepanel/views/KnowledgeView.vue`, `entrypoints/sidepanel/views/TopicHubView.vue`
- **Review tier:** tier3
- **Model used:** sonnet (degraded mode — Opus rate limit)
- **Diff size:** ~550 LOC changed (KnowledgeView +375, summarizer +127, background +24, types +12, useLLM +12, TopicHubView +5)
- **Planning file:** `planning/20260410_2316_24-feature-dynamic-chunks-knowledge.md`
- **Decision Log đã đọc:** QD1–QD8 ✅

---

### Checklist
| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ⚠️ | Major bug: stale `cachedTopic.value` sau `persistChunks` → resume sai |
| Edge cases covered | ⚠️ | empty posts path OK; `planKnowledgeChunks` edge cases OK; missing: search/tag reset on fresh extract |
| Error handling | ✅ | cancel guard đúng; finally đúng; catch check thisId đúng |
| Performance concerns | ⚠️ | reduce call không guard combined entries size (deferred per planning — acceptable) |
| Security implications | N/A | |
| Consistency with patterns | ✅ | Đồng nhất với F23 pattern (activeExtractId, resumeState, persistChunks) |
| Type safety | ✅ | Type check pass; KnowledgeChunk interface đúng |
| Test coverage | N/A | |

---

### Issues Found

| # | Severity | Category | Description | Suggestion |
|---|----------|----------|-------------|------------|
| 1 | major | Logic | `cachedTopic.value.knowledgeChunks` không được update sau mỗi `persistChunks()` call. `computeKnowledgeResumeState()` đọc từ `cachedTopic.value` → trên cancel+resume, lần resume đọc chunks stale từ lúc `loadTopicData()`, không thấy chunks đã persist → re-extract từ đầu thay vì resume đúng vị trí. | Đầu `handleExtract()`, sau khi tạo `thisId`, fetch fresh data: `const fresh = await sendMessage<CachedTopic \| null>('GET_CACHED_TOPIC', url); if (fresh) cachedTopic.value = fresh;` — trước khi gọi `computeKnowledgeResumeState()`. Hoặc trong `persistChunks()`, update `cachedTopic.value = { ...cachedTopic.value!, knowledgeChunks: chunks }`. |
| 2 | minor | UX | `searchQuery` và `selectedTags` không được reset khi fresh extract (là lần đầu tiên, `resume.startFromPostNumber === 0` và `resume.existingChunks.length === 0`). Code cũ F22 reset chúng khi `lastPostNum < 0`. | Thêm: `if (resume.startFromPostNumber === 0 && resume.existingChunks.length === 0) { searchQuery.value = ''; selectedTags.value = []; }` ngay sau khi tạo `resume` trong `handleExtract()`. |
| 3 | minor | Logic | `runDirectExtract` tính budget bằng `KNOWLEDGE_CHUNK_PROMPT_TOKENS` (cho `calculateSegmentBudget`) nhưng gọi `runExtract(...)` → task `extract_knowledge` → dùng `KNOWLEDGE_EXTRACT_PROMPT`. Hai prompts có token count hơi khác. Budget check có thể không chính xác với prompt thực tế dùng. | Minor trong thực tế vì 2 prompts tương tự nhau (~5-10 token diff), nhưng về ngữ nghĩa: nên dùng `estimateTokens(KNOWLEDGE_EXTRACT_PROMPT)` khi check context cho direct path. [DECISION_NEEDED] có nên tách constant `KNOWLEDGE_EXTRACT_PROMPT_TOKENS` hoặc pass prompt vào `calculateSegmentBudget` thay vì hardcode? |
| 4 | minor | Completeness | `reduceKnowledgeChunks` không guard trường hợp `combinedText` (JSON.stringify của tất cả chunk entries) vượt context limit. Với 20+ chunks, có thể fail trên model 4K-8K. Planning document đã ghi nhận và defer. | Ghi nhận là known limitation. Nếu gặp thực tế → add recursive reduce. Không block release. |
| 5 | nit | Code quality | `DetectResult` được import trong `KnowledgeView.vue` nhưng không sử dụng trực tiếp (topicInfo giờ từ `useSummarize`, không cần type annotation trong KnowledgeView). | Xóa `DetectResult` khỏi import line. |

---

### Analysis Chi Tiết

#### Bug #1 — Stale `cachedTopic.value` (major)

Luồng cancel+resume:

```
Run 1:
  loadTopicData() → cachedTopic.value.knowledgeChunks = undefined (fresh topic)
  handleExtract() starts, thisId=1
  Extract chunk 0 → persistChunks([chunk0]) → IDB updated, cachedTopic.value.knowledgeChunks NOT updated
  Cancel → activeExtractId++ (=2), isLoading=false

Run 2:
  handleExtract() starts, thisId=3
  computeKnowledgeResumeState() reads cachedTopic.value.knowledgeChunks → undefined (stale!)
  → startFromPostNumber = 0 (treats as fresh)
  → Re-extracts ALL posts from beginning instead of resuming from chunk 1
```

F23 không gặp bug này vì `autoSummarizeDynamic` persist qua `SAVE_CACHED_TOPIC` message + ngay sau đó đọc lại trong `handleSegmentUpdate`. Knowledge View không có bước refresh tương đương.

**Fix gọn nhất:** Đầu `handleExtract()`, ngay sau tạo `thisId`, fetch fresh cache:
```typescript
// Refresh local cache state to pick up any persisted chunks from previous runs
try {
  const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', url);
  if (fresh && thisId === activeExtractId) cachedTopic.value = fresh;
} catch { /* ignore */ }
```

Nếu muốn avoid extra IDB read, alternative: trong `persistChunks()`, update local state:
```typescript
async function persistChunks(chunks: KnowledgeChunk[], guardId: number): Promise<void> {
  if (guardId !== activeExtractId) return;
  if (cachedTopic.value) {
    cachedTopic.value = { ...cachedTopic.value, knowledgeChunks: chunks }; // update local immediately
  }
  await sendMessage('SAVE_CACHED_TOPIC', { url: cachedTopic.value!.url, knowledgeChunks: chunks }).catch(() => {});
}
```

#### `planKnowledgeChunks` — Verified Correct

Edge cases đã trace qua:
- Post đơn > budget với `chunkTokens = 0` → goes to `else` branch → warn → `chunkTokens += postTokens` → chunk gồm post đó đơn lẻ khi post tiếp theo overflow → ✅ correct
- Empty array → returns `[]` → handled upstream → ✅ correct
- All posts fit 1 chunk → 1 chunk record → ✅ correct

#### Cancel Guard — Verified Correct

```typescript
let activeExtractId = 0;  // non-reactive, intentional
function handleCancel() { activeExtractId++; ... }
async function handleExtract() {
  const thisId = ++activeExtractId;  // thisId captures current value
  // ...
  if (thisId !== activeExtractId) return;  // guards all awaits
}
```

Pattern đúng: non-reactive OK vì chỉ dùng trong closure comparison, không cần Vue reactivity. ✅

#### `runReducePhase` — single chunk skip reduce — Logic đúng

```typescript
if (allPartial.length === 1) {
  finalEntries = enrichEntries(allPartial[0]);  // allPartial[0] là KnowledgeEntry[] đã được enrich trước
}
```

`enrichEntries` idempotent (chỉ add timestamp nếu chưa có, match by postNumber). Re-enriching là safe. ✅

#### TopicHubView spread pattern — Correct

```typescript
knowledgeChunks: updated.knowledgeChunks ? [...updated.knowledgeChunks] as KnowledgeChunk[] : allTopics.value[idx].knowledgeChunks,
```

Pattern đúng với DeepReadonly type constraint của topic store. ✅

#### SAVE_CACHED_TOPIC merge cho `knowledgeChunks` — Correct

```typescript
knowledgeChunks: partial.knowledgeChunks !== undefined
  ? partial.knowledgeChunks
  : existing?.knowledgeChunks,
```

Dùng explicit `!== undefined` check thay vì `??` — đúng để allow set `knowledgeChunks: []` (empty array is falsy cho `??`). ✅

---

### Summary
- **Overall:** request-changes
- **Key concerns:**
  1. (major) Cancel+resume không hoạt động đúng do `cachedTopic.value` stale sau `persistChunks` — resume sẽ re-extract toàn bộ thay vì tiếp tục từ điểm dừng.
  2. (minor) UX regression: search/tag filter không được reset khi fresh extract đầu tiên.
  3. Sau khi fix 2 issues trên, feature sẵn sàng cho Opus review xác nhận kiến trúc.

[DRAFT_PENDING_OPUS] — Pending Opus xác nhận: (1) cancel+resume pattern đủ robust không, (2) decision QD1 đẩy chunking lên view layer có trade-off nào so với composable riêng, (3) reduce phase không guard context size có acceptable không.
