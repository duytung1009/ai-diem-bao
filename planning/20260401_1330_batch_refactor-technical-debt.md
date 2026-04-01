# Refactor Technical Debt — SummaryView + TopicHubView + Shared Code

## Objective & Scope

SummaryView.vue là file lớn nhất dự án (1008 LOC), chứa toàn bộ logic scraping, LLM orchestration, cache persistence, news detection, và segment mode trong một `<script setup>` block. Mục tiêu: tách thành composables + helpers để dễ maintain/modify trực tiếp.

Chia thành 7 batch, mỗi batch independently shippable (`vue-tsc` + `npm run build` pass sau mỗi batch).

---

## Affected Modules

| File | Action | Batch |
|------|--------|-------|
| `entrypoints/sidepanel/composables/useSummarize.ts` | **TẠO** | 1 |
| `entrypoints/sidepanel/views/SummaryView.vue` | **SỬA** | 1 |
| `entrypoints/sidepanel/composables/useLLM.ts` | **SỬA** | 4 |
| `entrypoints/sidepanel/views/TopicHubView.vue` | **SỬA** | 5 |
| `entrypoints/sidepanel/composables/useCache.ts` | **XÓA** | 6 |
| `lib/scrapers/page-loader.ts` | **SỬA** (xóa `scrapeAllPages`, dedup) | 6, 7 |
| `lib/constants.ts` | **SỬA** (thêm constants) | 6 |
| `lib/types.ts` | **SỬA** (thêm `LLMProgressCallback`) | 6 |
| `lib/llm/summarizer.ts` | **SỬA** (dùng `LLMProgressCallback`) | 6 |
| `entrypoints/background/index.ts` | **SỬA** (dùng constants) | 6 |
| `entrypoints/sidepanel/views/SettingsView.vue` | **SỬA** (dùng constants) | 6 |

---

## Implementation Steps

### Batch 1: Extract `useSummarize` composable (HIGHEST IMPACT)

**Mục tiêu:** Tách ~700 LOC logic khỏi SummaryView.vue vào composable riêng.

**Tạo:** `entrypoints/sidepanel/composables/useSummarize.ts`
**Sửa:** `entrypoints/sidepanel/views/SummaryView.vue`

#### Di chuyển vào composable:

**State (13+ refs):**
- `summary`, `summaryJson`, `error`, `scrapeProgress`, `simpleLoadingText`, `llmTaskId`
- `isScraping`, `scrapingWarnings`, `scrapingInfo`
- `pendingPosts`, `pendingIncremental`, `currentConfig`
- `cachedTopic`, `cacheFreshness`
- `segmentSize`, `segmentSummaries`, `activeSegmentIndex`
- Non-reactive: `scrapeAbortCtrl`, `activeSummarizeId`

**Computed:**
- `isProcessing`, `summarizedPostCount`, `livePostCount`, `hasLivePostCount`
- `isSegmentMode`, `segments`

**Functions:**
- `loadTopicData`, `evaluateFreshness`, `scrapeRange`, `handleCancel`
- `handleSummarize`, `confirmSummarize`, `cancelPendingSummarize`
- `handleSummarizeSegment`, `generateOverallSummary`, `handleSegmentUpdate`, `handleRetry`

**Watch:**
- `watch(livePostCount, ...)` → re-evaluate cacheFreshness

#### Giữ lại trong SummaryView.vue (~100 LOC script):
- `const store = useTopicStore()`
- `const { ... } = useSummarize(store)` — destructure tất cả refs/functions cần dùng
- `topicInfo` computed (derived from store, dùng trong template)
- `onActivated` hook (gọi `loadTopicData`, check `isSummarizingThisTopic`)
- `onMounted` (load settings)
- Router + template giữ nguyên

#### Signature composable:
```typescript
export function useSummarize(store: ReturnType<typeof useTopicStore>) {
  // ... all state + logic
  return { summary, error, isProcessing, handleSummarize, ... };
}
```

**LOC impact:** SummaryView.vue: ~1008 → ~350 (script ~100 + template ~250). New file ~600 LOC.

---

### Batch 2: Deduplicate cache save + post count helpers

**Sửa:** `entrypoints/sidepanel/composables/useSummarize.ts`

#### 2a. Extract `countRealPosts(posts)`
Pattern `posts.filter(p => p.postNumber > 0).length` xuất hiện 4 lần.

```typescript
function countRealPosts(posts: ScrapedPost[]): number {
  return posts.filter(p => p.postNumber > 0).length;
}
```

#### 2b. Extract `saveTopic(url, fields)` helper
8 lần gọi `sendMessage('SAVE_CACHED_TOPIC', { url, title, version, ... })` với payloads khác nhau. Extract:

```typescript
async function saveTopic(topic: CachedTopic, fields: Partial<CachedTopic>): Promise<void> {
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: topic.url,
    title: topic.title,
    version: topic.version,
    totalPages: topic.totalPages,
    ...fields,
  }).catch(() => {});
}
```

**LOC impact:** -60

---

### Batch 3: Extract news detection subprocess

**Sửa:** `entrypoints/sidepanel/composables/useSummarize.ts`

Lines 358-388 trong handleSummarize (news detection) là subprocess tự chứa, nested 4 levels deep. Extract:

```typescript
async function enrichWithNewsArticles(
  posts: ScrapedPost[],
  topicUrl: string,
  onStatus: (msg: string) => void,
  onInfo: (msg: string) => void,
): Promise<ScrapedPost[]> {
  if (posts.some(p => p.postNumber < 0)) return posts; // already has articles
  try {
    const forumDomain = new URL(topicUrl).hostname;
    const newsCheck = detectNewsThread(posts, forumDomain);
    if (!newsCheck.isNews || !newsCheck.articleUrls.length) return posts;

    onStatus('Phát hiện chủ đề tin tức — đang tải bài báo gốc...');
    const articles = (await Promise.all(
      newsCheck.articleUrls.map(url => sendMessage<ArticleContent | null>('SCRAPE_ARTICLE', { url }).catch(() => null))
    )).filter(Boolean) as ArticleContent[];

    if (!articles.length) return posts;
    const articlePosts: ScrapedPost[] = articles.map((a, i) => ({
      author: `[BÀI BÁO GỐC — ${a.source}]`,
      content: `Tiêu đề: ${a.title}\n\nNội dung:\n${a.content}`,
      timestamp: '', postNumber: -(i + 1),
    }));
    onInfo(`Đã tải ${articles.length} bài báo gốc: ${articles.map(a => a.source).join(', ')}`);
    return [...articlePosts, ...posts];
  } catch { return posts; }
}
```

`handleSummarize` giảm từ 133 LOC → ~100 LOC, nesting giảm từ 4 → 2.

**LOC impact:** -10 net (nhưng readability tăng đáng kể)

---

### Batch 4: Deduplicate useLLM Promise wrappers

**Sửa:** `entrypoints/sidepanel/composables/useLLM.ts`

6 hàm wrapper (`summarize`, `summarizeIncremental`, `analyzeOpinions`, `researchTopic`, `extractKnowledge`, `summarizeSegmentsTask`) dùng **cùng 7 dòng boilerplate**. Extract factory:

```typescript
function createTask<TPayload>(
  taskType: LLMTaskRequest['taskType'],
  payload: TPayload,
): { taskId: string; result: Promise<LLMResultMessage> } {
  let resolve!: (r: LLMResultMessage) => void;
  let reject!: (e: Error) => void;
  const result = new Promise<LLMResultMessage>((res, rej) => { resolve = res; reject = rej; });
  const taskId = startTask(taskType, payload, (r) => {
    r.success ? resolve(r) : reject(new Error(r.error ?? 'LLM error'));
  });
  return { taskId, result };
}
```

Mỗi typed wrapper → one-liner:
```typescript
function summarize(posts: ScrapedPost[]) { return createTask('summarize', posts); }
function extractKnowledge(posts: ScrapedPost[], title: string) { return createTask('extract_knowledge', { posts, title }); }
```

**LOC impact:** -65

---

### Batch 5: TopicHubView cleanup

**Sửa:** `entrypoints/sidepanel/views/TopicHubView.vue`

#### 5a. Xóa `normalizeForCompare()` → dùng `normalizeUrl` từ cache-manager
Code character-for-character giống nhau. Import `normalizeUrl` từ `@/lib/cache-manager` thay thế 4 call sites.

#### 5b. Extract `refreshTopicList()`
Logic fetch `GET_ALL_CACHED_TOPICS` duplicate giữa `onMounted` (lines 104-113) và `onActivated` (lines 115-123):

```typescript
async function refreshTopicList(showLoading = false) {
  if (showLoading) isLoading.value = true;
  try {
    const topics = await sendMessage<CachedTopic[]>('GET_ALL_CACHED_TOPICS');
    allTopics.value = topics || [];
  } catch { /* keep existing data */ }
  finally { if (showLoading) isLoading.value = false; }
}
```

#### 5c. Narrow deep watch → specific field watch
Hiện tại: `watch(() => store.selectedTopic.value, ..., { deep: true })` — trigger mỗi khi BẤT KỲ field thay đổi (kể cả posts array lớn).

Sửa: Watch computed derived fields thay vì deep watch toàn bộ object:
```typescript
const selectedTopicKey = computed(() => {
  const t = store.selectedTopic.value;
  if (!t) return null;
  return `${t.url}|${t.summary?.slice(0, 20) ?? ''}|${t.segments?.length ?? 0}|${t.bookmarked ?? false}`;
});

watch(selectedTopicKey, () => { /* sync allTopics list */ });
```

#### 5d. Fix pre-existing TypeScript error (knowledgeEntries readonly)
Thêm spread cho `knowledgeEntries` field khi construct CachedTopic:
```typescript
knowledgeEntries: updated.knowledgeEntries ? [...updated.knowledgeEntries] : allTopics.value[idx].knowledgeEntries,
```

**LOC impact:** -15

---

### Batch 6: Dead code cleanup + constants extraction

#### 6a. Xóa dead files
- `entrypoints/sidepanel/composables/useCache.ts` — 54 LOC, zero imports confirmed

#### 6b. Xóa dead exports
- `lib/scrapers/page-loader.ts`: `scrapeAllPages()` — exported nhưng không imported ở đâu sau Feature 18. Xóa function + export.

#### 6c. Extract magic numbers vào `lib/constants.ts`

```typescript
// LLM
export const KEEPALIVE_INTERVAL_MS = 20_000;
export const FALLBACK_MS_PER_TOKEN = 20;
export const LLM_TASK_CLEANUP_DELAY_MS = 5_000;
export const MAP_REDUCE_CHUNK_DELAY_MS = 100;
export const RESPONSE_BUFFER_TOKENS = 2_000;

// Cache freshness
export const FRESHNESS_ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const FRESHNESS_ONE_WEEK_MS = 7 * FRESHNESS_ONE_DAY_MS;

// Scraping
export const MAX_CACHE_DISPLAY_BYTES = 50 * 1024 * 1024;
```

Update call sites: `useLLM.ts`, `useSummarize.ts`, `background/index.ts`, `SettingsView.vue`, `summarizer.ts`.

#### 6d. Extract `LLMProgressCallback` type
Pattern `onProgress?: (message: string, step?: number, totalSteps?: number) => void` lặp 6+ lần.

Thêm vào `lib/types.ts`:
```typescript
export type LLMProgressCallback = (message: string, step?: number, totalSteps?: number) => void;
```
Update: `summarizer.ts` (6 functions).

**LOC impact:** -100 (dead code) + 20 (constants) = -80 net

---

### Batch 7: page-loader.ts dedup

**Sửa:** `lib/scrapers/page-loader.ts`

Extract dedup+sort logic (sau khi batch 6 xóa `scrapeAllPages`, chỉ còn `scrapePageRange`):

```typescript
function deduplicateAndSort(posts: ScrapedPost[]): ScrapedPost[] {
  const seen = new Set<number>();
  const unique = posts.filter(p => {
    if (p.postNumber === 0) return true;
    if (seen.has(p.postNumber)) return false;
    seen.add(p.postNumber);
    return true;
  });
  return unique.sort((a, b) => a.postNumber - b.postNumber);
}
```

**LOC impact:** -10

---

## Execution Order

```
Batch 1 (useSummarize) ────→ Batch 2 (cache/post helpers)
                        ├──→ Batch 3 (news detection)
                        └──→ Batch 6 (dead code + constants) → Batch 7 (page-loader dedup)

Batch 4 (useLLM dedup) ─── độc lập
Batch 5 (TopicHubView) ─── độc lập
```

Batch 1, 4, 5 không phụ thuộc nhau → có thể chạy song song.

---

## Edge Cases

1. **Batch 1 — Composable refs:** `useSummarize` return refs, SummaryView destructure → template vẫn reactive vì refs giữ reactivity khi destructure
2. **Batch 5c — selectedTopicKey:** Cần cover đủ fields mà TopicHubView cần sync (url, summary, segments, bookmarked, knowledgeEntries). Nếu thiếu field → allTopics không sync đúng
3. **Batch 6b — scrapeAllPages xóa:** Kiểm tra lại không có import nào dùng trước khi xóa
4. **Batch 6c — Constants:** Chỉ extract numbers xuất hiện >= 2 lần hoặc có ý nghĩa unclear khi đọc inline

---

## Test Plan

Mỗi batch sau khi implement:
1. `npx vue-tsc --noEmit` — no new errors
2. `npm run build` — output `.output/chrome-mv3/` thành công
3. Functional test:
   - Tóm tắt mới (full scrape)
   - Tóm tắt cập nhật (incremental)
   - Segment mode (topic > segmentSize trang)
   - Cancel giữa chừng
   - Topic Hub: search, sort, delete, bookmark

---

## Rollback Plan

Mỗi batch là 1 commit riêng. Revert commit nếu batch gây regression.

---

## Decision Log

### QD1: Composable thay vì sub-components cho SummaryView
- **Đã chọn:** Extract script logic vào `useSummarize` composable, giữ template trong SummaryView
- **Lý do:** Template (250 LOC) hợp lý cho 1 component. Vấn đề chính là script (745 LOC). Composable tách logic mà không cần prop drilling giữa nhiều components.
- **Đã cân nhắc nhưng loại:** Tách thành sub-components (ScrapePanel, SegmentPanel, ...) — yêu cầu complex prop/emit interfaces, tăng file count mà không giảm complexity nhiều.
- **Điều kiện thay đổi:** Nếu template vượt 400 LOC → cân nhắc tách sub-components

### QD2: Không include i18n/localization
- **Đã chọn:** Bỏ qua i18n trong scope này
- **Lý do:** Scope riêng, effort lớn (50+ strings mỗi view). Refactor structure trước, i18n sau.
- **Điều kiện thay đổi:** Khi có yêu cầu multi-language

### QD3: Không include unit tests
- **Đã chọn:** Không viết tests trong scope refactor
- **Lý do:** Refactor composable trước → sau đó viết tests cho composable sẽ dễ hơn nhiều so với test god component hiện tại.
- **Điều kiện thay đổi:** Sau khi batch 1-3 hoàn thành → viết tests cho useSummarize

### QD4: Giữ `cache-manager.ts` layer (không merge vào `cache-db.ts`)
- **Đã chọn:** Giữ nguyên 2 layers
- **Lý do:** `cache-manager` cung cấp `normalizeUrl`, `isSameTopicUrl` — utility functions không liên quan DB. Layer separation hợp lý.
- **Điều kiện thay đổi:** Nếu cache-manager chỉ còn lại 1-2 functions → merge vào cache-db
