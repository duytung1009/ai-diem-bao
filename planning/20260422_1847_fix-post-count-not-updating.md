# Fix: Tổng số bài viết không tự cập nhật khi phát hiện có bài mới

**File:** `planning/20260422_1847_fix-post-count-not-updating.md`
**Tier:** Tier 2 — Standard (3 files, không đụng logic summarize/scrape)

---

## Root Cause Analysis

### Bức tranh toàn cảnh

Có hai nơi hiển thị `(+X mới)`:
1. **TopicHubView** — inline `v-if` trong `v-for` loop (lines 355–360)
2. **TopicMeta** (qua App.vue) — prop `livePostCount` → computed `newPostCount`

Task trước (refactor-topic-meta-fields) đã làm đúng phần TopicMeta (App.vue), nhưng có 2 bugs còn lại.

---

### Bug 1 (PRIMARY): `v-if` inline trong `v-for` không phản ứng đúng với `activeTabDetect`

**File:** `entrypoints/sidepanel/views/TopicHubView.vue` lines 355–360

```vue
<span
  v-if="store.activeTabDetect.value && store.activeTabUrl.value &&
        isSameTopicUrl(store.activeTabUrl.value, topic.url) &&
        store.activeTabDetect.value.postCount > topic.totalPosts"
>
```

**Vấn đề:** `isSameTopicUrl` là một function call thuần, không cache. Trong vòng `v-for`, mỗi iteration gọi `isSameTopicUrl(...)` per-topic. Khi Vue re-render do `activeTabDetect` thay đổi, nó phải re-evaluate toàn bộ render function — nhưng Vue 3's block tree optimization có thể "hoist" các VNode ổn định trong `v-for` nếu không có patchFlag rõ ràng trên node đó.

Cụ thể: `topic` trong `v-for` là plain object (không reactive). Vue theo dõi `store.activeTabDetect.value` (reactive ref), nhưng khi patch danh sách `v-for`, nó so sánh VNode cũ và mới theo `:key`. Nếu key không thay đổi, Vue có thể bỏ qua re-evaluation của `v-if` condition phức tạp này trong một số trường hợp.

**Fix:** Extract thành computed `newPostsMap` — làm cho dependency tracking tường minh:

```typescript
const newPostsMap = computed<Record<string, number>>(() => {
  if (!store.activeTabDetect.value || !store.activeTabUrl.value) return {};
  const liveCount = store.activeTabDetect.value.postCount;
  const activeUrl = normalizeUrl(store.activeTabUrl.value);
  const result: Record<string, number> = {};
  for (const topic of allTopics.value) {
    if (normalizeUrl(topic.url) === activeUrl) {
      const delta = liveCount - topic.totalPosts;
      if (delta > 0) result[topic.url] = delta;
      break;
    }
  }
  return result;
});
```

Template (thay v-if phức tạp):
```vue
<span v-if="newPostsMap[topic.url]" class="text-(--color-accent-text) ml-0.5">
  (+{{ newPostsMap[topic.url] }} mới)
</span>
```

Khi `activeTabDetect` thay đổi → `newPostsMap` được recompute → Vue thấy computed thay đổi → re-renders đúng.

---

### Bug 2 (SECONDARY): `topicSummaryStatus` không biết về live count → badge sai

**File:** `lib/topic-utils.ts`, `entrypoints/sidepanel/views/TopicHubView.vue`

`topicSummaryStatus(topic, false)` so sánh `summarizedPostCount < totalPosts` (cả hai đều là cached values). Khi có 5 bài mới (live 50, cached 45), function không biết → trả `'done'` → badge vẫn hiển thị "✓ Đã tóm tắt".

**Fix:** Thêm optional param `livePostCount`:

```typescript
export function topicSummaryStatus(
  topic: CachedTopic,
  isSummarizing: boolean,
  livePostCount?: number,
): TopicSummaryStatus {
  if (isSummarizing) return 'in-progress';
  const hasSummary = !!(topic.summary || topic.segments?.some(s => s?.summary));
  if (!hasSummary) return 'none';
  const summarized = topic.summarizedPostCount ?? topic.totalPosts ?? 0;
  const effectiveTotalPosts = (livePostCount != null && livePostCount > (topic.totalPosts ?? 0))
    ? livePostCount
    : (topic.totalPosts ?? 0);
  if (summarized < effectiveTotalPosts) return 'partial';
  return 'done';
}
```

Trong TopicHubView, truyền `newPostsMap[topic.url]` vào:
```vue
topicSummaryStatus(topic, false, topic.totalPosts + (newPostsMap[topic.url] ?? 0))
```

Hoặc đơn giản hơn: truyền `livePostCount` từ `newPostsMap`:
```typescript
// Trong computed newPostsMap, lưu liveCount thay vì delta
// Và gọi: topicSummaryStatus(topic, false, livePostCounts[topic.url])
```

---

### Bug 3 (MINOR): `selectedTopicKey` không track `totalPosts`

**File:** `entrypoints/sidepanel/views/TopicHubView.vue` line 111

```typescript
return `${t.url}|${t.summary?.slice(0, 20) ?? ''}|${t.segments?.length ?? 0}|${t.bookmarked ?? false}|${t.knowledgeEntries?.length ?? 0}`;
```

`totalPosts` không có trong key. Nếu chỉ `totalPosts` thay đổi (ví dụ: sau khi re-summarize và IDB cập nhật), watcher không fire → `allTopics[idx].totalPosts` không sync từ `selectedTopic`.

**Fix:** Thêm `totalPosts` vào key:
```typescript
return `${t.url}|${t.summary?.slice(0, 20) ?? ''}|${t.segments?.length ?? 0}|${t.bookmarked ?? false}|${t.knowledgeEntries?.length ?? 0}|${t.totalPosts ?? 0}`;
```

---

## Data Flow Diagram (sau khi fix)

```
detectActiveTabTopic()
  → setActiveTab({ postCount: 50 }, url)
  → store.activeTabDetect.value = { postCount: 50, ... }  ← reactive ref changes

Vue tracks activeTabDetect dependency in newPostsMap computed
  → newPostsMap recomputes: { "https://forum.example.com/.../": 5 }
  → Vue sees computed changed
  → TopicHubView re-renders

Template per topic:
  → v-if="newPostsMap[topic.url]"  → 5 → true → shows "(+5 mới)"
  → topicSummaryStatus(topic, false, topic.totalPosts + 5) → 'partial'
  → badge: "~ Một phần" (đúng)
```

---

## Overview

Sau khi refactor-topic-meta-fields task, TopicMeta (trong detail views) hoạt động đúng nhờ `livePostCount` prop từ App.vue. Nhưng TopicHubView (hub cards) dùng inline `v-if` trong `v-for` — có thể không re-evaluate đúng do Vue 3's block tree optimization. Fix là extract thành computed explicit.

---

## Goals

- Hub card hiển thị `(+X mới)` ngay khi `activeTabDetect` cập nhật, không cần user action
- Status badge phản ánh đúng: có bài mới chưa tóm tắt → "~ Một phần"
- `allTopics[idx].totalPosts` sync đúng với `selectedTopic` khi totalPosts thay đổi

---

## Requirements

### TopicHubView.vue

- **Extract `newPostsMap` computed**: depend on `store.activeTabDetect`, `store.activeTabUrl`, `allTopics` → map `topic.url → delta`
- **Replace inline `v-if`** (lines 355–360) bằng `v-if="newPostsMap[topic.url]"`
- **Update `topicSummaryStatus` calls** để truyền `livePostCount` từ `newPostsMap`
- **Add `totalPosts` to `selectedTopicKey`** để watcher sync đúng

### lib/topic-utils.ts

- **Thêm optional `livePostCount?: number`** vào `topicSummaryStatus`
- Khi `livePostCount > totalPosts`, dùng `livePostCount` làm effective total trong so sánh partial

### TopicMeta.vue (verify, không thay đổi)

- Confirm `newPostCount = livePostCount - topic.totalPosts` đang work correctly
- Nếu `livePostCount` undefined → `newPostCount = 0` → không show indicator ✓

---

## Implementation Steps

### Step 1 — Cập nhật `topicSummaryStatus` trong `lib/topic-utils.ts`

Thêm optional param `livePostCount?: number`. Nếu `livePostCount > totalPosts`, dùng làm effective ceiling trong so sánh.

### Step 2 — Extract `newPostsMap` trong `TopicHubView.vue`

Thêm computed sau `activeTabInList`:
```typescript
const newPostsMap = computed<Record<string, number>>(() => {
  if (!store.activeTabDetect.value || !store.activeTabUrl.value) return {};
  const liveCount = store.activeTabDetect.value.postCount;
  const activeUrl = normalizeUrl(store.activeTabUrl.value);
  const result: Record<string, number> = {};
  for (const topic of allTopics.value) {
    if (normalizeUrl(topic.url) === activeUrl) {
      const delta = liveCount - topic.totalPosts;
      if (delta > 0) result[topic.url] = delta;
      break;  // Chỉ 1 topic match active tab
    }
  }
  return result;
});
```

### Step 3 — Cập nhật template trong `TopicHubView.vue`

**Thay indicator inline (lines 355–360):**
```vue
<!-- Thay: -->
<span v-if="store.activeTabDetect.value && store.activeTabUrl.value && ...complex condition...">

<!-- Thành: -->
<span v-if="newPostsMap[topic.url]" class="text-(--color-accent-text) ml-0.5">
  (+{{ newPostsMap[topic.url] }} mới)
</span>
```

**Cập nhật `topicSummaryStatus` calls** trong template để truyền live count:
```vue
topicSummaryStatus(topic, isSameTopicUrl(store.summarizingUrl.value, topic.url),
  topic.totalPosts + (newPostsMap[topic.url] ?? 0))
```

### Step 4 — Thêm `totalPosts` vào `selectedTopicKey`

```typescript
return `${t.url}|${t.summary?.slice(0, 20) ?? ''}|${t.segments?.length ?? 0}|${t.bookmarked ?? false}|${t.knowledgeEntries?.length ?? 0}|${t.totalPosts ?? 0}`;
```

---

## Edge Cases

| Case | Xử lý |
|------|-------|
| `livePostCount < totalPosts` (detect count nhỏ hơn cache — XF phân trang sai) | `delta < 0` → `newPostsMap` không set entry → không hiện indicator |
| Active tab không phải forum topic | `activeTabDetect = null` → `newPostsMap = {}` → no indicator |
| Topic không có trong `allTopics` (đang summarize lần đầu) | Loop không tìm thấy → `newPostsMap` empty → no indicator (OK, card chưa có) |
| `summarizingUrl` matches topic → status `'in-progress'` takes priority | `topicSummaryStatus` check `isSummarizing` first → correct |
| `livePostCount == totalPosts` (đã tóm tắt đúng số bài) | `delta = 0` → không set entry → no indicator → correct |
| `totalPosts = 0` (chưa có data) | `delta = liveCount - 0 = liveCount` → hiện indicator → acceptable |

---

## Test Plan

1. Mở forum tab có 50 bài (cached 45) → mở sidepanel → hub card hiện "(+5 mới)", badge "~ Một phần"
2. Chuyển sang tab khác → `activeTabDetect = null` → indicator ẩn
3. Chuyển lại forum tab → indicator hiện lại
4. Tóm tắt lại topic → `totalPosts` cache = 50 → indicator ẩn (delta = 0)
5. Hub card của topic KHÁC (không phải active tab) → không có indicator

---

## Decision Log

### Quyết định 1: Extract `newPostsMap` computed thay vì giữ inline `v-if`
- **Đã chọn:** Computed `newPostsMap` làm reactive bridge
- **Lý do:** Inline `v-if` trong `v-for` với complex condition dựa vào external reactive state bị Vue 3 block tree optimization ảnh hưởng. Computed tạo ra explicit reactive dependency, Vue biết chắc cần re-render khi computed thay đổi.
- **Đã cân nhắc nhưng loại:**
  - Giữ inline + thêm `watch(activeTabDetect, () => allTopics.value = [...allTopics.value])` để force re-render — dirty hack, gây re-render không cần thiết
  - `watch(activeTabDetect, (detect) => { update allTopics with totalPosts })` — thay đổi `allTopics` data để force update — làm mất ý nghĩa của `totalPosts` cached
- **Điều kiện thay đổi:** Nếu verify rằng inline `v-if` KHÔNG có issue reactivity → chỉ cần thêm livePostCount tracking, giữ inline

### Quyết định 2: `topicSummaryStatus` nhận optional `livePostCount`
- **Đã chọn:** Thêm optional param, backward compatible
- **Lý do:** Caller trong TopicHubView đã có `newPostsMap` → truyền vào free. TopicMeta.vue cũng có `props.livePostCount` có thể truyền vào. Giúp badge nhất quán với indicator.
- **Đã cân nhắc nhưng loại:**
  - Tính `effective livePostCount` ngay trong template (inline) — thêm complexity trong template không cần thiết
  - Không fix status badge — để 2 signals (badge và indicator) mâu thuẫn nhau
- **Điều kiện thay đổi:** Nếu business logic quyết định badge không cần phản ánh unread posts → revert param

### Quyết định 3: Thêm `totalPosts` vào `selectedTopicKey`
- **Đã chọn:** Include trong key string
- **Lý do:** `totalPosts` là field quan trọng hiển thị trong hub; khi nó thay đổi (sau summarize), `allTopics` cần sync ngay
- **Đã cân nhắc nhưng loại:**
  - Bỏ `selectedTopicKey` mechanism hoàn toàn, dùng `watch(store.selectedTopic, deep)` — quá broad, watch deep một object lớn ảnh hưởng performance
- **Điều kiện thay đổi:** Nếu `totalPosts` thay đổi quá thường xuyên gây watcher fire nhiều → bỏ khỏi key, dùng mechanism khác
