# Feature 24: Dynamic Chunks for Knowledge Extraction

## Objective & Scope

**Bối cảnh:**
- F23 đã triển khai dynamic segments + auto-summarize cho tab Tóm tắt (scrape tiến dần, split boundary theo token budget thực, resumable, incremental update).
- Bug fix vừa rồi (`tasks/20260410_2300_bug_fix-knowledge-extraction-timeout.md`) đã thêm map-reduce **bên trong** `extractKnowledge()` để tránh timeout 120s/call — nhưng:
  - Toàn bộ chunks chạy liên tiếp trong 1 task LLM duy nhất → nếu user cancel, đóng extension, hoặc lỗi giữa chừng → **mất hết progress** (phải re-extract từ đầu).
  - Không có persist trung gian → không resumable.
  - UI progress chỉ có text (`"Đang trích xuất phần N/M..."`) nhưng không có chunk-level persistence → user nhìn thấy tiến độ nhưng không "cảm" được là đã lưu.
  - Khi có bài mới tới (`handleExtract` incremental), vẫn phải re-run map-reduce toàn bộ posts mới trong 1 shot.

**Mục tiêu F24:** Đưa cơ chế dynamic segment (F23) sang tab Kiến thức — mỗi "knowledge chunk" được persist ngay sau khi extract xong, flow có thể resume từ chunk cuối cùng chưa hoàn tất, và incremental update chỉ re-process phần mới.

**Phạm vi KHÔNG làm:**
- Không scrape lại posts (knowledge vẫn đọc từ `cachedTopic.posts` / `cachedTopic.segments[].posts` như hiện tại — dependency vào tab Tóm tắt giữ nguyên).
- Không thay đổi UX bookmark/save/delete/filter (F22).
- Không thay đổi prompts `KNOWLEDGE_CHUNK_PROMPT` / `KNOWLEDGE_REDUCE_PROMPT` (vừa thêm ở bug fix trước).
- Không đổi `KnowledgeEntry` shape.

---

## Affected Modules

| Module | File | Thay đổi |
|--------|------|----------|
| Types | `lib/types.ts` | Thêm `KnowledgeChunk` interface; thêm `knowledgeChunks?: KnowledgeChunk[]` vào `CachedTopic` |
| Summarizer (LLM) | `lib/llm/summarizer.ts` | Tách `extractKnowledge` map-reduce thành 2 export: `extractKnowledgeChunk` (map) + `reduceKnowledgeChunks` (reduce); giữ `extractKnowledge` cho direct path (topic nhỏ fit 1 call) |
| Background | `entrypoints/background/index.ts` | Thêm 2 task types: `extract_knowledge_chunk`, `reduce_knowledge_chunks`; cập nhật `parseKnowledgeEntries` (đã handle `.flat()`) |
| Composable LLM | `entrypoints/sidepanel/composables/useLLM.ts` | Thêm 2 wrapper: `extractKnowledgeChunk(posts, title)`, `reduceKnowledgeChunks(partialEntries)` |
| Knowledge View | `entrypoints/sidepanel/views/KnowledgeView.vue` | Refactor `handleExtract()` → orchestrate chunked flow với resume + cancel + persist per chunk; thêm `handleCancel()`; thêm chunk progress UI |
| Cache Manager | `lib/cache-manager.ts` | (check-only) đảm bảo `saveCachedTopic` merge được `knowledgeChunks` field |

**KHÔNG thay đổi:** `KnowledgeEntry` shape, `KNOWLEDGE_CHUNK_PROMPT`, `KNOWLEDGE_REDUCE_PROMPT`, `calculateSegmentBudget`, bookmark/save/delete/filter UI.

---

## Data Model

### New: `KnowledgeChunk` (in `lib/types.ts`)

```typescript
export interface KnowledgeChunk {
  index: number;                // thứ tự chunk, 0-based
  startPostNumber: number;      // post đầu (inclusive)
  endPostNumber: number;        // post cuối (inclusive)
  entries: KnowledgeEntry[];    // raw entries từ chunk này (PRE-reduce)
  extractedAt: number;          // timestamp
  complete?: boolean;           // false = chunk cuối, chưa đầy budget, cho phép append posts mới
}
```

### Update: `CachedTopic`

```typescript
export interface CachedTopic {
  // ... existing fields
  knowledgeChunks?: KnowledgeChunk[];     // NEW — raw chunks, persistent
  knowledgeEntries?: KnowledgeEntry[];    // existing — final reduced result hiển thị cho user
  lastKnowledgePostNumber?: number;       // existing — giữ lại cho backward compat, derived từ max(chunks[].endPostNumber)
  excludedKnowledgePostNumbers?: number[]; // existing — user-deleted entries
}
```

**Lý do dùng `postNumber` thay vì `startPage/endPage`:** Knowledge làm việc trên stream of posts (filtered by `excludedKnowledgePostNumbers`), không quan tâm page. Post numbers là identifier ổn định.

**Relation với `knowledgeEntries`:**
- `knowledgeChunks[].entries` = raw output của từng map call (chưa merge/dedup)
- `knowledgeEntries` = final result sau reduce (hiển thị UI)
- Flow: chunks extract → persist raw → reduce all chunks → persist final → UI render
- Khi có bài mới: chunks mới được thêm → reduce lại tất cả → update final

---

## Implementation Steps

### Phase 1: Foundation (types + LLM layer)

#### Step 1: Types
**`lib/types.ts`**
- Thêm `KnowledgeChunk` interface (spec ở trên)
- Thêm `knowledgeChunks?: KnowledgeChunk[]` vào `CachedTopic`
- Không remove/rename field nào để không break cache hiện có

#### Step 2: Split LLM functions
**`lib/llm/summarizer.ts`**

Hiện tại `extractKnowledge()` làm 3 việc trong 1 function: detect context, map chunks (loop), reduce. Cần tách:

```typescript
// Giữ nguyên — entry point cho direct path (topic nhỏ)
// Không chunk, không reduce — gọi 1 call
export async function extractKnowledge(
  posts: ScrapedPost[],
  title: string,
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  customPrompts?: CustomPrompts,
): Promise<string> { /* unchanged single-call path */ }

// NEW — map phase cho 1 chunk
export async function extractKnowledgeChunk(
  chunkPosts: ScrapedPost[],
  title: string,
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
): Promise<string> {
  // Dùng KNOWLEDGE_CHUNK_PROMPT
  // topicContextPost + chunkPosts → provider.summarize → return raw JSON string
}

// NEW — reduce phase
export async function reduceKnowledgeChunks(
  partialEntries: KnowledgeEntry[][], // từng chunk đã parse
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
): Promise<string> {
  // Serialize lại từng chunk thành JSON → ghép text → gọi KNOWLEDGE_REDUCE_PROMPT
  // Return raw JSON string (final entries)
}
```

**Loại bỏ** logic map-reduce cũ trong `extractKnowledge()` — đẩy trách nhiệm chunking lên composable layer (đồng nhất với pattern F23).

**Lý do đẩy chunking lên composable:** F23 làm vậy cho summary (`autoSummarizeDynamic` ở `useSummarize.ts`). Composable cần persist sau mỗi chunk → phải biết ranh giới chunk. Nếu chunking nằm trong `summarizer.ts` thì composable không can thiệp được giữa chừng để persist.

#### Step 3: Chunking helper
**`lib/llm/summarizer.ts` (hoặc new `lib/llm/knowledge-chunker.ts`)**

Thêm export:
```typescript
export function planKnowledgeChunks(
  posts: ScrapedPost[],
  model: string,
  contextWindowOverride?: number,
): { startIndex: number; endIndex: number }[] {
  // Dùng KNOWLEDGE_CHUNK_PROMPT để tính prompt tokens
  // budget = calculateSegmentBudget(model, estimateTokens(KNOWLEDGE_CHUNK_PROMPT), 2000, contextWindowOverride)
  // Iterate posts theo postNumber order, accumulate tokens
  // Khi vượt budget → cắt chunk
  // Return array chỉ số post boundaries (không copy data)
}
```

**Tại sao dùng indexes thay vì array posts:** Caller đã có full posts array, chỉ cần biết boundary để slice. Tránh duplicate memory.

**Lưu ý edge case:** 1 post duy nhất > budget → vẫn đưa vào chunk riêng (force), và log warning. LLM adapter sẽ báo lỗi nếu thật sự tràn context.

### Phase 2: Background + composable wiring

#### Step 4: Background task types
**`entrypoints/background/index.ts`**

Thêm 2 case trong handler:
```typescript
case 'extract_knowledge_chunk': {
  const { posts, title } = payload as { posts: ScrapedPost[]; title: string };
  inputTokens = estimateTokens(posts.map(p => p.content).join(''));
  const raw = await extractKnowledgeChunk(posts, title, config, onProgress);
  result = { entries: parseKnowledgeEntries(raw) };
  break;
}
case 'reduce_knowledge_chunks': {
  const { partialEntries } = payload as { partialEntries: KnowledgeEntry[][] };
  inputTokens = estimateTokens(JSON.stringify(partialEntries));
  const raw = await reduceKnowledgeChunks(partialEntries, config, onProgress);
  result = { entries: parseKnowledgeEntries(raw) };
  break;
}
```

`parseKnowledgeEntries` giữ nguyên (đã handle `.flat()` sau bug fix trước).

**Giữ nguyên** case `extract_knowledge` cũ (direct path cho topic nhỏ — nếu composable phát hiện single chunk thì gọi path này để skip reduce, tiết kiệm 1 call).

#### Step 5: useLLM wrappers
**`entrypoints/sidepanel/composables/useLLM.ts`**

```typescript
function extractKnowledgeChunkTask(posts: ScrapedPost[], title: string) {
  return createTask('extract_knowledge_chunk', { posts, title });
}

function reduceKnowledgeChunksTask(partialEntries: KnowledgeEntry[][]) {
  return createTask('reduce_knowledge_chunks', { partialEntries });
}
```

Export từ `useLLM()` return object.

### Phase 3: KnowledgeView orchestration

#### Step 6: Chunking + resume logic
**`entrypoints/sidepanel/views/KnowledgeView.vue`**

**State thêm:**
```typescript
const activeExtractId = ref(0);  // cancel guard (tương tự activeSummarizeId ở F23)
const currentChunkIndex = ref(0);
const totalChunks = ref(0);
const currentPhase = ref<'idle' | 'extracting' | 'reducing'>('idle');
```

**New helpers:**

```typescript
// Resume state: đọc cachedTopic.knowledgeChunks hiện có
function computeKnowledgeResumeState(): {
  startFromPostNumber: number;
  existingChunks: KnowledgeChunk[];
} {
  const chunks = cachedTopic.value?.knowledgeChunks ?? [];
  if (chunks.length === 0) return { startFromPostNumber: 0, existingChunks: [] };

  const lastChunk = chunks[chunks.length - 1];
  if (lastChunk.complete === false) {
    // Last chunk incomplete → drop nó, resume từ startPostNumber của last chunk
    return {
      startFromPostNumber: lastChunk.startPostNumber,
      existingChunks: chunks.slice(0, -1),
    };
  }
  // All complete → resume từ sau post cuối
  return {
    startFromPostNumber: lastChunk.endPostNumber + 1,
    existingChunks: chunks,
  };
}
```

#### Step 7: Refactor `handleExtract()`

```typescript
async function handleExtract() {
  if (!allPosts.value.length) return;
  if (isLoading.value) return;

  const thisId = ++activeExtractId;
  error.value = '';
  isLoading.value = true;
  currentPhase.value = 'extracting';

  try {
    // 1. Determine resume state
    const resume = computeKnowledgeResumeState();
    const excludedNums = new Set(cachedTopic.value?.excludedKnowledgePostNumbers ?? []);

    // 2. Filter posts: >= startFromPostNumber, không excluded
    const postsToProcess = allPosts.value
      .filter(p => p.postNumber >= resume.startFromPostNumber && !excludedNums.has(p.postNumber))
      .sort((a, b) => a.postNumber - b.postNumber);

    if (postsToProcess.length === 0) {
      // Không có gì mới — nếu đã có entries thì báo, không thì vẫn reduce lại (phòng trường hợp entries bị mất)
      if (entries.value.length > 0) {
        error.value = 'Không có bài viết mới để trích xuất kiến thức.';
      }
      return;
    }

    // 3. Quyết định path: direct (1 call, fit context) hay chunked
    const budget = calculateSegmentBudget(
      currentConfig.value?.model ?? 'gpt-4o-mini',
      KNOWLEDGE_CHUNK_PROMPT_TOKENS,
      2000,
      currentConfig.value?.contextWindow,
    );
    const totalTokens = estimatePostsTokens(postsToProcess);

    if (totalTokens <= budget && resume.existingChunks.length === 0) {
      // Direct path: single call + no reduce
      await runDirectExtract(postsToProcess, thisId);
      return;
    }

    // 4. Chunked path
    const chunkPlan = planKnowledgeChunks(postsToProcess, currentConfig.value?.model ?? 'gpt-4o-mini', currentConfig.value?.contextWindow);
    totalChunks.value = resume.existingChunks.length + chunkPlan.length;
    const newChunks: KnowledgeChunk[] = [...resume.existingChunks];

    // 5. Loop extract each chunk
    for (let i = 0; i < chunkPlan.length; i++) {
      if (thisId !== activeExtractId) return; // cancelled
      currentChunkIndex.value = newChunks.length;
      currentPhase.value = 'extracting';

      const { startIndex, endIndex } = chunkPlan[i];
      const chunkPosts = postsToProcess.slice(startIndex, endIndex + 1);
      const isLastChunk = i === chunkPlan.length - 1;

      const { taskId, result } = runExtractChunk(chunkPosts, cachedTopic.value!.title);
      llmTaskId.value = taskId;
      const llmResult = await result;
      if (thisId !== activeExtractId) return;

      const chunkEntries = enrichEntries(
        ((llmResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [],
      );

      const chunkRecord: KnowledgeChunk = {
        index: newChunks.length,
        startPostNumber: chunkPosts[0].postNumber,
        endPostNumber: chunkPosts[chunkPosts.length - 1].postNumber,
        entries: chunkEntries,
        extractedAt: Date.now(),
        // Last chunk marked incomplete nếu token fill < 80% budget → cho phép append
        complete: isLastChunk ? (estimatePostsTokens(chunkPosts) >= budget * 0.8) : true,
      };
      newChunks.push(chunkRecord);

      // Persist per chunk
      await persistChunks(newChunks, thisId);
    }

    // 6. Reduce phase
    if (thisId !== activeExtractId) return;
    currentPhase.value = 'reducing';
    const allPartial = newChunks.map(c => c.entries);

    let finalEntries: KnowledgeEntry[];
    if (allPartial.length === 1) {
      // Single chunk → skip reduce call
      finalEntries = allPartial[0];
    } else {
      const { taskId, result } = runReduceChunks(allPartial);
      llmTaskId.value = taskId;
      const reduceResult = await result;
      if (thisId !== activeExtractId) return;
      finalEntries = enrichEntries(
        ((reduceResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [],
      );
    }

    // 7. Filter excluded entries at final step (user-deleted shouldn't come back)
    const filteredFinal = finalEntries.filter(e => !excludedNums.has(e.source.postNumber));

    // 8. Merge strategy: saved entries from previous reduce giữ lại
    const savedEntries = entries.value.filter(e => e.saved);
    const merged = mergeSavedWithFresh(savedEntries, filteredFinal);

    // 9. Persist final
    entries.value = merged;
    expandedIds.value = new Set();
    store.updateSelectedTopic({ knowledgeEntries: merged });
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: cachedTopic.value!.url,
      knowledgeEntries: merged,
      knowledgeChunks: newChunks,
      lastKnowledgePostNumber: newChunks[newChunks.length - 1].endPostNumber,
    }).catch(() => {});

    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', cachedTopic.value!.url).catch(() => null);
    if (fresh && thisId === activeExtractId) cachedTopic.value = fresh;
  } catch (err) {
    if (thisId !== activeExtractId) return; // cancelled, ignore
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (thisId === activeExtractId) {
      isLoading.value = false;
      llmTaskId.value = null;
      currentPhase.value = 'idle';
      currentChunkIndex.value = 0;
      totalChunks.value = 0;
    }
  }
}

async function persistChunks(chunks: KnowledgeChunk[], thisId: number) {
  if (thisId !== activeExtractId) return;
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: cachedTopic.value!.url,
    knowledgeChunks: chunks,
  }).catch(() => {});
  // Không update entries.value ở đây — chỉ update sau reduce xong
}
```

#### Step 8: Cancel support

```typescript
function handleCancel() {
  activeExtractId.value++;
  isLoading.value = false;
  llmTaskId.value = null;
  currentPhase.value = 'idle';
  // Partial progress đã persist mỗi chunk → sẽ auto-resume khi user click lại
}
```

UI: Thêm nút "Hủy" bên cạnh progress indicator khi `isLoading.value`.

#### Step 9: Progress UI

Thay `ProgressIndicator` fallback-message bằng reactive text:
```html
<ProgressIndicator
  v-if="isLoading"
  :task-id="llmTaskId"
  :fallback-message="progressLabel"
/>
<button v-if="isLoading" class="btn btn-secondary mt-2" @click="handleCancel">
  Hủy
</button>
```

```typescript
const progressLabel = computed(() => {
  if (currentPhase.value === 'extracting' && totalChunks.value > 0) {
    return `Đang trích xuất phần ${currentChunkIndex.value + 1}/${totalChunks.value}...`;
  }
  if (currentPhase.value === 'reducing') return 'Đang gộp kiến thức...';
  return 'Đang trích xuất kiến thức...';
});
```

### Phase 4: Handle edge cases

#### Step 10: Clear tracking

`handleClearTracking()` — cập nhật để xóa cả `knowledgeChunks`:
```typescript
async function handleClearTracking() {
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: cachedTopic.value!.url,
    excludedKnowledgePostNumbers: [],
    lastKnowledgePostNumber: 0,
    knowledgeChunks: [], // NEW
  }).catch(() => {});
  // reload cache
}
```

Sau clear tracking, lần click "Trích xuất" tiếp theo sẽ chạy full flow từ đầu.

#### Step 11: Backward compat với cached topics cũ

Topics cũ đã có `knowledgeEntries` nhưng chưa có `knowledgeChunks`:
- `computeKnowledgeResumeState()` trả về `{ startFromPostNumber: 0, existingChunks: [] }` (vì không có chunks)
- Trigger re-extract full — nhưng `savedEntries` vẫn được preserve qua merge logic
- User có thể chỉ click "Trích xuất bài mới" để migrate dần (sẽ rebuild chunks từ đầu)

**Alternative (rejected):** Silent migration — parse `knowledgeEntries` hiện có thành 1 "pseudo chunk". Loại vì entries cũ không có `source.postNumber` boundary chính xác của chunk → sai semantics; savedEntries merge logic đã cover use case preserve.

#### Step 12: Topic không có posts

Giữ nguyên warning hiện tại: `"Chưa có dữ liệu bài viết. Vui lòng tóm tắt topic ở tab 'Tóm tắt' trước."` — F24 không tự scrape.

---

## Edge Cases

1. **Single chunk fit context** → direct path (1 call, skip reduce). Không tạo `knowledgeChunks` record (hoặc tạo 1 record duy nhất với `complete: true` để consistency).
   - **Quyết định:** Tạo 1 record duy nhất để resume logic đồng nhất. Overhead nhỏ.

2. **Last chunk chưa đầy budget (< 80%)** → mark `complete: false`. Lần extract kế tiếp sẽ drop chunk đó, re-extract với posts cũ + posts mới (tự nhiên mở rộng chunk cuối).

3. **User delete entry giữa extraction** → `excludedKnowledgePostNumbers` update. Filter ở final reduce step (Step 7 item 7). Chunks không cần rebuild vì reduce filter đã đủ.

4. **User cancel giữa chunk N** → chunks 0..N-1 đã persist. Click lại → `computeKnowledgeResumeState` thấy chunks hoàn chỉnh → resume từ chunk N.

5. **Network/LLM error giữa chunk N** → error handler dừng flow, chunks 0..N-1 đã persist. User click lại → resume từ chunk N.

6. **Post số 1 vượt budget** (post cực dài) → chunk 1 post đó (force), LLM có thể fail. Acceptable edge case — log warning, tiếp tục chunk sau.

7. **Topic có `knowledgeEntries` nhưng không có `knowledgeChunks`** (legacy) → treat as fresh extract, savedEntries preserved via merge.

8. **Toggle `dynamicSegments` OFF trong Settings** → KHÔNG ảnh hưởng tab Kiến thức. F24 không depend vào flag đó (knowledge luôn chunked nếu vượt budget).

9. **Reduce phase vượt context** → unlikely (entries compact hơn posts nhiều), nhưng fallback: if combined entries tokens > budget, recursive reduce (giống tree-reduce của summary segments).
   - **Quyết định:** KHÔNG implement recursive reduce ban đầu — nếu thực tế gặp, add sau. Entries từ 20 chunks × 20 entries × ~100 tokens/entry = ~40K tokens, vẫn fit hầu hết model.

10. **Topic rất lớn (1000+ posts)** → có thể thành 10-20 chunks. Mỗi chunk 1 LLM call. Reduce call cuối cùng có thể tốn time. UX: progress bar rõ ràng, có thể cancel.

---

## Test Plan

1. **Unit test `planKnowledgeChunks`:**
   - Posts fit 1 chunk → trả 1 record
   - Posts vượt → split đúng theo budget
   - Post cực dài → force 1 chunk riêng

2. **Direct path (small topic):** 10 posts → 1 call, không reduce, `knowledgeChunks` có 1 record.

3. **Chunked path (large topic):** 200 posts → ≥2 chunks → chunks persist sau mỗi call → final reduce → `knowledgeEntries` merged.

4. **Resume:** 
   - Click extract → cancel giữa chunk 3/5 → chunks 0..2 có trong IDB → click lại → chỉ extract chunks 3..4 → reduce → final entries đúng.

5. **Last chunk incomplete:**
   - Extract topic 50 posts (chunk 1 = 40 posts, chunk 2 = 10 posts < 80% budget) → chunk 2 marked `complete: false` → sau khi topic tăng lên 70 posts → click "Trích xuất bài mới" → chunk 2 bị drop, re-extract từ post 41 với posts mới → 2 chunks mới replace chunk 2 cũ.

6. **Delete entry:**
   - Extract → delete entry → `excludedKnowledgePostNumbers` updated → entry không appear lại khi click "Trích xuất bài mới".

7. **Clear tracking:**
   - Click "Xóa tracking" → `knowledgeChunks = []`, `lastKnowledgePostNumber = 0`, `excludedKnowledgePostNumbers = []` → click extract → full flow chạy lại từ đầu, saved entries preserved.

8. **Legacy cache:**
   - Topic có `knowledgeEntries` nhưng không `knowledgeChunks` → click extract → treat as fresh, savedEntries merged.

9. **Cancel during reduce:** Click cancel trong phase `reducing` → `activeExtractId++` → reduce result ignored → chunks vẫn persist → `knowledgeEntries` không update → click lại → skip extract, chỉ run reduce.
   - **Optimization:** Nếu tất cả chunks complete và chỉ thiếu final reduce → resume gọi thẳng reduce, không re-extract chunks.

10. **Type check & build:** `npx vue-tsc --noEmit` + `npm run build` pass.

11. **Manual:** Test trên topic thật (Gemini flash 2.5, local LLM 16K context, GPT-4o-mini).

---

## Rollback Plan

- Feature là additive: `knowledgeChunks` field optional, nếu rollback thì code ignore field này, topics cũ vẫn chạy với `knowledgeEntries` flow cũ.
- Revert các file: `lib/types.ts`, `lib/llm/summarizer.ts`, `entrypoints/background/index.ts`, `useLLM.ts`, `KnowledgeView.vue`.
- Không có migration DB → `knowledgeChunks` records trong IDB sẽ trở thành orphan field, không break gì.

---

## Decision Log

### QD1: Chunking logic ở composable layer, không ở summarizer.ts

- **Đã chọn:** Đẩy loop chunking + persist lên `KnowledgeView.vue` (composable layer); `summarizer.ts` chỉ export stateless primitives (`extractKnowledgeChunk`, `reduceKnowledgeChunks`, `planKnowledgeChunks`).
- **Lý do:** Đồng nhất với F23 (`autoSummarizeDynamic` ở `useSummarize.ts`). Composable cần biết ranh giới chunk để persist sau mỗi call. Nếu loop nằm trong summarizer thì không thể intercept giữa chừng để persist/cancel.
- **Đã cân nhắc nhưng loại:**
  - Loop trong `summarizer.ts` với callback persist → callback sẽ phải pass cacheManager + topicUrl + task context → vi phạm separation of concerns, summarizer không nên biết về cache layer.
  - Loop trong background task handler → background không có Vue reactivity, progress update khó flow ngược về UI.
- **Điều kiện thay đổi:** Nếu quyết định tạo worker background riêng cho knowledge extraction (kiểu job queue độc lập với UI), thì có thể dời loop xuống background.

### QD2: Chunk boundary dùng `postNumber` thay vì `page`

- **Đã chọn:** `startPostNumber` / `endPostNumber` trong `KnowledgeChunk`.
- **Lý do:**
  - Knowledge tab làm việc trên `allPosts` (stream of posts), không care về pages. Posts có thể bị loại bởi `excludedKnowledgePostNumbers` → page boundary không có ý nghĩa.
  - `postNumber` là identifier stable, đã dùng ở `lastKnowledgePostNumber`.
  - Đơn giản hơn khi resume: compare `postNumber` thay vì tra back pageMap.
- **Đã cân nhắc nhưng loại:**
  - Dùng `startPage/endPage` (giống `TopicSegment` của summary) → phải track page cho mỗi post (ScrapedPost không có field page) → thêm complexity không cần thiết cho knowledge.
  - Dùng `startIndex/endIndex` (array index) → không stable qua các lần extract khác nhau (nếu `excludedKnowledgePostNumbers` đổi).
- **Điều kiện thay đổi:** Nếu cần cross-reference với summary segments (ví dụ "kiến thức từ segment X") thì có thể thêm `sourceSegmentIndex` field.

### QD3: Last chunk marked incomplete nếu < 80% budget

- **Đã chọn:** Ngưỡng 80%. Nếu `estimatePostsTokens(lastChunkPosts) < budget * 0.8` → `complete: false`.
- **Lý do:**
  - Giống F23 pattern cho summary segments (last segment không full → cho phép append).
  - 80% chừa dư 20% để post mới có thể append vào mà không vượt budget ngay.
  - Nếu last chunk >= 80% → mark complete, post mới sẽ tạo chunk mới.
- **Đã cân nhắc nhưng loại:**
  - Luôn mark `complete: true` cho last chunk → khi có post mới sẽ tạo chunk cực nhỏ, fragmentation.
  - Luôn mark `complete: false` → re-extract last chunk mỗi lần có post mới, kể cả khi đã gần full.
  - Ngưỡng 50% → quá thấp, chunks nhỏ không hiệu quả.
  - Ngưỡng 95% → quá cao, ít cơ hội append.
- **Điều kiện thay đổi:** Nếu user feedback last chunk re-extract quá thường → raise ngưỡng; nếu chunks cuối hay bị nhỏ lẻ → lower ngưỡng.

### QD4: Single chunk vẫn tạo record (không skip `knowledgeChunks`)

- **Đã chọn:** Direct path vẫn tạo 1 chunk record trong `knowledgeChunks` (`complete: true` hoặc `false` theo ngưỡng).
- **Lý do:**
  - Resume logic đồng nhất: luôn đọc `knowledgeChunks`, không cần special-case "đã extract trực tiếp chưa".
  - Khi topic grow từ small → large, chunk record đầu tiên vẫn hữu ích làm baseline.
  - Overhead nhỏ: 1 record ~ vài KB.
- **Đã cân nhắc nhưng loại:**
  - Chỉ tạo chunks khi > 1 chunk → resume logic phải check cả `knowledgeEntries` fallback → phức tạp.
- **Điều kiện thay đổi:** Nếu overhead IDB trở thành vấn đề (vd. nhiều topics nhỏ).

### QD5: Reduce filter `excludedKnowledgePostNumbers`, không filter ở chunk level

- **Đã chọn:** Filter excluded entries ở bước cuối (sau reduce).
- **Lý do:**
  - User có thể delete entry sau khi chunk đã extract → nếu filter ở chunk level, phải rebuild chunks → tốn LLM calls không cần thiết.
  - Filter ở reduce step: cheap, consistent, entries bị loại không reappear.
  - `knowledgeChunks[].entries` giữ raw → nếu user clear excluded → reduce lại mà không re-extract chunks.
- **Đã cân nhắc nhưng loại:**
  - Filter posts trước khi chunk (như hiện tại `postsToExtract.filter(!excluded)`) → vẫn làm, nhưng chỉ cho posts new; chunks cũ đã có entries cần filter ở reduce.
- **Điều kiện thay đổi:** Nếu excluded list rất lớn → cân nhắc rebuild chunks để tránh lưu raw entries bị loại.

### QD6: Không auto-scrape, giữ dependency vào tab Tóm tắt

- **Đã chọn:** Knowledge vẫn đọc `cachedTopic.posts` / `cachedTopic.segments[].posts`. Nếu không có posts → hiển thị warning "vui lòng tóm tắt trước".
- **Lý do:**
  - Giữ scope feature nhỏ, tránh duplicate scraping logic.
  - Summary tab đã có dynamic scrape + cache (F23), user nên chạy summary trước khi extract knowledge.
  - Tránh race condition 2 tabs đều đang scrape cùng 1 topic.
- **Đã cân nhắc nhưng loại:**
  - Knowledge tab tự scrape độc lập → code duplicate với `autoSummarizeDynamic`, phức tạp hơn, tốn network nếu user cũng chạy summary.
  - Auto trigger summary scrape từ knowledge → cross-tab coupling, khó debug.
- **Điều kiện thay đổi:** Nếu user feedback muốn dùng knowledge mà không cần summary (use case "chỉ lấy kiến thức, không cần tóm tắt") → thêm button "Đọc dữ liệu" trong KnowledgeView trigger scrape flow.

### QD7: `KNOWLEDGE_CHUNK_PROMPT_TOKENS` pre-computed constant vs runtime estimate

- **Đã chọn:** Pre-compute `KNOWLEDGE_CHUNK_PROMPT_TOKENS = estimateTokens(KNOWLEDGE_CHUNK_PROMPT)` ở module-level trong `lib/prompts.ts` hoặc `summarizer.ts`.
- **Lý do:**
  - Prompt là constant → tính 1 lần duy nhất.
  - Tránh `estimateTokens()` call trong mỗi chunk iteration.
- **Đã cân nhắc nhưng loại:**
  - Runtime estimate mỗi chunk → thừa tính toán.
  - Hardcoded magic number → dễ sai nếu prompt đổi.
- **Điều kiện thay đổi:** Nếu support custom knowledge chunk prompt (user override) → phải estimate runtime khi có custom.

### QD8: Reduce call single chunk → skip

- **Đã chọn:** Nếu chỉ có 1 chunk (sau filter/resume) → skip reduce call, dùng thẳng `chunks[0].entries` làm final.
- **Lý do:** Tiết kiệm 1 LLM call khi topic nhỏ.
- **Đã cân nhắc nhưng loại:**
  - Luôn chạy reduce để consistency → lãng phí token khi chỉ có 1 chunk.
- **Điều kiện thay đổi:** Nếu reduce prompt có giá trị format cleanup/dedup mà single chunk cũng cần → bỏ skip.

---

## Implementation Order

1. `lib/types.ts` — `KnowledgeChunk` interface + `CachedTopic.knowledgeChunks`
2. `lib/llm/summarizer.ts` — tách `extractKnowledgeChunk`, `reduceKnowledgeChunks`, `planKnowledgeChunks`; giữ `extractKnowledge` cho direct path (single call)
3. `entrypoints/background/index.ts` — thêm 2 task types `extract_knowledge_chunk`, `reduce_knowledge_chunks`
4. `entrypoints/sidepanel/composables/useLLM.ts` — wrapper functions
5. `entrypoints/sidepanel/views/KnowledgeView.vue` — refactor `handleExtract()`, thêm `handleCancel()`, thêm resume + persist + progress UI
6. Edge case: `handleClearTracking` update, backward compat check
7. Test flow manually trên topic thật (nhỏ + lớn + cancel + resume)
8. `npx vue-tsc --noEmit` + `npm run build` pass
9. Self-review theo `template/self_review_checklist.md`
10. Lưu task report `tasks/yyyyMMdd_HHmm_task_24-feature-dynamic-chunks-knowledge.md`
11. Cập nhật `MEMORY.md`

---

## Verification

1. Topic nhỏ (< budget) → 1 chunk, không reduce call, `knowledgeChunks` có 1 record, entries hiển thị đúng
2. Topic lớn (2-5 chunks) → progress bar chạy qua từng chunk → reduce phase → final entries merged, no duplicates
3. Cancel giữa chunk 3/5 → chunks 0..2 persist → click lại → resume chunks 3..4 → reduce → xong
4. Topic có bài mới (last chunk incomplete) → click "Trích xuất bài mới" → drop last chunk → re-extract với posts cũ+mới → reduce
5. Delete entry → excluded list updated → không reappear sau re-extract
6. Clear tracking → chunks + entries reset → saved entries preserved → full re-extract
7. Legacy cache (chỉ có `knowledgeEntries`) → treat as fresh, saved preserved
8. Build + type check pass
