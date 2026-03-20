# Fix: confirmSummarize() ghi đè state khi user đã chuyển topic

Ngày: 2026-03-20

---

## Bug

Khi đang tóm tắt topic A, nếu user quay lại danh sách → mở topic B (đã tóm tắt) → mở lại topic A thì:
- Loading biến mất dù LLM chưa trả kết quả
- Tóm tắt hiện ra đột ngột không có loading
- Nếu đang xem topic B mà LLM topic A xong → tóm tắt topic A ghi đè lên topic B

## Root Cause

`confirmSummarize()`, `handleSummarizeSegment()`, `generateOverallSummary()` là các async function "trôi nổi". Sau khi `await sendMessage('SUMMARIZE')` yield, user có thể đã chuyển sang topic khác, nhưng các hàm này vẫn:

1. Ghi `summary.value = topicA_summary` (dòng 469) → đè lên topic B đang hiển thị
2. Gọi `store.updateSelectedTopic(...)` (dòng 483) → cập nhật store (đang là topic B) với data topic A
3. `finally` block xoá `loadingText = ''` + `store.setSummarizing(null)` (dòng 491-492) → loading biến mất khi quay lại topic A

## Fix

Thêm **stale guard** dạng request ID. Khi context thay đổi (chuyển topic), mọi LLM call đang chạy sẽ chỉ lưu cache mà không modify view refs.

### File: `entrypoints/sidepanel/views/SummaryView.vue`

#### Bước 1: Thêm biến guard (module-level, không phải ref)

Thêm ngay sau khai báo refs (khoảng dòng 42):

```ts
let activeSummarizeId = 0;
```

Dùng `let` thường (không phải `ref`) vì không cần reactive — chỉ dùng để so sánh trong async function.

#### Bước 2: Invalidate trong `loadTopicData()`

Thêm `activeSummarizeId++` vào đầu block reset trong `loadTopicData()` (dòng 120-134):

```ts
async function loadTopicData() {
  const topic = store.selectedTopic.value;
  if (!topic) return;

  // === RESET all view state for new topic ===
  activeSummarizeId++;  // ← THÊM: invalidate bất kỳ LLM call nào đang chạy
  summary.value = '';
  error.value = '';
  loadingText.value = '';
  // ... (giữ nguyên phần còn lại)
```

#### Bước 3: Guard trong `confirmSummarize()`

Sửa `confirmSummarize()` (bắt đầu dòng 434):

```ts
async function confirmSummarize() {
  const posts = pendingPosts.value;
  const incremental = pendingIncremental.value;
  const topic = store.selectedTopic.value;
  if (!posts || !topicInfo.value || !topic) return;

  pendingPosts.value = null;
  const thisId = ++activeSummarizeId;    // ← THÊM: capture ID tại thời điểm bắt đầu
  store.setSummarizing(topic.url);

  try {
    let summaryText: string;
    if (incremental && cachedTopic.value?.summary) {
      const newPosts = posts.filter(
        (p) => p.postNumber < 0 || p.postNumber > (cachedTopic.value?.lastPostNumber ?? 0),
      );
      if (newPosts.length === 0) {
        summary.value = cachedTopic.value.summary;
        loadingText.value = '';
        store.setSummarizing(null);
        return;
      }
      loadingText.value = 'Đang cập nhật tóm tắt với bài viết mới...';
      const result = await sendMessage<{ summary?: string; error?: string }>('SUMMARIZE_INCREMENTAL', {
        previousSummary: cachedTopic.value.summary,
        newPosts,
      });
      if (result.error) throw new Error(result.error);
      summaryText = result.summary ?? '';
    } else {
      loadingText.value = `Đang tóm tắt ${posts.length} bài viết...`;
      const result = await sendMessage<{ summary?: string; error?: string }>('SUMMARIZE', posts);
      if (result.error) throw new Error(result.error);
      summaryText = result.summary ?? '';
    }

    // ▼▼▼ THÊM: Stale guard — user đã chuyển topic ▼▼▼
    if (thisId !== activeSummarizeId) {
      // Vẫn lưu cache để không mất công LLM đã xử lý
      const lastPost = posts[posts.length - 1];
      await sendMessage('SAVE_CACHED_TOPIC', {
        url: topic.url,
        title: topicInfo.value!.title,
        version: topicInfo.value!.version,
        posts,
        summary: summaryText,
        lastPostNumber: lastPost?.postNumber ?? 0,
        totalPosts: posts.length,
        totalPages: topicInfo.value!.pageCount,
      }).catch(() => {});
      return; // KHÔNG modify refs (summary, loadingText, store)
    }
    // ▲▲▲ END stale guard ▲▲▲

    summary.value = summaryText;
    summarizedPostCount.value = posts.length;

    const lastPost = posts[posts.length - 1];
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: topic.url,
      title: topicInfo.value.title,
      version: topicInfo.value.version,
      posts,
      summary: summaryText,
      lastPostNumber: lastPost?.postNumber ?? 0,
      totalPosts: posts.length,
      totalPages: topicInfo.value.pageCount,
    });
    store.updateSelectedTopic({ summary: summaryText, posts, totalPosts: posts.length, totalPages: topicInfo.value.pageCount });

    const saved = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (saved) cachedTopic.value = saved;
    cacheFreshness.value = 'fresh';
  } catch (err) {
    if (thisId !== activeSummarizeId) return;    // ← THÊM: không hiện error nếu đã stale
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (thisId === activeSummarizeId) {           // ← SỬA: chỉ clear khi còn active
      store.setSummarizing(null);
      loadingText.value = '';
    } else {
      // Stale: chỉ clear summarizingUrl, KHÔNG clear loadingText
      store.setSummarizing(null);
    }
  }
}
```

#### Bước 4: Guard tương tự trong `handleSummarizeSegment()`

Sửa `handleSummarizeSegment()` (dòng 500):

```ts
async function handleSummarizeSegment(segmentIndex: number) {
  const seg = segments.value[segmentIndex];
  if (!seg || !topicInfo.value) return;
  const topic = store.selectedTopic.value!;

  error.value = '';
  scrapingWarnings.value = [];
  const thisId = ++activeSummarizeId;    // ← THÊM
  store.setSummarizing(topic.url);

  try {
    // ... (giữ nguyên phần findForumTab, scraping) ...

    loadingText.value = `Đang tóm tắt ${seg.label} (${segPosts.length} bài)...`;
    const result = await sendMessage<{ summary?: string; error?: string }>('SUMMARIZE', segPosts);
    if (result.error) throw new Error(result.error);

    // ▼▼▼ THÊM stale guard ▼▼▼
    if (thisId !== activeSummarizeId) {
      // Vẫn lưu segment vào cache
      const newSeg: TopicSegment = { startPage: seg.start, endPage: seg.end, posts: segPosts, summary: result.summary ?? '', postCount: segPosts.length, summarizedAt: Date.now() };
      const count = Math.max(segmentSummaries.value.length, segmentIndex + 1);
      const updated = Array.from({ length: count }, (_, i) => segmentSummaries.value[i] ?? null) as TopicSegment[];
      updated[segmentIndex] = newSeg;
      await sendMessage('SAVE_CACHED_TOPIC', { url: topic.url, segments: updated }).catch(() => {});
      return;
    }
    // ▲▲▲ END stale guard ▲▲▲

    // ... (giữ nguyên phần cập nhật segmentSummaries, save cache, store) ...
  } catch (err) {
    if (thisId !== activeSummarizeId) return;    // ← THÊM
    error.value = err instanceof Error ? err.message : String(err);
    isScraping.value = false;
    currentScrapeTabId.value = null;
  } finally {
    if (thisId === activeSummarizeId) {           // ← SỬA
      store.setSummarizing(null);
      loadingText.value = '';
    } else {
      store.setSummarizing(null);
    }
  }
}
```

#### Bước 5: Guard tương tự trong `generateOverallSummary()`

Sửa `generateOverallSummary()` (dòng 565):

```ts
async function generateOverallSummary() {
  const topic = store.selectedTopic.value;
  if (!topic) return;

  const completedSegments = segmentSummaries.value.filter(s => s?.summary);
  if (completedSegments.length < 2) {
    error.value = 'Cần ít nhất 2 phần đã tóm tắt để tạo tóm tắt tổng quan.';
    return;
  }

  const thisId = ++activeSummarizeId;    // ← THÊM
  store.setSummarizing(topic.url);
  loadingText.value = 'Đang tạo tóm tắt tổng quan...';

  try {
    // ... (giữ nguyên phần tạo segmentPosts) ...

    const result = await sendMessage<{ summary?: string; error?: string }>('SUMMARIZE', segmentPosts);
    if (result.error) throw new Error(result.error);

    // ▼▼▼ THÊM stale guard ▼▼▼
    if (thisId !== activeSummarizeId) {
      await sendMessage('SAVE_CACHED_TOPIC', { url: topic.url, summary: result.summary }).catch(() => {});
      return;
    }
    // ▲▲▲ END stale guard ▲▲▲

    summary.value = result.summary ?? '';
    // ... (giữ nguyên phần save cache, store) ...
  } catch (err) {
    if (thisId !== activeSummarizeId) return;    // ← THÊM
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (thisId === activeSummarizeId) {           // ← SỬA
      store.setSummarizing(null);
      loadingText.value = '';
    } else {
      store.setSummarizing(null);
    }
  }
}
```

#### Bước 6: Fix `isSummarizingThisTopic` logic trong `onActivated`

Logic hiện tại (dòng 185-187) khớp SAI khi mở topic B mà topic A đang tóm tắt (vì check `loadedTopicUrl` cũ):

```ts
// TRƯỚC (lỗi logic):
const isSummarizingThisTopic =
  store.summarizingUrl.value !== null &&
  (isSameTopicUrl(store.summarizingUrl.value, url) ||
    isSameTopicUrl(store.summarizingUrl.value, loadedTopicUrl.value ?? ''));
```

Sửa: chỉ check `summarizingUrl` vs `url` (topic đang được chọn), BỎ check `loadedTopicUrl`:

```ts
// SAU:
const isSummarizingThisTopic =
  store.summarizingUrl.value !== null &&
  isSameTopicUrl(store.summarizingUrl.value, url);
```

Bỏ check `loadedTopicUrl` vì nó gây false positive: khi mở topic B, `loadedTopicUrl` vẫn là topic A → `isSummarizingThisTopic = true` cho topic B.

---

## Tóm tắt thay đổi

| Vị trí | Thay đổi |
|--------|----------|
| Dòng ~42 | Thêm `let activeSummarizeId = 0` |
| `loadTopicData()` | Thêm `activeSummarizeId++` ở đầu reset block |
| `confirmSummarize()` | `thisId = ++activeSummarizeId` + stale guard sau mỗi `await sendMessage` LLM + conditional finally |
| `handleSummarizeSegment()` | Tương tự `confirmSummarize()` |
| `generateOverallSummary()` | Tương tự `confirmSummarize()` |
| `onActivated` | Bỏ `isSameTopicUrl(summarizingUrl, loadedTopicUrl)` khỏi `isSummarizingThisTopic` |

Chỉ sửa 1 file: `entrypoints/sidepanel/views/SummaryView.vue`

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. **Kịch bản chính:** Topic A đang tóm tắt → list → topic B → list → topic A → loading hiện đúng, không mất
3. **LLM xong khi đang xem topic B:** topic B không bị ghi đè summary của topic A; quay lại topic A → load từ cache → hiện tóm tắt
4. **LLM xong khi đang xem topic A:** loading biến mất, tóm tắt hiện bình thường
5. **Topic B không hiện loading sai:** khi mở topic B trong lúc topic A đang tóm tắt → chỉ hiện tóm tắt B, không có loading
6. **Error khi đã chuyển topic:** không hiện error sai cho topic đang xem
7. **Segment mode:** tương tự — stale guard hoạt động đúng cho handleSummarizeSegment và generateOverallSummary
