# Opus Verification Review — Feature 24 (Dynamic Chunks for Knowledge)

**Verification of:** `review/20260411_0030_tier3_feature-24-dynamic-chunks-knowledge.md` (Sonnet, Degraded Mode)

### Metadata
- **Files verified:** `entrypoints/sidepanel/views/KnowledgeView.vue` (full re-read), `entrypoints/sidepanel/composables/useSummarize.ts` (L195–294), `lib/llm/summarizer.ts` (L280–382), `entrypoints/background/index.ts`
- **Review tier:** tier3 (verification)
- **Model used:** opus
- **Purpose:** Xác nhận findings của Sonnet + bổ sung concerns Sonnet có thể đã miss do degraded mode
- **Reference:** Sonnet review tagged `[DRAFT_PENDING_OPUS]`

---

### Executive Summary

Sonnet's review là **chất lượng tốt nhưng chưa đầy đủ**. Các findings của Sonnet đều hợp lệ, nhưng Sonnet **đã miss một bug CRITICAL về data corruption khi topic switch mid-extract**, đồng thời đánh giá Issue #1 ở mức "major" là **dưới mức thực tế** (thực chất là một biến thể nhẹ hơn của cùng root cause).

**Verdict upgrade:** `request-changes` → `request-changes (CRITICAL)`

---

### Verification Results — Sonnet's Findings

| # | Sonnet severity | Opus verdict | Notes |
|---|-----------------|--------------|-------|
| 1 | major | **confirmed + promote to critical context** | Stale `cachedTopic.value` sau persistChunks — chỉ là 1 case của root cause lớn hơn (xem Critical #0) |
| 2 | minor | ✅ confirmed | Reset search/tags on fresh extract — valid UX regression |
| 3 | minor | ✅ confirmed | `KNOWLEDGE_CHUNK_PROMPT_TOKENS` vs `KNOWLEDGE_EXTRACT_PROMPT` budget mismatch — valid, nhưng thực tế impact nhỏ |
| 4 | minor | ✅ confirmed (deferred OK) | Reduce context guard — planning đã ghi nhận, acceptable |
| 5 | nit | ✅ confirmed | Unused `DetectResult` import |

Sonnet xác minh `planKnowledgeChunks` / cancel guard / single-chunk reduce skip / TopicHubView spread / SAVE_CACHED_TOPIC merge đều đúng — **Opus confirm tất cả**.

---

### CRITICAL Issue (Sonnet đã miss)

#### #0 — Topic switch mid-extract corrupts target topic's cache

**Severity:** critical
**Category:** Logic / Data integrity

**Root cause:** `KnowledgeView.loadTopicData()` **không invalidate** `activeExtractId` khi topic switch. Đồng thời `persistChunks()`, `runDirectExtract()`, `runReducePhase()` đọc `cachedTopic.value!.url` **tại thời điểm persist** (không capture snapshot ở đầu `handleExtract`).

**So sánh với F23 pattern đúng** (`useSummarize.ts:199–203`):
```typescript
async function loadTopicData() {
  const topic = store.selectedTopic.value;
  if (!topic) return;
  activeSummarizeId++;          // ← Invalidate in-flight work IMMEDIATELY
  summary.value = '';
  // ...
}
```

**KnowledgeView hiện tại** (`KnowledgeView.vue:119–140`):
```typescript
async function loadTopicData() {
  const topic = store.selectedTopic.value;
  if (!topic) return;
  const url = topic.url;
  entries.value = [];
  cachedTopic.value = null;      // ← NO activeExtractId++ !!!
  loadedTopicUrl.value = url;
  // ...
}
```

**Scenario data corruption:**

```
t=0  User đang ở Topic A, click "Trích xuất"
     → handleExtract thisId=1, cachedTopic.value = Topic A
     → postsToProcess = Topic A's posts (captured in local const — OK)
     → LLM call extract_knowledge_chunk bắt đầu (async, ~10-30s)

t=5  User switch sang Topic B trong hub
     → loadTopicData() chạy (KHÔNG ++ activeExtractId)
     → cachedTopic.value = Topic B
     → loadedTopicUrl.value = Topic B's url
     (thisId=1 vẫn === activeExtractId=1, cancel guard VÔ HIỆU)

t=10 LLM call completes cho Topic A's posts
     → Chunks chứa entries extract từ Topic A
     → persistChunks([chunkA], thisId=1)
       → guardId===activeExtractId → đi qua guard
       → sendMessage('SAVE_CACHED_TOPIC', {
           url: cachedTopic.value!.url,   // ← TOPIC B's URL!
           knowledgeChunks: [chunkA]      // ← TOPIC A's data!
         })
     → Topic B's cache bị ghi đè với chunks của Topic A

t=15 Nếu reduce chạy xong:
     → runReducePhase saves knowledgeEntries=entries của Topic A vào Topic B
     → store.updateSelectedTopic({ knowledgeEntries: merged })
       (may or may not apply tùy selectedTopic hiện tại — thêm inconsistency)
```

**Tác động:**
- Topic B's `knowledgeChunks`, `knowledgeEntries`, `lastKnowledgePostNumber` đều bị overwrite bằng data của Topic A
- Saved entries của Topic B (đã được user bookmark) **bị mất hoặc bị trộn** với entries từ Topic A (vì `mergeSavedWithFresh` đọc `entries.value.filter(e => e.saved)` nhưng `entries.value` là state closure của handleExtract — tệ hơn nữa)
- Không có cách nào recover — IDB bị ghi đè, không log

**Vì sao F23 không gặp:** `useSummarize.loadTopicData()` có `activeSummarizeId++` ở dòng đầu tiên → mọi await trong `handleSegmentUpdate` / `autoSummarizeDynamic` đều fail guard → persist bị bỏ qua.

**Fix bắt buộc (2 layers defense):**

**Layer 1 — Invalidate on loadTopicData (primary fix):**
```typescript
async function loadTopicData() {
  const topic = store.selectedTopic.value;
  if (!topic) return;
  const url = topic.url;

  activeExtractId++;  // ← F23 PATTERN: invalidate in-flight extract
  isLoading.value = false;
  llmTaskId.value = null;
  currentPhase.value = 'idle';
  currentChunkIndex.value = 0;
  totalChunks.value = 0;

  entries.value = [];
  cachedTopic.value = null;
  // ... rest unchanged
}
```

**Layer 2 — Capture URL + title at start of handleExtract (defense in depth):**
```typescript
async function handleExtract() {
  if (!allPosts.value.length) return;
  if (isLoading.value) return;

  const thisId = ++activeExtractId;
  const topicUrl = cachedTopic.value?.url;     // ← capture once
  const topicTitle = cachedTopic.value?.title; // ← capture once
  if (!topicUrl || !topicTitle) return;

  // ... dùng topicUrl / topicTitle thay cho cachedTopic.value!.url / .title
  // ở mọi nơi trong runDirectExtract, persistChunks, runReducePhase
}
```

Layer 2 giúp chống: (a) race condition nếu sau này có code path khác modify `cachedTopic.value`, (b) bug khi user rapid-click cancel + switch + re-extract.

**Test plan verify fix:**
1. Topic A có nhiều posts → click "Trích xuất"
2. Khi progress ở chunk 1/3, switch sang Topic B
3. Đợi ~30s
4. Kiểm tra Topic A's `knowledgeChunks` trong IDB (devtools → Application → IDB) — phải còn chunks đã persist trước switch
5. Kiểm tra Topic B's `knowledgeChunks` — PHẢI là `undefined` hoặc giữ nguyên state cũ của Topic B
6. Kiểm tra console — không có SAVE_CACHED_TOPIC call với url=Topic B sau khi switch

---

### Bổ sung: Additional Issues Opus phát hiện

#### #6 — `reduceKnowledgeChunks` lãng phí ~30% tokens do pretty-print JSON

**Severity:** minor (nhưng impact trực tiếp lên reduce phase Sonnet đã flag ở Issue #4)
**File:** `lib/llm/summarizer.ts:327–329`

```typescript
const combinedText = partialEntries
  .map((entries, i) => `--- Phần ${i + 1} ---\n${JSON.stringify(entries, null, 2)}`)
  .join('\n\n');
```

`JSON.stringify(x, null, 2)` thêm `\n` + indentation cho mỗi field. Với 20 entries × ~8 fields × 2 space indent ≈ **30% token overhead** so với compact JSON.

**Fix:**
```typescript
.map((entries, i) => `--- Phần ${i + 1} ---\n${JSON.stringify(entries)}`)
```

**Tác động lên Sonnet's Issue #4:** giảm 30% token usage → increases the effective chunk count trước khi hit context limit từ ~20 lên ~28 chunks. Không hẳn là fix nhưng đáng kể.

---

#### #7 — `enrichEntries` O(N×M) linear search

**Severity:** nit
**File:** `KnowledgeView.vue:165–170`

```typescript
function enrichEntries(newEntries: KnowledgeEntry[]): KnowledgeEntry[] {
  return newEntries.map(e => {
    const post = allPosts.value.find(p => p.postNumber === e.source.postNumber); // O(M)
    return post?.timestamp ? { ...e, source: { ...e.source, timestamp: post.timestamp } } : e;
  });
}
```

Với topic 5000 posts × 20 entries = 100K comparisons. Không critical nhưng trivially fixable:

```typescript
function enrichEntries(newEntries: KnowledgeEntry[]): KnowledgeEntry[] {
  const postMap = new Map(allPosts.value.map(p => [p.postNumber, p]));
  return newEntries.map(e => {
    const post = postMap.get(e.source.postNumber);
    return post?.timestamp ? { ...e, source: { ...e.source, timestamp: post.timestamp } } : e;
  });
}
```

Gọi nhiều lần trong `runReducePhase` + mỗi chunk của chunked path → tần suất cao.

---

#### #8 — Redundant token computation (3 lần cho cùng posts)

**Severity:** nit
**File:** `KnowledgeView.vue`

Token estimation cho toàn bộ `postsToProcess` được tính:
1. Trong `handleExtract` L309–312 (`totalTokens`)
2. Bên trong `planKnowledgeChunks` L358–360 (duyệt lại toàn bộ)
3. Trong loop chunk L348–351 (cho từng chunk)

Mỗi post phải `estimateTokens` trung bình 2–3 lần. Với topic lớn (>1000 posts) có thể tốn 50–100ms total. Không urgent nhưng nếu refactor `planKnowledgeChunks` để return `{chunks, totalTokens, perChunkTokens}` thì cả 3 điểm đều reuse được.

---

#### #9 — `runDirectExtract` không capture `title` trước LLM call

**Severity:** minor
**File:** `KnowledgeView.vue:214`

```typescript
const { taskId, result } = runExtract(postsToProcess, cachedTopic.value!.title);
```

Nếu user switch topic giữa lúc gọi runExtract (sync start) và khi task queue, title của Topic B có thể bị pass vào LLM call của Topic A's posts → LLM có thể confuse context. Cùng root cause với Critical #0 — fix Layer 2 đã giải quyết.

---

#### #10 — `handleCancel` không reset `error.value`

**Severity:** nit
**File:** `KnowledgeView.vue:429–437`

Nếu user cancel xong click lại, `error.value` từ lần trước vẫn hiển thị cho đến khi `handleExtract` reset ở L267. Không sai nhưng tốt hơn:

```typescript
function handleCancel() {
  activeExtractId++;
  isLoading.value = false;
  llmTaskId.value = null;
  currentPhase.value = 'idle';
  currentChunkIndex.value = 0;
  totalChunks.value = 0;
  // error.value giữ nguyên để user thấy tại sao đã cancel (nếu có)
}
```

Thực tế: design hiện tại acceptable vì cancel thường là user-initiated, không có error. Ghi nhận, không cần fix.

---

### Cross-check với Decision Log (QD1–QD8)

| QD | Decision | Implementation match? | Notes |
|----|----------|----------------------|-------|
| QD1 | Orchestration ở view layer (không composable riêng) | ✅ | Đúng, nhưng xem Opus concern bên dưới |
| QD2 | `KnowledgeChunk.entries` = raw pre-reduce | ✅ | |
| QD3 | `complete` flag với 80% threshold | ✅ | |
| QD4 | Direct path cũng tạo 1 chunk record | ✅ | `runDirectExtract` L234–241 |
| QD5 | Single chunk → skip reduce | ✅ | `runReducePhase` L395 |
| QD6 | Non-reactive `activeExtractId` counter | ✅ syntax | ❌ **hoàn chỉnh logic** — thiếu `++` trong `loadTopicData` |
| QD7 | Last chunk incomplete filter trong reduce | ✅ | |
| QD8 | Filter excluded ở reduce step | ✅ | `runReducePhase` L409 |

**QD6 implementation gap:** Planning QD6 không explicitly nói "invalidate trong loadTopicData" nhưng đây là **invariant** của cancel pattern F23. Implementer đã áp dụng pattern nhưng thiếu 1 call site quan trọng.

**Opus concern về QD1:** Đẩy chunking lên view layer khiến `KnowledgeView.vue` giờ ~480 LOC script-only. Acceptable hiện tại, nhưng nếu F19 cross-segment dedup cũng apply sang knowledge sau này → nên extract thành `useKnowledgeExtract` composable tương tự F23. **Không block release.**

---

### Updated Summary

**Overall verdict:** `request-changes` (blocking)

**Blocking issues (PHẢI fix trước khi merge):**
1. **[CRITICAL]** #0 — Topic switch mid-extract data corruption. Fix Layer 1 (`activeExtractId++` trong `loadTopicData`) bắt buộc; Layer 2 (capture url/title) được recommend.
2. **[MAJOR]** #1 (Sonnet) — Stale `cachedTopic.value` on cancel+resume. Fix Layer 1 của #0 một phần giúp (vì re-loadTopicData sẽ được trigger ở scenarios khác) nhưng **không đủ** cho case pure cancel→resume cùng topic. Cần fix riêng: update `cachedTopic.value.knowledgeChunks` trong `persistChunks()` hoặc fetch fresh ở đầu `handleExtract()`.

**Non-blocking issues (nên fix trong commit follow-up):**
3. #2 (Sonnet minor) — Reset search/tags on fresh extract
4. #6 (Opus minor) — Compact JSON trong `reduceKnowledgeChunks` (~30% token savings)

**Acceptable/deferred:**
5. #3, #4 (Sonnet minor) — Budget precision + reduce context guard
6. #5 (Sonnet nit), #7, #8, #9, #10 (Opus) — Code quality improvements

**Key concerns for Tùng:**
1. **Data corruption** nguy hiểm hơn bug bình thường vì silent + irreversible. Cần test topic switch case trước khi merge.
2. Fix cho #0 và #1 overlap nhưng KHÔNG thay thế nhau — cần cả hai.
3. Sonnet's review miss Critical #0 là understandable (degraded mode + pattern nằm ở file khác `useSummarize.ts`), không phải lỗi review process.

**Recommended fix order:**
1. Add `activeExtractId++` + state reset vào `KnowledgeView.loadTopicData()` (Layer 1 của #0)
2. Capture `topicUrl` + `topicTitle` tại đầu `handleExtract`, dùng local vars thay vì `cachedTopic.value!.*` (Layer 2 của #0)
3. Fix #1 bằng update `cachedTopic.value` trong `persistChunks` (gọn hơn fetch fresh)
4. Fix #2, #5, #6 trong cùng commit
5. Re-test: (a) normal extract, (b) cancel+resume cùng topic, (c) topic switch mid-extract, (d) sau đó quay lại Topic A verify chunks intact

---

### Sonnet Review Disposition

- **`[DRAFT_PENDING_OPUS]` tag trong Sonnet's review:** có thể giữ nguyên với note rằng Opus verification đã completed trong file này
- Sonnet's analysis chi tiết và pattern traces (cancel guard, planKnowledgeChunks edge cases, TopicHubView spread, SAVE_CACHED_TOPIC merge) đều chính xác và không cần re-verify
- Điểm yếu duy nhất: không cross-reference pattern với `useSummarize.ts` → miss the `activeSummarizeId++` invariant ở `loadTopicData`
