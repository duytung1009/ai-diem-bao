# Refactor TopicMeta + TopicHubView Cards — Hiển thị thông tin nhất quán

**File:** `planning/20260422_1706_refactor-topic-meta-fields.md`
**Tier:** Tier 2 — Standard (3 files + 1 component + 1 utility, không đụng logic core)

---

## Objective & Scope

Refactor `TopicMeta.vue` và topic cards trong `TopicHubView.vue` để hiển thị thông tin nhất quán và đầy đủ hơn:

1. Tách biệt rõ ràng: "Tổng bài viết" (`totalPosts`) vs "Đã tóm tắt" (`summarizedPostCount`)
2. Thêm trạng thái tóm tắt: Chưa / Đang / Đã / Tóm tắt một phần — đồng nhất ở cả 2 nơi
3. Thêm timestamp tóm tắt (`cachedAt`) ở TopicMeta
4. Đổi prop `info: DetectResult` → `topic: CachedTopic` (single source of truth)
5. Extract `topicSummaryStatus()` helper — shared logic tránh duplicate

**Không trong scope:** OpinionsView internal state, CacheIndicator, logic scrape/summarize.

---

## Affected Modules

| File | Thay đổi |
|------|---------|
| `lib/topic-utils.ts` | **Tạo mới** — `topicSummaryStatus()`, `formatTopicDate()` shared helpers |
| `entrypoints/sidepanel/components/TopicMeta.vue` | Rewrite props + template |
| `entrypoints/sidepanel/App.vue` | Cập nhật computed + pass props mới |
| `entrypoints/sidepanel/views/OpinionsView.vue` | Pass `topic` thay vì `info` + `url` |
| `entrypoints/sidepanel/views/TopicHubView.vue` | Fix status badge + post count trong topic cards |

---

## Implementation Steps

### Step 1 — Cập nhật TopicMeta.vue props

**Thay:**
```ts
defineProps<{
  info: DetectResult;
  url?: string;
  isNews?: boolean;
}>()
```

**Thành:**
```ts
import type { CachedTopic } from '@/lib/types';

const props = defineProps<{
  topic: CachedTopic;
  livePostCount?: number;   // từ activeTabDetect nếu same URL
  isSummarizing?: boolean;  // từ store.summarizingUrl
}>();
```

### Step 2 — Derived computeds trong TopicMeta.vue

```ts
import { computed } from 'vue';

const isNews = computed(() => props.topic.topicType === 'news');

const summarizedPostCount = computed(() =>
  props.topic.summarizedPostCount ?? props.topic.totalPosts ?? 0,
);

const hasSummary = computed(() =>
  !!(props.topic.summary || props.topic.segments?.some(s => s?.summary)),
);

const isPartial = computed(() =>
  hasSummary.value && summarizedPostCount.value < (props.topic.totalPosts ?? 0),
);

// Status: 'none' | 'in-progress' | 'partial' | 'done'
const summaryStatus = computed(() => {
  if (props.isSummarizing) return 'in-progress';
  if (!hasSummary.value) return 'none';
  if (isPartial.value) return 'partial';
  return 'done';
});

// Format cachedAt: relative nếu < 24h, absolute nếu >= 24h
const summaryDateLabel = computed(() => {
  if (!hasSummary.value || !props.topic.cachedAt) return null;
  const diff = Date.now() - props.topic.cachedAt;
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'vừa xong';
  if (h < 24) return `${h} giờ trước`;
  const d = new Date(props.topic.cachedAt);
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
});

const newPostCount = computed(() =>
  props.livePostCount != null
    ? props.livePostCount - (props.topic.totalPosts ?? 0)
    : 0,
);
```

### Step 3 — Template mới

```html
<template>
  <div class="card">
    <!-- Row 1: Title + badge -->
    <div class="flex items-start justify-between gap-2">
      <h2 class="font-semibold text-sm text-(--color-text-primary) leading-snug">
        {{ topic.title }}
      </h2>
      <span v-if="isNews" class="badge bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-400 shrink-0">
        Tin tức
      </span>
    </div>

    <!-- Row 2: Metadata (totalPosts, totalPages, version) -->
    <div class="flex flex-wrap gap-3 mt-2 text-xs text-(--color-text-secondary)">
      <span>
        {{ topic.totalPosts }} bài viết
        <span v-if="newPostCount > 0" class="text-(--color-accent-text)">(+{{ newPostCount }} mới)</span>
      </span>
      <span>{{ topic.totalPages }} trang</span>
      <span
        class="uppercase font-mono px-1.5 py-0.5 rounded text-xs"
        :class="
          topic.version === 'xf2'
            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
            : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
        "
      >
        {{ topic.version }}
      </span>
    </div>

    <!-- Row 3: Summary status -->
    <div class="flex items-center gap-2 mt-2 text-xs">
      <!-- Chưa tóm tắt -->
      <span v-if="summaryStatus === 'none'"
        class="text-(--color-text-secondary)">
        Chưa tóm tắt
      </span>
      <!-- Đang tóm tắt -->
      <span v-else-if="summaryStatus === 'in-progress'"
        class="text-(--color-accent-text) animate-pulse">
        Đang tóm tắt...
      </span>
      <!-- Tóm tắt một phần -->
      <span v-else-if="summaryStatus === 'partial'"
        class="text-yellow-600 dark:text-yellow-400">
        Tóm tắt {{ summarizedPostCount }}/{{ topic.totalPosts }} bài
        <span v-if="summaryDateLabel" class="text-(--color-text-secondary) ml-1">· {{ summaryDateLabel }}</span>
      </span>
      <!-- Đã tóm tắt đầy đủ -->
      <span v-else
        class="text-green-600 dark:text-green-400">
        Đã tóm tắt {{ summarizedPostCount }} bài
        <span v-if="summaryDateLabel" class="text-(--color-text-secondary) ml-1">· {{ summaryDateLabel }}</span>
      </span>
    </div>

    <!-- Row 4: URL -->
    <button
      v-if="topic.url"
      class="mt-1.5 text-xs text-(--color-accent-text) hover:text-(--color-accent-hover) truncate max-w-full text-left"
      :title="topic.url"
      @click="navigateToTopic"
    >
      {{ topic.url }}
    </button>
  </div>
</template>
```

### Step 4 — Cập nhật App.vue

**Xóa** `topicInfo` computed hiện tại (trả `DetectResult`).

**Thêm** các computeds mới:

```ts
import { isSameTopicUrl } from '@/lib/cache-manager';

// Chỉ hiển thị TopicMeta khi có topic đã cache + đang ở topic-detail route
const selectedTopicForMeta = computed(() => 
  isTopicDetailRoute.value ? store.selectedTopic.value : null,
);

// Live post count: từ activeTabDetect nếu đang xem đúng thread
const livePostCount = computed(() => {
  const topic = store.selectedTopic.value;
  if (!topic) return undefined;
  if (store.activeTabDetect.value && store.activeTabUrl.value &&
      isSameTopicUrl(store.activeTabUrl.value, topic.url)) {
    return store.activeTabDetect.value.postCount;
  }
  return undefined;
});

const isSummarizingCurrentTopic = computed(() =>
  !!(store.summarizingUrl.value && store.selectedTopic.value &&
     isSameTopicUrl(store.summarizingUrl.value, store.selectedTopic.value.url)),
);
```

**Cập nhật** template:
```html
<!-- Thay: -->
<div v-if="topicInfo && isTopicDetailRoute" class="px-4 pt-4">
  <TopicMeta :info="topicInfo" :url="store.selectedTopic.value?.url" :is-news="isNewsTopic" />
</div>

<!-- Thành: -->
<div v-if="selectedTopicForMeta" class="px-4 pt-4">
  <TopicMeta
    :topic="selectedTopicForMeta"
    :live-post-count="livePostCount"
    :is-summarizing="isSummarizingCurrentTopic"
  />
</div>
```

**Xóa** (nếu không còn dùng chỗ nào khác trong App.vue):
- `topicInfo` computed
- `isNewsTopic` computed
- `hasSelectedTopic` computed (nếu không dùng)

### Step 0 — Tạo `lib/topic-utils.ts` (shared helpers)

Trước khi sửa component, extract 2 pure functions dùng chung ở cả TopicMeta và TopicHubView:

```ts
import type { CachedTopic } from './types';

export type TopicSummaryStatus = 'none' | 'in-progress' | 'partial' | 'done';

export function topicSummaryStatus(topic: CachedTopic, isSummarizing: boolean): TopicSummaryStatus {
  if (isSummarizing) return 'in-progress';
  const hasSummary = !!(topic.summary || topic.segments?.some(s => s?.summary));
  if (!hasSummary) return 'none';
  const summarized = topic.summarizedPostCount ?? topic.totalPosts ?? 0;
  if (summarized < (topic.totalPosts ?? 0)) return 'partial';
  return 'done';
}

// relative nếu < 24h, absolute nếu >= 24h (dùng cho cả TopicMeta và TopicHubView)
export function formatTopicDate(timestampMs: number): string {
  const diff = Date.now() - timestampMs;
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'vừa xong';
  if (h < 24) return `${h} giờ trước`;
  const d = new Date(timestampMs);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

> TopicHubView đã có `formatRelativeTime()` riêng — **thay thế** bằng `formatTopicDate()` để nhất quán.

---

### Step 5 — Cập nhật OpinionsView.vue

```html
<!-- Thay: -->
<TopicMeta v-if="topicInfo" :info="topicInfo" :url="store.selectedTopic.value?.url" />

<!-- Thành: -->
<TopicMeta v-if="store.selectedTopic.value" :topic="store.selectedTopic.value" />
```

Xóa import `DetectResult` nếu không còn dùng. Xóa `topicInfo` local computed nếu chỉ dùng cho TopicMeta.

### Step 6 — Cập nhật TopicHubView.vue topic cards

**Thêm import:**
```ts
import { topicSummaryStatus, formatTopicDate, type TopicSummaryStatus } from '@/lib/topic-utils';
```

**Xóa** hàm `formatRelativeTime()` local (thay bằng `formatTopicDate`).

**Topic card status badge** (thay block `v-if/v-else-if/v-else` hiện tại ở lines ~328–345):

```html
<!-- Status badge — dùng topicSummaryStatus() helper -->
<span v-if="isSameTopicUrl(store.summarizingUrl.value, topic.url)"
  class="badge bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 animate-pulse"
>
  ⟳ Đang tóm tắt...
</span>
<span v-else-if="topicSummaryStatus(topic, false) === 'done'"
  class="badge badge-success"
>
  ✓ Đã tóm tắt
</span>
<span v-else-if="topicSummaryStatus(topic, false) === 'partial'"
  class="badge bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
>
  ~ Một phần
</span>
<span v-else class="badge badge-neutral">
  ○ Chưa tóm tắt
</span>
```

> Gọi `topicSummaryStatus(topic, false)` vì `isSummarizing` đã check riêng ở điều kiện đầu.

**Post count** (line ~347): đổi từ `topic.totalPosts` thành hiển thị đúng ngữ cảnh:
```html
<!-- Thay: -->
<span class="text-xs text-(--color-text-muted)">{{ topic.totalPosts }} bài</span>

<!-- Thành: -->
<span class="text-xs text-(--color-text-muted)">
  <template v-if="topicSummaryStatus(topic, false) === 'partial'">
    {{ topic.summarizedPostCount ?? topic.totalPosts }}/{{ topic.totalPosts }} bài
  </template>
  <template v-else>{{ topic.totalPosts }} bài</template>
</span>
```

**Time** (line ~349): thay `formatRelativeTime(topic.cachedAt)` → `formatTopicDate(topic.cachedAt)`.

**News badge**: thêm vào sau post count nếu `topic.topicType === 'news'`:
```html
<span v-if="topic.topicType === 'news'"
  class="badge bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-400"
>
  Tin tức
</span>
```

---

## Edge Cases

| Case | Xử lý |
|------|-------|
| `summarizedPostCount` undefined (topic cũ) | Fallback về `totalPosts` |
| `cachedAt` = 0 hoặc undefined | `summaryDateLabel` = null, không hiển thị |
| `livePostCount < totalPosts` (detect count nhỏ hơn cache) | `newPostCount <= 0`, không hiển thị "(+X mới)" |
| Topic đang summarize lần đầu (chưa có summary) | `summaryStatus = 'in-progress'` vẫn đúng vì `isSummarizing = true` |
| Segments: chỉ một số segment đã tóm tắt | `summarizedPostCount` từ `summarizedPostCount` field phản ánh đúng |
| `formatRelativeTime` bị xóa nhưng còn dùng chỗ khác | Kiểm tra toàn bộ TopicHubView.vue trước khi xóa |
| TopicHubView gọi `topicSummaryStatus` trong template 2 lần per-topic | Chấp nhận được — pure function, không có side effect; nếu cần tối ưu → precompute trong `groupedTopics` |

---

## Decision Log

### Quyết định 1: Chuyển từ `DetectResult` sang `CachedTopic` cho prop chính
- **Đã chọn:** Nhận `CachedTopic` trực tiếp làm prop duy nhất
- **Lý do:** `CachedTopic` có đủ tất cả data cần thiết (title, url, version, totalPosts, totalPages, summarizedPostCount, cachedAt, topicType, segments); không cần tạo adapter object trung gian; giảm prop drilling
- **Đã cân nhắc nhưng loại:**
  - Giữ `DetectResult` + thêm optional props → awkward, nhiều props rời rạc, mỗi lần thêm field phải cập nhật cả 3 nơi
- **Điều kiện thay đổi:** Nếu TopicMeta cần hiển thị ở context không có CachedTopic (preview trước khi cache) → cần Union prop type

### Quyết định 2: `livePostCount` computed ở App.vue (không từ SummaryView)
- **Đã chọn:** Duplicate logic nhỏ (isSameTopicUrl + activeTabDetect) tại App.vue
- **Lý do:** App.vue là parent trực tiếp mount TopicMeta; SummaryView là sibling không phải parent; tránh lifting state phức tạp
- **Đã cân nhắc nhưng loại:**
  - Extract vào composable dùng chung → overkill cho 3 dòng code, tạo abstraction không cần thiết
- **Điều kiện thay đổi:** Nếu logic livePostCount phức tạp hơn hoặc cần ở >3 chỗ → extract composable

### Quyết định 3: Format ngày — relative < 24h, absolute >= 24h
- **Đã chọn:** "vừa xong" / "X giờ trước" / "dd/MM/yyyy HH:mm"
- **Lý do:** Relative hữu ích khi mới tóm tắt; absolute đảm bảo luôn đúng bất kể thời điểm mở extension
- **Đã cân nhắc nhưng loại:**
  - Chỉ absolute → kém thân thiện
  - Dùng Intl.RelativeTimeFormat → cần thêm logic chọn unit, không đáng
- **Điều kiện thay đổi:** Nếu cần i18n → extract `formatRelativeDate()` utility

### Quyết định 4: Trạng thái "Tóm tắt một phần" khi `summarizedPostCount < totalPosts`
- **Đã chọn:** So sánh `summarizedPostCount < totalPosts` để detect partial
- **Lý do:** `summarizedPostCount` được set chính xác sau mỗi segment hoàn thành; `totalPosts` là tổng bài biết tại thời điểm cache
- **Đã cân nhắc nhưng loại:**
  - Dùng segments array để detect → phức tạp hơn, cần check complete flags
- **Điều kiện thay đổi:** Nếu `summarizedPostCount` bị set sai do bug → revert về segment-based detection

### Quyết định 5: Extract `lib/topic-utils.ts` thay vì inline ở mỗi component
- **Đã chọn:** File utility nhỏ với 2 pure functions
- **Lý do:** Status logic giống hệt nhau ở TopicMeta (1 topic) và TopicHubView (N topics); không extract → khi fix bug phải sửa 2 chỗ; utility file đủ nhỏ không tạo overhead
- **Đã cân nhắc nhưng loại:**
  - Composable `useTopicStatus()` → overkill (không cần reactivity, chỉ cần pure function)
  - Inline mỗi nơi → duplicate logic dễ drift
- **Điều kiện thay đổi:** Nếu chỉ dùng 1 nơi → inline, xóa file utility
