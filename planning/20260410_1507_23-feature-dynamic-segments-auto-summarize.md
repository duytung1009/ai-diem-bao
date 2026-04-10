# Feature 23: Dynamic Segments + Auto Summarize All

## Objective & Scope

**Vấn đề hiện tại:**
- Segment size cố định (số trang/segment, default 20, config 10-200)
- Độ dài bài viết không đều → segment có thể quá dài → vượt context limit LLM → lỗi hoặc phải map-reduce (chậm, tốn token)
- User phải click tóm tắt từng segment một → tedious cho topic nhiều segment

**Giải pháp:**
1. **Dynamic Segments:** Tính segment boundaries dựa trên token count thực tế, kết hợp `maxTokens` setting và model context limit
2. **Auto Summarize All:** Nút "Tóm tắt toàn bộ" tự động scrape + summarize lần lượt tất cả segments, rồi generate overall summary

## Affected Modules

| Module | File | Thay đổi |
|--------|------|----------|
| Types | `lib/types.ts` | Thêm `dynamicSegments` flag vào `LLMConfig`; thêm `complete?: boolean` vào `TopicSegment` |
| Constants | `lib/constants.ts` | Thêm `DEFAULT_MAX_TOKENS_PER_SEGMENT`, `CONTEXT_USAGE_RATIO` |
| Token Estimator | `lib/token-estimator.ts` | Thêm `calculateSegmentBudget()` helper |
| Summarize Composable | `entrypoints/sidepanel/composables/useSummarize.ts` | Thay đổi `segments` computed → dynamic; thêm `handleAutoSummarizeAll()` |
| Settings UI | `entrypoints/sidepanel/views/SettingsView.vue` | Toggle dynamic segments, hiển thị/ẩn segment size slider |
| Summary UI | `entrypoints/sidepanel/views/SummaryView.vue` | Nút "Tóm tắt toàn bộ" |

## Implementation Steps

### Phase 1: Dynamic Segment Calculation

#### Step 1: Thêm config & constants

**`lib/types.ts`** — Thêm vào `LLMConfig`:
```typescript
dynamicSegments?: boolean;  // true = tính segment dựa trên token count
```

**`lib/types.ts`** — Thêm vào `TopicSegment`:
```typescript
complete?: boolean;  // false = segment cuối chưa đầy budget, sẽ append thêm khi có bài mới
```

**`lib/constants.ts`** — Thêm:
```typescript
export const CONTEXT_USAGE_RATIO = 0.75; // Sử dụng 75% context limit cho content
export const DEFAULT_DYNAMIC_SEGMENTS = true;
```

#### Step 2: Segment budget calculator

**`lib/token-estimator.ts`** — Thêm function:
```typescript
/**
 * Tính token budget cho mỗi segment dựa trên model context limit.
 * Budget = contextLimit * usageRatio - systemPromptTokens - responseBuffer
 * 
 * systemPromptTokens PHẢI được tính từ actual prompt (default hoặc custom từ Settings).
 * Caller lấy prompt text từ config/custom prompts rồi gọi estimateTokens() trước khi truyền vào.
 */
export function calculateSegmentBudget(
  model: string,
  systemPromptTokens: number,
  responseBuffer?: number,
): number {
  const contextLimit = getContextLimit(model);
  const usable = Math.floor(contextLimit * CONTEXT_USAGE_RATIO);
  const buffer = responseBuffer ?? RESPONSE_BUFFER_TOKENS;
  return Math.max(usable - systemPromptTokens - buffer, 4000); // floor 4000 tokens
}
```

#### Step 3: Dynamic segment computation (core logic)

**`useSummarize.ts`** — Thay đổi flow:

**Approach: Adaptive scrape-then-split**

Vì không biết trước content length từng trang → cần scrape trước rồi mới split. Nhưng scrape toàn bộ topic (có thể hàng trăm trang) trước khi summarize thì quá lâu.

**Giải pháp hybrid:**
1. Scrape từng batch nhỏ (ví dụ 10 trang)
2. Sau mỗi batch, tính accumulated token count
3. Khi token count >= segment budget → đánh dấu segment boundary tại đó
4. Summarize segment vừa hoàn thành
5. Tiếp tục scrape batch tiếp theo cho segment mới
6. Lặp lại đến hết topic

Cách này kết hợp cả 2 feature (dynamic segments + auto summarize) thành một flow thống nhất.

**Chi tiết implementation trong `useSummarize.ts`:**

```typescript
// Thay segments computed hiện tại bằng:
// - Nếu dynamicSegments = false → giữ logic cũ (fixed page count)
// - Nếu dynamicSegments = true → segments ban đầu là estimate, 
//   sau khi scrape sẽ re-calculate dựa trên actual content

const dynamicSegmentBoundaries = ref<{ start: number; end: number; label: string }[]>([]);

const segments = computed(() => {
  if (!isSegmentMode.value || !topicInfo.value) return [];
  
  // Nếu đã có dynamic boundaries (đã scrape) → dùng nó
  if (currentConfig.value?.dynamicSegments && dynamicSegmentBoundaries.value.length > 0) {
    return dynamicSegmentBoundaries.value;
  }
  
  // Fallback: fixed page count (logic cũ)
  const total = topicInfo.value.pageCount;
  const size = segmentSize.value;
  const segs: { start: number; end: number; label: string }[] = [];
  for (let start = 1; start <= total; start += size) {
    const end = Math.min(start + size - 1, total);
    segs.push({ start, end, label: `${start}–${end}` });
  }
  return segs;
});
```

**Hàm tính dynamic boundaries sau khi scrape một batch:**

```typescript
function calculateDynamicBoundary(
  allPosts: ScrapedPost[],
  pageMap: Map<number, ScrapedPost[]>,  // page number → posts on that page
  budgetTokens: number,
  startPage: number,
): { endPage: number; segmentPosts: ScrapedPost[] } {
  let accumulatedTokens = 0;
  let lastPage = startPage;
  const segmentPosts: ScrapedPost[] = [];
  
  for (let page = startPage; page <= maxPage; page++) {
    const pagePosts = pageMap.get(page) ?? [];
    const pageTokens = pagePosts.reduce(
      (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
      0,
    );
    
    if (accumulatedTokens + pageTokens > budgetTokens && segmentPosts.length > 0) {
      // Trang này sẽ overflow → segment kết thúc ở trang trước
      break;
    }
    
    segmentPosts.push(...pagePosts);
    accumulatedTokens += pageTokens;
    lastPage = page;
  }
  
  return { endPage: lastPage, segmentPosts };
}
```

### Phase 2: Auto Summarize All

#### Step 4: `handleAutoSummarizeAll()` function

```typescript
async function handleAutoSummarizeAll() {
  const topic = store.selectedTopic.value;
  if (!topic || !topicInfo.value) return;
  
  const totalPages = topicInfo.value.pageCount;
  const isDynamic = currentConfig.value?.dynamicSegments ?? true;
  const model = currentConfig.value?.model ?? 'gpt-4o-mini';
  
  // Lấy actual system prompt (custom hoặc default) để tính budget chính xác
  const customPrompts = await sendMessage<CustomPrompts | null>('GET_CUSTOM_PROMPTS', undefined);
  const systemPrompt = customPrompts?.summaryPrompt || SUMMARY_PROMPT;
  const systemPromptTokens = estimateTokens(systemPrompt);
  
  const budget = isDynamic 
    ? calculateSegmentBudget(model, systemPromptTokens)
    : Infinity; // fixed mode → dùng segments đã tính sẵn
  
  error.value = '';
  const thisId = ++activeSummarizeId;
  store.setSummarizing(topic.url);
  
  if (isDynamic) {
    // Dynamic mode: scrape progressively, split on-the-fly
    await autoSummarizeDynamic(topic, totalPages, budget, thisId);
  } else {
    // Fixed mode: summarize all existing segments sequentially
    for (let i = 0; i < segments.value.length; i++) {
      if (thisId !== activeSummarizeId) return;
      await handleSummarizeSegment(i);
      if (error.value) return;
    }
  }
  
  // Generate overall summary
  if (thisId === activeSummarizeId && !error.value) {
    const completed = segmentSummaries.value.filter(s => s?.summary).length;
    if (completed >= 1) {
      await generateOverallSummary();
    }
  }
}
```

**`autoSummarizeDynamic()` — Core flow:**

```typescript
async function autoSummarizeDynamic(
  topic: SelectedTopic,
  totalPages: number,
  budgetTokens: number,
  thisId: number,
) {
  let currentPage = 1;
  let segmentIndex = 0;
  const SCRAPE_BATCH = 10; // scrape 10 trang mỗi lần
  
  // pageMap: tích lũy posts theo trang để tính boundary
  const pageMap = new Map<number, ScrapedPost[]>();
  let pendingPosts: ScrapedPost[] = [];
  let pendingTokens = 0;
  let pendingStartPage = 1;
  
  while (currentPage <= totalPages) {
    if (thisId !== activeSummarizeId) return;
    
    // Scrape batch
    const batchEnd = Math.min(currentPage + SCRAPE_BATCH - 1, totalPages);
    isScraping.value = true;
    simpleLoadingText.value = `Đang đọc trang ${currentPage}–${batchEnd}...`;
    
    const { posts: batchPosts, errors } = await scrapeRange(
      topic.url, currentPage, batchEnd,
      currentConfig.value?.scrapeDelayMs ?? 2000,
    );
    isScraping.value = false;
    
    if (errors.length) scrapingWarnings.value.push(...errors);
    
    // News enrichment cho batch đầu tiên
    let enrichedPosts = batchPosts;
    if (currentPage === 1) {
      enrichedPosts = await enrichWithNewsArticles(batchPosts, topic.url, ...);
    }
    
    // Phân bổ posts vào pageMap
    // (scrapePageRange trả về posts kèm metadata, cần group by page)
    // → Cần thêm pageNumber vào ScrapedPost hoặc infer từ postNumber
    
    // Tích lũy vào pending
    for (const post of enrichedPosts) {
      const postTokens = estimateTokens(`[${post.author}] (#${post.postNumber}):\n${post.content}`);
      
      if (pendingTokens + postTokens > budgetTokens && pendingPosts.length > 0) {
        // Segment boundary reached → summarize pending
        const segEnd = currentPage; // approximate
        await summarizeAndSaveSegment(segmentIndex, pendingStartPage, segEnd, pendingPosts, thisId);
        if (error.value || thisId !== activeSummarizeId) return;
        
        segmentIndex++;
        pendingPosts = [];
        pendingTokens = 0;
        pendingStartPage = segEnd + 1; // (hoặc trang chứa post hiện tại)
      }
      
      pendingPosts.push(post);
      pendingTokens += postTokens;
    }
    
    currentPage = batchEnd + 1;
  }
  
  // Summarize remaining posts
  if (pendingPosts.length > 0) {
    await summarizeAndSaveSegment(segmentIndex, pendingStartPage, totalPages, pendingPosts, thisId);
  }
}
```

#### Step 5: UI — Nút "Tóm tắt toàn bộ"

**`SummaryView.vue`** — Thêm button bên cạnh segment list:

```html
<button 
  v-if="segments.length > 1 && !isProcessing"
  class="btn btn-primary"
  @click="handleAutoSummarizeAll"
>
  Tóm tắt toàn bộ ({{ segments.length }} phần)
</button>
```

Khi đang chạy auto-summarize, hiển thị progress:
- "Đang đọc trang X–Y..."
- "Đang tóm tắt phần N..."
- "Đang tạo tóm tắt tổng quan..."
- Progress bar: segment completed / total segments

#### Step 6: Settings UI

**`SettingsView.vue`:**
- Toggle checkbox "Tự động chia segment theo độ dài nội dung" (`dynamicSegments`)
- Khi bật: ẩn slider segment size (vì không cần nữa, segment size được tính tự động)
- Khi tắt: hiện slider như cũ

### Phase 3: Edge Cases & Polish

#### Step 7: Xử lý edge cases

1. **Topic đã có cached segments (fixed mode) → chuyển sang dynamic:**
   - Giữ nguyên cached segments đã summarize
   - Chỉ apply dynamic cho segments mới (chưa summarize)

2. **Cancel giữa chừng auto-summarize:**
   - Segments đã summarize xong → giữ lại trong cache
   - Segment đang scrape → abort
   - User có thể resume bằng cách click "Tóm tắt toàn bộ" lại

3. **Segment cuối chưa đầy budget:**
   - Mark `complete: false` trên segment cuối nếu token count < budget
   - Khi topic có bài mới (detect qua `handleSegmentUpdate`): scrape bài mới → append vào segment cuối → re-summarize segment đó
   - Nếu append khiến vượt budget → tách phần mới thành segment tiếp theo
   - UI: hiển thị indicator "chưa hoàn thiện" trên segment cuối (ví dụ icon hoặc badge)

4. **maxTokens trong LLMConfig:**
   - Đã có field `maxTokens?: number` trong `LLMConfig`
   - Nếu user set `maxTokens` → dùng `min(maxTokens, contextLimit * 0.75)` làm budget
   - Nếu không set → dùng `contextLimit * 0.75`

5. **Post không có pageNumber:**
   - `ScrapedPost` không có field `pageNumber`
   - Cần track page boundary khi scrape: `scrapePageRange` callback đã có `currentPage`
   - Giải pháp: thêm `pageNumber` vào ScrapedPost, hoặc track boundary riêng trong auto-summarize flow

6. **Rate limiting:**
   - Giữ `scrapeDelayMs` giữa các trang
   - Thêm delay giữa các LLM calls (đã có `MAP_REDUCE_CHUNK_DELAY_MS`)

## Edge Cases

- Topic 1 trang → 1 segment, auto-summarize = summarize trực tiếp
- Topic rất dài (500+ trang) → nhiều segments, progress phải rõ ràng
- Model context rất nhỏ (local LLM 4K-8K) → segments nhỏ hơn, nhiều hơn
- Model context rất lớn (Gemini 1M) → có thể 1 segment cho cả topic nhỏ
- Network error giữa chừng → retry segment hiện tại, không mất segments trước
- LLM error (truncated JSON) → báo lỗi, giữ segments đã xong

## Test Plan

1. **Unit test `calculateSegmentBudget()`** — verify budget cho các model khác nhau
2. **Dynamic boundary calculation** — mock posts với lengths khác nhau, verify boundaries hợp lý
3. **Auto-summarize flow** — topic 3 segments, verify scrape → summarize → overall tuần tự
4. **Cancel mid-flow** — verify segments đã xong được persist
5. **Toggle dynamic/fixed** — verify UI switch đúng, cached data không mất
6. **Small context model** — verify segments nhỏ hơn cho model 16K context
7. **Single page topic** — verify không lỗi, summarize trực tiếp

## Rollback Plan

- Feature gated bằng `dynamicSegments` flag (default `true`)
- Nếu có issue → user tắt flag → quay lại fixed segment mode
- Không break backward compatibility: `segments` computed vẫn fallback về fixed mode
- Cached topics với fixed segments vẫn load bình thường

## Decision Log

### Quyết định 1: Adaptive scrape-then-split vs Pre-scan estimation
- **Đã chọn:** Adaptive scrape-then-split (scrape batch → tích lũy token → split khi đạt budget)
- **Lý do:** Chính xác nhất vì dùng actual content length; kết hợp tự nhiên với auto-summarize flow; không cần scrape toàn bộ trước
- **Đã cân nhắc nhưng loại:**
  - Pre-scan page 1 rồi estimate → loại vì mật độ nội dung không đều giữa các trang (trang đầu thường dày hơn)
  - Scrape toàn bộ rồi split → loại vì quá chậm cho topic lớn, user phải đợi lâu trước khi thấy kết quả
- **Điều kiện thay đổi:** Nếu scraping trở nên rất nhanh (< 100ms/trang) thì pre-scan toàn bộ có thể khả thi hơn

### Quyết định 2: Budget = contextLimit * 0.75 - systemPromptTokens - responseBuffer
- **Đã chọn:** 75% context limit, trừ đi **actual** system prompt tokens và response buffer
- **Lý do:** 
  - System prompt có thể là default (~500 tokens) hoặc custom prompt từ user (có thể dài hơn nhiều) → phải tính từ actual prompt text, không dùng estimate cố định
  - 75% ratio chừa safety margin cho token estimation sai lệch (heuristic char/3.5 không chính xác 100%)
  - `calculateSegmentBudget()` yêu cầu caller truyền `systemPromptTokens` (bắt buộc, không có default) để force tính từ actual prompt
- **Đã cân nhắc nhưng loại:**
  - 90% → loại vì rủi ro cao khi estimation sai
  - 50% → loại vì lãng phí context, tạo quá nhiều segments nhỏ
  - Default systemPromptTokens = 500 → loại vì custom prompt có thể dài hơn nhiều, gây vượt context
- **Điều kiện thay đổi:** Nếu chuyển sang tokenizer chính xác (tiktoken) thì có thể tăng ratio lên 85-90%

### Quyết định 3: Scrape batch size = 10 trang
- **Đã chọn:** 10 trang/batch trong auto-summarize flow
- **Lý do:** Cân bằng giữa network efficiency (ít round trips) và responsiveness (user thấy progress sớm); consistent với existing scraping logic
- **Đã cân nhắc nhưng loại:**
  - 1 trang/lần → quá chậm do delay giữa mỗi trang
  - Toàn bộ segment size → quay lại vấn đề fixed size
- **Điều kiện thay đổi:** Nếu scraping delay giảm đáng kể

### Quyết định 4: Segment cuối chưa đầy → mark incomplete, cho phép re-summarize khi có bài mới
- **Đã chọn:** Segment cuối nếu chưa đầy budget → mark `complete: false`, khi topic có bài viết mới sẽ scrape thêm vào segment đó rồi tóm tắt lại
- **Lý do:** 
  - Topic đang hoạt động → bài viết mới liên tục → segment cuối sẽ tự lớn dần theo thời gian
  - Gộp vào segment trước sẽ khiến segment đó vượt budget, phải map-reduce → chậm hơn
  - Tách riêng giữ đúng logic: mỗi segment nằm trong budget, segment cuối chỉ là "chưa đầy"
- **Đã cân nhắc nhưng loại:**
  - Gộp segment cuối vào trước nếu < 20% budget → loại vì segment trước có thể vượt budget; mất khả năng append bài mới
  - Luôn tạo segment riêng và coi như hoàn chỉnh → loại vì khi có bài mới sẽ tạo thêm segment nhỏ nữa, dần fragmented
- **Điều kiện thay đổi:** Nếu topic "đã đóng" (không có bài mới) thì segment cuối dù nhỏ cũng nên mark complete

### Quyết định 5: Page tracking trong dynamic mode
- **Đã chọn:** Track page boundaries bằng biến local trong auto-summarize flow (không thêm field `pageNumber` vào `ScrapedPost`)
- **Lý do:** Không muốn thay đổi `ScrapedPost` type (ảnh hưởng nhiều module); page boundary chỉ cần thiết lúc tính dynamic segments
- **Đã cân nhắc nhưng loại:**
  - Thêm `pageNumber` vào `ScrapedPost` → loại vì thay đổi type rộng, migration concern cho cached data
- **Điều kiện thay đổi:** Nếu cần page-level granularity ở nhiều nơi khác

## Implementation Order

1. `lib/constants.ts` — thêm constants mới
2. `lib/types.ts` — thêm `dynamicSegments` vào `LLMConfig`
3. `lib/token-estimator.ts` — thêm `calculateSegmentBudget()`
4. `useSummarize.ts` — refactor `segments` computed, thêm `handleAutoSummarizeAll()` + `autoSummarizeDynamic()`
5. `SummaryView.vue` — nút "Tóm tắt toàn bộ", progress UI
6. `SettingsView.vue` — toggle dynamic segments
7. Test & polish
