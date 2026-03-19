# Feature 09: Detect thread only, Topic Hub search/sort, Opinion bars, Fix OpinionsView cache

## Tổng quan
4 tính năng cải thiện UX: (1) chỉ detect trang bài viết cụ thể, không detect trang danh sách, (2) tìm kiếm + sắp xếp trong Topic Hub, (3) thanh bar tỷ lệ quan điểm trong tóm tắt, (4) fix không xem lại được ý kiến đã phân tích.

---

## Task 1: Chỉ detect khi truy cập bài viết cụ thể (không detect trang danh sách)

### Phân tích hiện trạng

Content script (`entrypoints/content/index.ts`) detect XenForo version ngay khi load:
```typescript
const version = detectXenForoVersion(); // runs at page load
```

`detectXenForoVersion()` (`lib/detector.ts`) chỉ check xem có phải XenForo hay không, **không phân biệt** trang danh sách (forum index, thread list) và trang bài viết cụ thể (thread view). Kết quả:
- Mở `otofun.net/forums/` (danh sách) → detect thành công → sidepanel hiện topic sai
- Mở `otofun.net/threads/abc.123/` → detect thành công → sidepanel hiện topic đúng

### Cách phân biệt

**XenForo 2:**
- Trang thread: URL chứa `/threads/`, có `h1.p-title-value`, có `article.message`, có `dl.count--replies`
- Trang list: URL là `/forums/`, `/`, không có `dl.count--replies`, danh sách dùng `div.structItem`

**XenForo 1:**
- Trang thread: URL chứa `/threads/`, có `li.message .messageText`
- Trang list: URL là `/forums/`, danh sách dùng khác cấu trúc

**Đáng tin cậy nhất:** Kiểm tra DOM element đặc trưng cho thread view, vì URL pattern có thể khác nhau tùy forum.

### Fix

#### File: `entrypoints/content/index.ts`

**1a. Thêm hàm `isThreadPage()`:**

```typescript
function isThreadPage(version: 'xf1' | 'xf2'): boolean {
  if (version === 'xf2') {
    // XF2: thread pages have individual post articles AND reply count indicator
    return !!(
      document.querySelector('article.message') &&
      (document.querySelector('dl.count--replies') || document.querySelector('.p-title-value'))
    );
  }
  // XF1: thread pages have message list items with message text
  return !!(
    document.querySelector('li.message .messageText') ||
    document.querySelector('#messageList .message')
  );
}
```

**1b. Gate DETECT_XF response:**

Sửa handler `DETECT_XF` (dòng 19-33):

```typescript
if (message.type === 'DETECT_XF') {
  // Only respond for individual thread pages, not forum/list pages
  if (!isThreadPage(version)) {
    sendResponse(undefined);
    return false;
  }

  const scraper = createScraper();
  const result: DetectResult = {
    version,
    title: document.title,
    postCount: scraper?.getPostCount() ?? 0,
    pageCount: scraper?.getPageCount() ?? 1,
  };
  const titleEl = document.querySelector('h1.p-title-value, .titleBar h1');
  if (titleEl?.textContent?.trim()) {
    result.title = titleEl.textContent.trim();
  }
  sendResponse(result);
  return false;
}
```

**1c. Cũng gate `SCRAPE_TOPIC` và `SCRAPE_ALL_PAGES`:**

Thêm check `isThreadPage(version)` tương tự trước khi scrape, hoặc dựa vào consumer (App.vue) đã check DETECT_XF trước. **Khuyến nghị:** chỉ cần gate ở DETECT_XF — SCRAPE chỉ được gọi sau khi DETECT thành công.

**1d. Giữ detection level ban đầu:**

`detectXenForoVersion()` vẫn chạy ở page load để set `version`. `isThreadPage()` chỉ filter ở response level — content script vẫn sẵn sàng trả lời cho mọi trang XenForo (phòng trường hợp SPA navigate từ list → thread mà không reload).

### Lưu ý edge case
- Forum dùng custom URL scheme (vd: `example.com/post/123` thay vì `/threads/`) → DOM check đáng tin hơn URL check
- Trang thread preview/popup: có thể không có `dl.count--replies` → fallback check `article.message` + `h1.p-title-value` đủ an toàn

---

## Task 2: Topic Hub — Tìm kiếm và Sắp xếp

### Phân tích hiện trạng

`TopicHubView.vue` hiện tại:
- Load toàn bộ cached topics qua `GET_ALL_CACHED_TOPICS`
- Group theo domain (hostname), sort mỗi group theo `cachedAt` giảm dần
- Không có UI tìm kiếm hoặc sắp xếp

### File: `entrypoints/sidepanel/views/TopicHubView.vue`

**2a. Thêm state cho search + sort:**

```typescript
const searchQuery = ref('');
const sortBy = ref<'recent' | 'posts' | 'title'>('recent');
```

**2b. Thêm computed `filteredTopics`:**

```typescript
const filteredTopics = computed(() => {
  let topics = [...allTopics.value];

  // Filter by search query
  const query = searchQuery.value.trim().toLowerCase();
  if (query) {
    topics = topics.filter(t =>
      t.title.toLowerCase().includes(query) ||
      t.url.toLowerCase().includes(query)
    );
  }

  // Sort
  switch (sortBy.value) {
    case 'recent':
      topics.sort((a, b) => b.cachedAt - a.cachedAt);
      break;
    case 'posts':
      topics.sort((a, b) => b.totalPosts - a.totalPosts);
      break;
    case 'title':
      topics.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
      break;
  }

  return topics;
});
```

**2c. Sửa computed `groupedTopics` — dùng `filteredTopics` thay vì `allTopics`:**

```typescript
const groupedTopics = computed(() => {
  const groups = new Map<string, CachedTopic[]>();
  for (const topic of filteredTopics.value) {
    const hostname = new URL(topic.url).hostname;
    if (!groups.has(hostname)) groups.set(hostname, []);
    groups.get(hostname)!.push(topic);
  }
  // Sort groups alphabetically
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
});
```

**Lưu ý:** Khi `sortBy !== 'recent'`, topics trong mỗi group đã được sort bởi `filteredTopics` → KHÔNG sort lại theo `cachedAt` trong group. Nếu muốn giữ group sort riêng biệt: sort trong `groupedTopics` thay vì `filteredTopics`.

**2d. Thêm search + sort UI trong template:**

Đặt sau `<h2>` header, trước phần topic listing:

```html
<!-- Search + Sort controls -->
<div class="space-y-2 mb-3">
  <!-- Search input -->
  <div class="relative">
    <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-(--color-text-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
    <input
      v-model="searchQuery"
      type="text"
      placeholder="Tìm kiếm topic..."
      class="input pl-8 text-xs w-full"
    />
  </div>

  <!-- Sort selector -->
  <div class="flex items-center gap-2 text-xs">
    <span class="text-(--color-text-secondary)">Sắp xếp:</span>
    <button
      v-for="option in [
        { value: 'recent', label: 'Mới nhất' },
        { value: 'posts', label: 'Nhiều bài' },
        { value: 'title', label: 'Tên A-Z' },
      ]"
      :key="option.value"
      class="px-2 py-0.5 rounded-full transition-colors"
      :class="sortBy === option.value
        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-medium'
        : 'text-(--color-text-secondary) hover:text-(--color-text-primary) hover:bg-(--color-bg-muted)'"
      @click="sortBy = option.value as typeof sortBy"
    >
      {{ option.label }}
    </button>
  </div>
</div>
```

**2e. Hiện empty state khi search không có kết quả:**

```html
<div
  v-if="searchQuery && filteredTopics.length === 0"
  class="text-center py-6"
>
  <p class="text-xs text-(--color-text-muted)">
    Không tìm thấy topic nào khớp "{{ searchQuery }}"
  </p>
</div>
```

---

## Task 3: Thanh bar tỷ lệ cho quan điểm nổi bật trong tóm tắt

### Phân tích

**SUMMARY_PROMPT** (`lib/prompts.ts`) yêu cầu LLM output markdown:
```
## Quan điểm nổi bật
### Tên quan điểm 1
Nội dung...
### Tên quan điểm 2
Nội dung...
```

**SummaryContent.vue** parse `### ` headers thành accordion items. Hiện KHÔNG có thông tin tỷ lệ (bao nhiêu người ủng hộ mỗi quan điểm).

### Giải pháp: Yêu cầu LLM include supporter count + parse để render bar

**Ý tưởng:** Sửa prompt để LLM ghi số người ủng hộ mỗi quan điểm ngay trong header. Parse số đó trong SummaryContent. Tính phần trăm. Render bar.

Format mới:
```
### Ủng hộ việc A (15 người)
Nội dung...
### Phản đối việc A (8 người)
Nội dung...
```

Fallback graceful: nếu LLM không include `(N người)`, hiển thị như cũ (không có bar).

### File: `lib/prompts.ts`

**3a. Sửa SUMMARY_PROMPT (dòng 14-18):**

Thay:
```
## Quan điểm nổi bật
### Tên/mô tả quan điểm 1
Nội dung chi tiết, ghi rõ tác giả nếu có.
### Tên/mô tả quan điểm 2
Nội dung chi tiết, ghi rõ tác giả nếu có.
```

Thành:
```
## Quan điểm nổi bật
### Tên/mô tả quan điểm 1 (N người ủng hộ)
Nội dung chi tiết, ghi rõ tác giả nếu có.
### Tên/mô tả quan điểm 2 (M người ủng hộ)
Nội dung chi tiết, ghi rõ tác giả nếu có.

Trong đó N, M là số lượng tác giả ủng hộ quan điểm đó dựa trên bài viết.
```

**3b. Áp dụng tương tự cho INCREMENTAL_UPDATE_PROMPT và REDUCE_SUMMARY_PROMPT.**

### File: `entrypoints/sidepanel/components/SummaryContent.vue`

**3c. Parse supporter count từ opinion title:**

Sửa logic parse opinions (dòng 34-44):

```typescript
interface OpinionItem {
  title: string;
  body: string;
  supporterCount: number | null;  // null = LLM không include count
}

// In the opinions parsing block:
const opinions: OpinionItem[] = opinionParts.map((op) => {
  const [opTitle, ...opRest] = op.split('\n');
  const rawTitle = opTitle.trim();

  // Parse "(N người)" or "(N người ủng hộ)" from title
  const countMatch = rawTitle.match(/\((\d+)\s*người[^)]*\)\s*$/);
  const supporterCount = countMatch ? parseInt(countMatch[1], 10) : null;
  // Remove the count suffix from display title
  const title = countMatch ? rawTitle.replace(/\s*\(\d+\s*người[^)]*\)\s*$/, '').trim() : rawTitle;

  return {
    title,
    body: opRest.join('\n').trim(),
    supporterCount,
  };
});
```

**3d. Tính phần trăm:**

```typescript
// Compute total supporters for percentage calculation
const totalSupporters = opinions.reduce((sum, op) => sum + (op.supporterCount ?? 0), 0);
```

Return `{ title, body: '', opinions, totalSupporters }` từ section.

**3e. Update Section interface:**

```typescript
interface Section {
  title: string;
  body: string;
  opinions?: OpinionItem[];
  totalSupporters?: number;
}
```

**3f. Render bar trong template:**

Sửa opinions accordion block (dòng 77-85):

```html
<!-- Opinions with optional percentage bars -->
<div v-if="section.opinions" class="space-y-2">
  <AccordionItem
    v-for="(opinion, j) in section.opinions"
    :key="j"
  >
    <template #title>
      <div class="w-full">
        <div class="flex items-center justify-between mb-1">
          <span class="font-medium text-sm">{{ opinion.title }}</span>
          <span
            v-if="opinion.supporterCount !== null"
            class="text-xs text-(--color-text-secondary) ml-2 shrink-0"
          >
            {{ opinion.supporterCount }} người
          </span>
        </div>
        <!-- Percentage bar -->
        <div
          v-if="opinion.supporterCount !== null && section.totalSupporters"
          class="w-full h-1.5 bg-(--color-bg-muted) rounded-full overflow-hidden"
        >
          <div
            class="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all duration-300"
            :style="{ width: Math.round((opinion.supporterCount / section.totalSupporters) * 100) + '%' }"
          />
        </div>
      </div>
    </template>
    <MarkdownContent :content="opinion.body" />
  </AccordionItem>
</div>
```

**3g. Sửa AccordionItem để hỗ trợ named slot `#title`:**

Kiểm tra `AccordionItem.vue`. Nếu hiện chỉ dùng prop `title` (string), cần thêm named slot `#title` để render custom HTML:

```html
<!-- AccordionItem.vue -->
<div @click="toggle" class="...">
  <slot name="title">
    <span>{{ title }}</span>
  </slot>
  <svg ...chevron... />
</div>
```

Nếu AccordionItem đã hỗ trợ slot `#title` → không cần sửa.

### Fallback khi LLM không include count

Nếu `supporterCount === null` cho tất cả opinions → `totalSupporters = 0` → `v-if` ẩn bar → hiển thị như cũ. **Graceful degradation.**

---

## Task 4: Fix OpinionsView không hiển thị lại ý kiến đã phân tích

### Phân tích root cause

`OpinionsView.vue` có cùng bug pattern với SummaryView (đã fix ở `fix-stale-summary-on-topic-switch`):

**Bug 1: Không reset state khi chuyển topic**

`loadTopicData()` (dòng 42-55) chỉ **gán** `opinions.value` khi `topic.opinions` tồn tại, nhưng **không reset** khi topic mới chưa có opinions:
```typescript
if (topic.opinions) opinions.value = topic.opinions;  // ← set nếu có
// Nếu topic.opinions = undefined → opinions.value GIỮ NGUYÊN giá trị cũ
```

Kết quả: chọn topic A (có opinions) → chọn topic B (chưa có) → hiện opinions của A cho topic B.

**Bug 2: `onActivated` skip khi quay lại cùng topic**

```typescript
onActivated(async () => {
  const url = store.selectedTopic.value?.url;
  if (url && url !== loadedTopicUrl.value) await loadTopicData();
});
```

Nếu user phân tích opinions cho topic A, navigate đi chỗ khác rồi quay lại cùng topic A → `url === loadedTopicUrl.value` → `loadTopicData()` KHÔNG chạy. Nếu opinions đã có trong ref → hiển thị đúng. Nhưng nếu `opinions.value` bị reset bởi logic khác → mất data.

### Fix

### File: `entrypoints/sidepanel/views/OpinionsView.vue`

**4a. Reset state ở đầu `loadTopicData()`:**

Sửa `loadTopicData()` (dòng 42-55):

```typescript
async function loadTopicData() {
  const topic = store.selectedTopic.value;
  if (!topic) return;

  // === RESET all view state for new topic ===
  opinions.value = null;
  cachedTopic.value = null;
  // error is managed by useLLM composable, no need to reset
  // === END RESET ===

  loadedTopicUrl.value = topic.url;
  cachedTopic.value = topic as CachedTopic;
  if (topic.opinions) opinions.value = topic.opinions;
  try {
    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (fresh) {
      cachedTopic.value = fresh;
      if (fresh.opinions) opinions.value = fresh.opinions;
    }
  } catch { /* no cache */ }
}
```

**4b. Cải thiện `onActivated` — luôn reload khi topic thay đổi hoặc khi cần refresh cache:**

Giữ nguyên logic hiện tại. Block reset ở 4a đủ để fix bug stale state.

Nếu muốn thêm tính năng "refresh opinions khi quay lại tab":

```typescript
onActivated(async () => {
  const url = store.selectedTopic.value?.url;
  if (!url) return;
  if (url !== loadedTopicUrl.value) {
    await loadTopicData();
  } else {
    // Same topic — refresh from cache in case opinions were updated elsewhere
    try {
      const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', url);
      if (fresh) {
        cachedTopic.value = fresh;
        if (fresh.opinions) opinions.value = fresh.opinions;
      }
    } catch { /* ignore */ }
  }
});
```

Điều này đảm bảo: nếu user phân tích opinions rồi navigate đi quay lại, cache được refresh (phòng trường hợp data được update ở nơi khác).

---

## Thứ tự triển khai

```
Task 4 (fix OpinionsView) — bug fix đơn giản, làm trước
Task 1 (detect thread only) — sửa content script, độc lập
Task 2 (search + sort) — sửa TopicHubView, độc lập
Task 3 (opinion bars) — sửa prompt + 2 components, phức tạp nhất
```

---

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. **Detect thread only:**
   - Mở `otofun.net/forums/` (danh sách forum) → extension KHÔNG detect → sidepanel hiện empty state
   - Mở `otofun.net/threads/abc.123/` (bài viết cụ thể) → detect thành công → hiện topic info
   - Mở trang chủ forum → không detect
3. **Search:**
   - Gõ text vào ô tìm kiếm → danh sách topic filter real-time
   - Search không có kết quả → hiện "Không tìm thấy..."
   - Xóa search → hiện lại toàn bộ
4. **Sort:**
   - "Mới nhất" → sort theo cachedAt giảm dần (default)
   - "Nhiều bài" → topic nhiều bài nhất lên trên
   - "Tên A-Z" → sort theo title alphabetically
5. **Opinion bars:**
   - Tóm tắt 1 topic → phần "Quan điểm nổi bật" hiện tên + số người + thanh bar %
   - Thanh bar tỷ lệ đúng (vd: 15/25 = 60%)
   - Nếu LLM không trả về count → hiện như cũ (không bar)
6. **OpinionsView cache:**
   - Phân tích ý kiến topic A → chuyển sang topic B → quay lại topic A → thấy lại ý kiến đã phân tích
   - Chuyển từ topic có opinions sang topic chưa có → hiện empty state + nút "Phân tích Ý kiến"
