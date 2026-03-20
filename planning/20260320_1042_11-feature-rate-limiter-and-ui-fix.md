# Feature 11: Rate limiter, Segment size config, Fix UI tràn dòng, Cursor pointer

---

## Task 1: Rate limiter cấu hình được cho scraping

### Phân tích hiện trạng

`lib/scrapers/page-loader.ts` hiện có delay cứng:
```typescript
// scrapeAllPages — dòng 88-90
await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));

// scrapePageRange — dòng 177-179
await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
```

Delay 300-600ms quá nhanh, có thể bị rate limit bởi forum. User muốn mặc định 2s, có thể config trong Settings.

### Cơ chế

1. Thêm `scrapeDelayMs` vào settings (default 2000ms)
2. Truyền delay value từ SummaryView → content script qua message payload
3. `page-loader.ts` dùng delay từ parameter thay vì hardcoded

### File: `lib/types.ts`

**1a. Thêm `scrapeDelayMs` vào `LLMConfig` (hoặc tạo interface riêng):**

Vì `scrapeDelayMs` không liên quan đến LLM, tốt hơn nên thêm vào settings storage riêng. Tuy nhiên để đơn giản, mở rộng settings hiện có:

```typescript
// Thêm interface mới hoặc mở rộng existing settings
export interface AppSettings {
  llm: LLMConfig;
  scrapeDelayMs: number; // default 2000
}
```

**Hoặc đơn giản hơn:** Thêm `scrapeDelayMs` field vào STORAGE_KEYS settings object. Lưu chung với LLM settings.

### File: `lib/constants.ts`

**1b. Thêm default:**

```typescript
export const DEFAULT_SCRAPE_DELAY_MS = 2000;
```

### File: `lib/scrapers/page-loader.ts`

**1c. Thêm `delayMs` parameter cho cả 2 function:**

```typescript
export async function scrapeAllPages(
  version: XenForoVersion,
  baseUrl: string,
  totalPages: number,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  delayMs: number = 2000,   // ← thêm parameter
): Promise<MultiPageResult> {
  // ...
  // Dòng 88-90, thay:
  //   await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
  // thành:
  if (page < totalPages && !signal?.aborted) {
    const jitter = Math.random() * Math.min(delayMs * 0.3, 500); // jitter max 30% of delay or 500ms
    await new Promise((r) => setTimeout(r, delayMs + jitter));
  }
}

export async function scrapePageRange(
  version: XenForoVersion,
  baseUrl: string,
  startPage: number,
  endPage: number,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  delayMs: number = 2000,   // ← thêm parameter
): Promise<MultiPageResult> {
  // ...
  // Dòng 177-179, thay tương tự
  if (page < endPage && !signal?.aborted) {
    const jitter = Math.random() * Math.min(delayMs * 0.3, 500);
    await new Promise((r) => setTimeout(r, delayMs + jitter));
  }
}
```

### File: `entrypoints/content/index.ts`

**1d. Nhận `delayMs` từ message payload:**

Sửa handler `SCRAPE_ALL_PAGES` (dòng 51):
```typescript
if (message.type === 'SCRAPE_ALL_PAGES') {
  const { totalPages, delayMs } = message.payload as { totalPages: number; delayMs?: number };
  // ...
  scrapeAllPages(version, baseUrl, totalPages, onProgress, signal, delayMs ?? 2000)
}
```

Sửa handler `SCRAPE_PAGE_RANGE` (dòng 82):
```typescript
if (message.type === 'SCRAPE_PAGE_RANGE') {
  const { startPage, endPage, delayMs } = message.payload as { startPage: number; endPage: number; delayMs?: number };
  // ...
  scrapePageRange(version, baseUrl, startPage, endPage, onProgress, signal, delayMs ?? 2000)
}
```

### File: `entrypoints/sidepanel/views/SettingsView.vue`

**1e. Thêm UI config scrape delay:**

Trong section Settings (gần timeout config), thêm:

```html
<!-- Scrape delay -->
<div class="space-y-1">
  <label class="text-xs font-medium text-(--color-text-primary)">
    Delay giữa các lần tải trang (ms)
  </label>
  <p class="text-[11px] text-(--color-text-muted)">
    Khoảng cách giữa mỗi request khi đọc topic nhiều trang. Tăng lên nếu bị chặn bởi forum.
  </p>
  <input
    v-model.number="scrapeDelayMs"
    type="number"
    min="500"
    max="10000"
    step="500"
    class="input w-full"
  />
</div>
```

**1f. Lưu/load `scrapeDelayMs`:**

Lưu chung với LLM settings trong `browser.storage.sync`:

```typescript
const scrapeDelayMs = ref(2000);

// Trong loadSettings():
scrapeDelayMs.value = settings.scrapeDelayMs ?? 2000;

// Trong saveSettings():
await browser.storage.sync.set({
  [STORAGE_KEYS.SETTINGS]: JSON.stringify({
    ...currentSettings,
    scrapeDelayMs: scrapeDelayMs.value,
  }),
});
```

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**1g. Truyền `scrapeDelayMs` vào message khi scrape:**

Trong `scrapeInChunks()` hoặc bất cứ nơi nào gửi `SCRAPE_ALL_PAGES` / `SCRAPE_PAGE_RANGE`:

```typescript
// Load settings trước khi scrape
const settings = await sendMessage('GET_SETTINGS');
const delayMs = settings?.scrapeDelayMs ?? 2000;

// Truyền vào message payload
await browser.tabs.sendMessage(tabId, {
  type: 'SCRAPE_PAGE_RANGE',
  payload: { startPage, endPage, delayMs },
});
```

### File: `entrypoints/background/index.ts`

**1h. Expose `scrapeDelayMs` qua GET_SETTINGS:**

Kiểm tra handler `GET_SETTINGS` — nếu đã trả về toàn bộ settings object thì `scrapeDelayMs` sẽ tự động có. Nếu không, thêm field.

---

## Task 2: Fix UI tràn dòng ở block summary info (SummaryView dòng 775)

### Phân tích hiện trạng

Dòng 775-793:
```html
<div class="flex items-center justify-between">
  <div>📄 Đã tóm tắt N bài viết</div>
  <CacheIndicator ... />
</div>
```

Layout hiện tại: **1 dòng flex ngang** chứa:
- Bên trái: icon + "Đã tóm tắt 1234 bài viết"
- Bên phải: CacheIndicator = badge + timeAgo + button "Cập nhật (+N)"

Khi cả 2 bên đều dài (vd topic có nhiều bài + cache stale), nội dung tràn ra ngoài container → vỡ layout. CacheIndicator đặc biệt dài khi hiện đủ badge + time + button + count.

### Fix: Chuyển sang layout wrap

**Sửa dòng 775:**

```html
<div class="flex flex-wrap items-center justify-between gap-y-1.5 gap-x-3">
```

Thêm `flex-wrap` để items tự xuống dòng khi không đủ chỗ, `gap-y-1.5` cho khoảng cách dọc khi wrap, `gap-x-3` thay thế implicit gap từ `justify-between`.

**Đồng thời thêm `min-w-0` cho child bên trái để truncate nếu cần:**

```html
<div
  v-if="summarizedPostCount > 0"
  class="flex items-center gap-1.5 text-xs text-(--color-text-secondary) min-w-0"
>
  <svg class="w-3.5 h-3.5 shrink-0" ...>...</svg>
  <span class="truncate">Đã tóm tắt {{ summarizedPostCount }} bài viết</span>
</div>
```

- `min-w-0` cho phép flex child co lại
- `shrink-0` giữ icon không bị bóp
- `truncate` trên span — fallback nếu vẫn quá dài

**CacheIndicator cũng cần `flex-wrap`:**

### File: `entrypoints/sidepanel/components/CacheIndicator.vue`

Sửa container (dòng 52):

```html
<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
```

Cho phép badge + timeAgo + button tự wrap nếu container hẹp.

---

## Task 3: Thêm `cursor: pointer` cho tất cả button và link

### Phân tích hiện trạng

Nhiều button trong project không có `cursor: pointer` → user hover lên không thấy con trỏ tay, gây cảm giác không click được:

1. **`@utility btn`** (`assets/main.css`) — dùng bởi tất cả `btn btn-primary`, `btn btn-secondary`, `btn btn-sm`, `btn btn-danger` → thiếu `cursor: pointer`
2. **`@utility card-interactive`** — clickable card nhưng thiếu cursor
3. **Inline buttons** (không dùng class `btn`) — các nút như "← Quay lại danh sách", icon buttons (xóa, accordion toggle), sort pills trong TopicHubView
4. **Links** — `<router-link>`, `<a>` tags

### Fix: Global CSS rule + utility update

#### File: `assets/main.css`

**3a. Thêm `cursor: pointer` vào `@utility btn`:**

```css
@utility btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: theme(fontSize.sm);
  font-weight: 500;
  border-radius: theme(borderRadius.lg);
  cursor: pointer;                                    /* ← THÊM */
  transition-property: color, background-color, border-color;
  transition-duration: 150ms;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
```

`cursor: not-allowed` khi disabled đã có sẵn → override đúng.

**3b. Thêm `cursor: pointer` vào `@utility card-interactive`:**

```css
@utility card-interactive {
  /* ...existing... */
  cursor: pointer;                                    /* ← THÊM */
}
```

**3c. Thêm global rule cho tất cả button và anchor tags:**

Đặt ở cuối file, sau các `@utility` definitions:

```css
/* ─── Global interactive cursor ──────────────────── */
button:not(:disabled),
a,
[role="button"]:not(:disabled) {
  cursor: pointer;
}
```

Rule này cover:
- Tất cả `<button>` không disabled (kể cả inline buttons không dùng class `btn`)
- Tất cả `<a>` tags (router-link render thành `<a>`)
- Bất kỳ element nào có `role="button"` (accordion triggers, etc.)

**Lưu ý:** Rule global này là catch-all. `@utility btn` vẫn nên có `cursor: pointer` explicit để đảm bảo tính tự chứa (self-contained) của utility class.

---

## Task 4: Segment size cấu hình được (default 20 thay vì 100)

### Phân tích hiện trạng

`SummaryView.vue` dòng 38-39:
```typescript
const SEGMENT_SIZE = 100;      // mỗi segment bao nhiêu trang
const SEGMENT_THRESHOLD = 100; // bật segment mode khi > N trang
```

Cả 2 giá trị đều hardcoded = 100. User muốn:
- Default segment size = **20 trang** (thay vì 100)
- Cho phép config trong Settings
- `SEGMENT_THRESHOLD` cũng nên = segment size (bật segment mode khi topic > 1 segment)

### File: `lib/constants.ts`

**4a. Thêm default:**

```typescript
export const DEFAULT_SEGMENT_SIZE = 20;
```

### File: `entrypoints/sidepanel/views/SettingsView.vue`

**4b. Thêm UI config segment size:**

Đặt gần scrape delay config (cùng nhóm "Scraping"):

```html
<!-- Segment size -->
<div class="space-y-1">
  <label class="text-xs font-medium text-(--color-text-primary)">
    Số trang mỗi phần (Segment)
  </label>
  <p class="text-[11px] text-(--color-text-muted)">
    Topic dài hơn giá trị này sẽ được chia thành nhiều phần để tóm tắt riêng.
  </p>
  <input
    v-model.number="segmentSize"
    type="number"
    min="10"
    max="200"
    step="10"
    class="input w-full"
  />
</div>
```

**4c. Lưu/load `segmentSize`:**

```typescript
const segmentSize = ref(20);

// Trong loadSettings():
segmentSize.value = settings.segmentSize ?? 20;

// Trong saveSettings():
await browser.storage.sync.set({
  [STORAGE_KEYS.SETTINGS]: JSON.stringify({
    ...currentSettings,
    segmentSize: segmentSize.value,
  }),
});
```

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**4d. Thay hardcoded constants bằng reactive value từ settings:**

Xóa dòng 38-39:
```typescript
// XÓA:
// const SEGMENT_SIZE = 100;
// const SEGMENT_THRESHOLD = 100;
```

Thêm ref + load từ settings:
```typescript
const segmentSize = ref(20);
const SCRAPE_CHUNK_SIZE = 10;

// Load trong onMounted hoặc loadTopicData:
async function loadSegmentConfig() {
  try {
    const settings = await sendMessage('GET_SETTINGS');
    segmentSize.value = settings?.segmentSize ?? 20;
  } catch { /* use default */ }
}
```

**4e. Sửa `isSegmentMode` computed — dùng `segmentSize` thay vì `SEGMENT_THRESHOLD`:**

```typescript
const isSegmentMode = computed(() =>
  (topicInfo.value?.pageCount ?? 0) > segmentSize.value,
);
```

**4f. Sửa `segments` computed — dùng `segmentSize.value`:**

```typescript
const segments = computed(() => {
  if (!isSegmentMode.value || !topicInfo.value) return [];
  const total = topicInfo.value.pageCount;
  const size = segmentSize.value;
  const segs: { start: number; end: number; label: string }[] = [];
  for (let start = 1; start <= total; start += size) {
    const end = Math.min(start + size - 1, total);
    segs.push({ start, end, label: `Trang ${start}–${end}` });
  }
  return segs;
});
```

**4g. Sửa info text trong template (dòng 669):**

```html
<p class="mt-0.5">
  Chia thành {{ segments.length }} phần, mỗi phần ~{{ segmentSize }} trang.
  Tóm tắt từng phần rồi tạo tổng quan.
</p>
```

**4h. Gọi `loadSegmentConfig()` khi cần:**

Gọi trong `onMounted`:
```typescript
onMounted(async () => {
  await loadSegmentConfig();
  // ...existing logic
});
```

Hoặc đơn giản hơn: load cùng lúc với `loadTopicData()`, trước khi tính segments.

### Lưu ý

- Khi user đổi segment size trong Settings, SummaryView cần refresh để áp dụng. Nếu muốn live update: load config trong `onActivated`.
- Segments đã tóm tắt (cached) vẫn dùng size cũ. Chỉ segment mới sẽ dùng size mới. Điều này OK vì `CachedTopic.segments` lưu `start/end` cụ thể, không phụ thuộc vào segment size.
- `SEGMENT_THRESHOLD` đồng nhất với `segmentSize` — topic > N trang → segment mode. Không cần config riêng.

---

## Thứ tự triển khai

```
Task 3 (cursor pointer) — 1 file CSS, đơn giản nhất
Task 2 (UI fix) — 2 files, nhanh
Task 4 (segment size config) — 3 files, tương tự Task 1
Task 1 (Rate limiter) — nhiều file, cần test
```

Task 1 và Task 4 đều thêm settings vào SettingsView → nên implement cùng lúc để tránh merge conflict.

---

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. **Rate limiter:**
   - Mặc định 2s giữa các request (kiểm tra qua Network tab DevTools)
   - Đổi delay trong Settings → giá trị mới apply cho lần scrape tiếp theo
   - Giá trị min 500ms, max 10000ms
3. **UI fix:**
   - Mở topic đã tóm tắt → "Đã tóm tắt N bài" + CacheIndicator hiện gọn, không tràn
   - Thu hẹp sidepanel → items tự wrap xuống dòng
   - CacheIndicator với đầy đủ badge + time + button + count (+999) vẫn hiện đúng
4. **Cursor pointer:**
   - Hover tất cả buttons (btn-primary, btn-secondary, icon buttons, sort pills, "← Quay lại") → thấy con trỏ tay
   - Hover card-interactive (topic cards trong TopicHubView) → con trỏ tay
   - Hover router-link tabs (Chủ đề, Cài đặt) → con trỏ tay
   - Hover disabled button → con trỏ not-allowed (không đổi)
5. **Segment size:**
   - Mặc định 20 trang → topic 50 trang chia thành 3 phần (1-20, 21-40, 41-50)
   - Đổi segment size = 10 trong Settings → quay lại topic → chia thành 5 phần
   - Topic ≤ 20 trang → normal mode (không segment)
   - Topic 21 trang → segment mode: 2 phần (1-20, 21)
