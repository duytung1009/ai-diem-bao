# Feature 17: Unified Progress Indicator

**Ngày:** 2026-03-30

---

## Objective & Scope

Gộp `LoadingSpinner` + `LLMProgress` thành **một component** `ProgressIndicator` hỗ trợ 2 chế độ:

| Chế độ | Nguồn dữ liệu | Thanh tiến trình |
|--------|---------------|-----------------|
| **Scraping** | `SCRAPE_PROGRESS` messages (currentPage/totalPages/postsScraped) | Fake progress = `currentPage / totalPages * 100%` |
| **LLM** | `LLMTaskState` từ `useLLM` (ETA estimation + map-reduce steps) | Fake progress dựa trên `elapsed / estimatedTotalMs`, kết hợp step/totalSteps khi có |

Hiện tại extension dùng 2 component riêng, chuyển đổi giữa chúng thông qua `v-if="loadingText"` vs `v-else-if="llmTaskId"`. Sau feature này, mọi call site chỉ dùng `<ProgressIndicator>`.

---

## Affected Modules

| File | Thay đổi |
|------|----------|
| `components/ProgressIndicator.vue` | **TẠO MỚI** — component tổng hợp |
| `components/LoadingSpinner.vue` | XÓA (hoặc giữ minimal dùng cho SettingsView/TopicHubView) |
| `components/LLMProgress.vue` | XÓA — chức năng chuyển vào ProgressIndicator |
| `views/SummaryView.vue` | Thay `LoadingSpinner` + `LLMProgress` → `ProgressIndicator` |
| `views/OpinionsView.vue` | Thay `LoadingSpinner` + `LLMProgress` → `ProgressIndicator` |
| `views/ResearchView.vue` | Thay `LoadingSpinner` + `LLMProgress` → `ProgressIndicator` |
| `views/TopicHubView.vue` | Giữ `LoadingSpinner` (simple load, không cần progress bar) |
| `views/SettingsView.vue` | Giữ `LoadingSpinner` (test connection, không cần progress bar) |

---

## Implementation Steps

### Step 1: Thiết kế `ProgressIndicator` component

**Props:**

```typescript
interface ProgressIndicatorProps {
  // --- Chế độ LLM (có taskId) ---
  taskId?: string | null;           // LLM task ID → lấy state từ useLLM

  // --- Chế độ Scraping (có scrapeProgress) ---
  scrapeProgress?: {
    currentPage: number;
    totalPages: number;
    postsScraped: number;
  } | null;
  scrapeDelayMs?: number;           // Delay giữa các trang (từ settings, default 2000ms) → dùng để tính ETA scraping

  // --- Shared ---
  message?: string;                 // Text hiển thị override (fallback khi không có source-specific message)
  fallbackMessage?: string;         // Default: "Đang xử lý..."
  showCancel?: boolean;             // Hiện nút Huỷ
}

defineEmits<{
  cancel: [];
}>();
```

**Logic hiển thị:**

```
IF taskId → LLM mode:
  message = task.progress.message || fallbackMessage
  progress bar:
    - Nếu task.progress.totalSteps >= 2 (map-reduce): step/totalSteps * 100%
    - Nếu totalSteps < 2 (single pass): elapsed/estimatedTotalMs * 100% (capped 95%)
  ETA: estimatedTotalMs - elapsedMs → format "~Ns" hoặc "~N phút Ns"

ELSE IF scrapeProgress → Scraping mode:
  message = `Đang đọc trang ${currentPage}/${totalPages} (${postsScraped} bài)...`
  progress bar: currentPage / totalPages * 100%
  ETA: (totalPages - currentPage) * (scrapeDelayMs + PAGE_LOAD_MS) → format "~Ns" hoặc "~N phút Ns"
    - PAGE_LOAD_MS = 500 (giả định thời gian fetch + parse 1 trang)
    - scrapeDelayMs = prop từ settings (default 2000ms, constant DEFAULT_SCRAPE_DELAY_MS)
    - Công thức: remainingPages * (scrapeDelayMs + 500)
    - Ví dụ: 10 trang còn lại, delay 2000ms → ETA = 10 * 2500 = 25s → "~25s"

ELSE IF message → Simple mode (no progress bar):
  Chỉ hiện spinner + message text

ELSE:
  spinner + fallbackMessage
```

**Cải tiến so với hiện tại:**

1. **LLM single-pass cũng có progress bar** — hiện tại `LLMProgress` chỉ hiện bar khi `totalSteps >= 2` (map-reduce). Với fake progress dựa trên ETA, single-pass LLM call cũng có bar animation, UX đỡ "đứng hình".

2. **Scraping có progress bar** — hiện tại chỉ hiện text `"Đang đọc trang 3/10..."`. Thêm bar = `currentPage/totalPages * 100%` giúp user nhìn trực quan hơn.

3. **Tách biệt message + progress nguồn dữ liệu** — không phải if/else 2 component riêng ở mỗi view.

**Template:**

```vue
<template>
  <div class="space-y-2">
    <!-- Spinner + message -->
    <div class="flex items-center gap-2">
      <svg class="animate-spin h-4 w-4 text-(--color-primary) shrink-0" ...>
        <!-- existing spinner SVG from LLMProgress -->
      </svg>
      <p class="text-sm text-(--color-text-secondary)">{{ displayMessage }}</p>
    </div>

    <!-- Progress bar (scraping hoặc LLM) -->
    <div v-if="progressPercent !== null" class="w-full bg-(--color-bg-tertiary) rounded-full h-1.5">
      <div
        class="bg-(--color-primary) h-1.5 rounded-full transition-all duration-500"
        :style="{ width: progressPercent + '%' }"
      />
    </div>

    <!-- ETA (cả LLM và Scraping) -->
    <p v-if="etaDisplay" class="text-xs text-(--color-text-muted)">
      Ước tính còn {{ etaDisplay }}
    </p>

    <!-- Cancel button -->
    <button
      v-if="showCancel"
      class="w-full btn btn-sm btn-secondary"
      @click="$emit('cancel')"
    >
      Huỷ
    </button>
  </div>
</template>
```

### Step 2: Chuyển logic từ `LLMProgress.vue`

Di chuyển toàn bộ logic computed từ `LLMProgress.vue` vào `ProgressIndicator.vue`:
- `task` computed (từ `useLLM().getTaskState`)
- `progressPercent` computed
- `etaDisplay` computed
- `displayMessage` computed
- Timer 1s interval cho ETA update

**Bổ sung:**
- `scrapeProgressPercent` computed: `Math.round(currentPage / totalPages * 100)`
- `fakeEtaPercent` computed cho LLM single-pass: `Math.min(95, elapsed / estimatedTotalMs * 100)`
- `progressPercent` merge: priority `scrapeProgressPercent` > `stepBasedPercent` > `fakeEtaPercent` > null
- **Scraping ETA:**
  ```typescript
  const PAGE_LOAD_MS = 500; // giả định thời gian fetch + parse 1 trang

  const scrapeEta = computed(() => {
    const p = props.scrapeProgress;
    if (!p || p.totalPages <= 1) return null;
    const remainingPages = p.totalPages - p.currentPage;
    if (remainingPages <= 0) return null;
    const msPerPage = (props.scrapeDelayMs ?? 2000) + PAGE_LOAD_MS;
    return remainingPages * msPerPage;
  });
  ```
- `etaDisplay` merge: dùng `scrapeEta` khi scraping mode, `llmEta` khi LLM mode

### Step 3: Cập nhật `SummaryView.vue`

**Trước:**
```vue
<div v-if="loadingText || llmTaskId" class="space-y-2">
  <LoadingSpinner v-if="loadingText" :text="loadingText" />
  <LLMProgress v-else-if="llmTaskId" :task-id="llmTaskId" :fallback-message="'Đang tóm tắt...'" />
  <button v-if="isScraping" class="w-full btn btn-sm btn-secondary" @click="handleCancel">Huỷ</button>
</div>
```

**Sau:**
```vue
<ProgressIndicator
  v-if="llmTaskId || scrapeProgress || simpleLoadingText"
  :task-id="llmTaskId"
  :scrape-progress="scrapeProgress"
  :scrape-delay-ms="currentConfig?.scrapeDelayMs ?? 2000"
  :message="simpleLoadingText"
  :fallback-message="'Đang tóm tắt...'"
  :show-cancel="isScraping"
  @cancel="handleCancel"
/>
```

`currentConfig` đã có sẵn trong SummaryView (`ref<LLMConfig | null>`, load trong `onMounted` + `onActivated`), chứa `scrapeDelayMs` từ settings.

**Thay đổi trong `<script>`:**

Thêm `scrapeProgress` ref thay cho `loadingText` viết tay:

```typescript
const scrapeProgress = ref<{ currentPage: number; totalPages: number; postsScraped: number } | null>(null);
const simpleLoadingText = ref(''); // cho trường hợp đơn (news detection, initial load)

// Trong onRuntimeMessage, thay loadingText = ... bằng:
function onRuntimeMessage(message: Message) {
  if (message.type === 'SCRAPE_PROGRESS' && isScraping.value) {
    const p = message.payload as PageProgress;
    scrapeProgress.value = p;
  }
}
```

Các chỗ `loadingText.value = 'Đang đọc trang X...'` trong `scrapeInChunks` → đổi thành set `scrapeProgress.value`. Các chỗ `loadingText.value = 'Phát hiện tin tức...'` → `simpleLoadingText.value = '...'`.

Khi scraping xong: `scrapeProgress.value = null;`
Khi LLM xong: `llmTaskId.value = null;`

### Step 4: Cập nhật `OpinionsView.vue`

**Trước:**
```vue
<LLMProgress v-if="isLoading && llmTaskId" :task-id="llmTaskId" :fallback-message="'Đang phân tích ý kiến...'" />
<LoadingSpinner v-else-if="isLoading" text="Đang phân tích ý kiến..." />
```

**Sau:**
```vue
<ProgressIndicator
  v-if="isLoading"
  :task-id="llmTaskId"
  :fallback-message="'Đang phân tích ý kiến...'"
/>
```

Bỏ `isLoading` boolean — thay bằng `llmTaskId !== null` check hoặc giữ vì đơn giản hơn. `ProgressIndicator` tự handle trường hợp `taskId = null` (chỉ hiện spinner + fallbackMessage).

### Step 5: Cập nhật `ResearchView.vue`

Tương tự OpinionsView:

```vue
<ProgressIndicator
  v-if="isLoading"
  :task-id="llmTaskId"
  :fallback-message="'Đang tra cứu câu trả lời...'"
/>
```

### Step 6: Xóa `LLMProgress.vue` / giữ `LoadingSpinner.vue`

- **Xóa `LLMProgress.vue`** — mọi chức năng đã chuyển vào `ProgressIndicator`
- **Giữ `LoadingSpinner.vue`** — dùng cho `TopicHubView` (loading list) và `SettingsView` (test connection) — 2 nơi không cần progress bar, chỉ cần spinner đơn giản

### Step 7 (Optional): Migrate `TopicHubView` + `SettingsView`

Nếu muốn thống nhất hoàn toàn, có thể thay `LoadingSpinner` ở 2 nơi này bằng `ProgressIndicator` ở simple mode (chỉ truyền `message`, không có `taskId` hay `scrapeProgress`). Nhưng đây là optional vì spinner đơn giản phù hợp hơn cho loading list/connection test.

---

## Edge Cases

1. **Scraping xong → chờ user confirm → LLM bắt đầu:** `scrapeProgress = null` → `pendingPosts` dialog hiện → user click "Xác nhận" → `llmTaskId` set → `ProgressIndicator` chuyển sang LLM mode. Transition mượt vì cùng component, chỉ đổi data source.

2. **Map-reduce LLM (totalSteps > 1):** Step-based progress (`step/totalSteps`) ưu tiên hơn ETA-based fake progress. Khi step-based available → dùng nó. Fallback ETA chỉ cho single-pass.

3. **ETA estimation chưa có data** (first time, model chưa có speed stats): `estimatedTotalMs` fallback = `tokens * 20ms`. Progress bar vẫn chạy, chỉ kém chính xác.

4. **LLM task done nhưng component chưa unmount:** Timer cleanup trong `watchEffect` + `onCleanup`. Khi `status !== 'running'` → timer dừng.

5. **Multiple scraped segments:** Segment mode gọi `handleSummarizeSegment` nhiều lần → mỗi lần `scrapeProgress` reset, `llmTaskId` đổi. Component re-render tự nhiên.

6. **User cancel giữa chừng:** Cancel button emit → parent handle cancel logic (clear `isScraping`, abort, etc.). Component dọn dẹp khi props về null.

---

## Test Plan

- [ ] SummaryView: scraping 5 trang → bar chạy 0→100% theo page, ETA giảm dần (~12s → ~10s → ...)
- [ ] SummaryView: scraping 20 trang, delay 3000ms → ETA hiện ~70s ban đầu, giảm mượt
- [ ] SummaryView: LLM single-pass → fake bar chạy dựa trên ETA, capped 95%
- [ ] SummaryView: LLM map-reduce 3 chunks → bar step 1/4, 2/4, 3/4, 4/4
- [ ] SummaryView: scraping → confirm → LLM → transition mượt trong cùng component
- [ ] OpinionsView: chỉ LLM → progress + ETA đúng
- [ ] ResearchView: chỉ LLM → progress + ETA đúng
- [ ] Cancel button chỉ hiện khi `showCancel=true` (scraping)
- [ ] Dark mode: bar colors đúng CSS vars
- [ ] TopicHubView + SettingsView: vẫn dùng `LoadingSpinner` cũ, không bị ảnh hưởng

---

## Rollback Plan

Revert `ProgressIndicator.vue` → khôi phục `LLMProgress.vue` + `LoadingSpinner` ở mọi call site. Không có data migration vì feature này chỉ thay đổi UI component.

---

## Decision Log

### Quyết định 1: Giữ `LoadingSpinner` song song với `ProgressIndicator`
- **Đã chọn:** Giữ `LoadingSpinner` cho simple cases (TopicHubView, SettingsView)
- **Lý do:** TopicHubView load list và SettingsView test connection không cần progress bar. Dùng spinner đơn giản phù hợp hơn, không overengineering.
- **Đã cân nhắc nhưng loại:**
  - Xóa hoàn toàn `LoadingSpinner`, dùng `ProgressIndicator` ở mọi nơi — thêm dependency `useLLM` vào các view không liên quan LLM
  - Merge `LoadingSpinner` thành mode `simple` trong `ProgressIndicator` — thêm complexity cho 2 call sites đơn giản
- **Điều kiện thay đổi:** Nếu xuất hiện thêm views cần progress bar → migrate dần

### Quyết định 2: Fake progress cho LLM single-pass dựa trên ETA
- **Đã chọn:** `progressPercent = Math.min(95, elapsed / estimatedTotalMs * 100)`, cap ở 95% cho tới khi nhận result
- **Lý do:** UX tốt hơn "đứng hình" — user thấy bar chạy, biết đang xử lý. Cap 95% tránh trường hợp bar đầy nhưng chưa xong.
- **Đã cân nhắc nhưng loại:**
  - Không hiện bar cho single-pass (như hiện tại) — UX kém, user không biết còn bao lâu
  - Indeterminate bar (pulse animation) — không truyền tải thông tin thời gian
- **Điều kiện thay đổi:** Nếu ETA quá sai lệch (speed stats không đáng tin) → có thể đổi sang indeterminate

### Quyết định 3: Scraping ETA dựa trên `scrapeDelayMs` + giả định load time
- **Đã chọn:** `ETA = remainingPages * (scrapeDelayMs + PAGE_LOAD_MS)`, với `PAGE_LOAD_MS = 500ms` (constant)
- **Lý do:**
  - `scrapeDelayMs` đã có trong settings (default `DEFAULT_SCRAPE_DELAY_MS = 2000`), user có thể chỉnh → ETA phản ánh đúng config thực tế
  - 500ms là giả định hợp lý cho fetch + DOMParser parse 1 trang forum nội bộ
  - Ví dụ: 10 trang còn, delay 2000ms → ETA = 10 × 2500ms = 25s — đủ hữu ích cho topic dài
  - ETA countdown giảm dần khi `currentPage` tăng (reactive qua `scrapeProgress` prop)
- **Đã cân nhắc nhưng loại:**
  - Đo thực tế thời gian mỗi trang rồi rolling average — thêm complexity, lần scrape đầu chưa có data
  - Không hiện ETA cho scraping — bỏ phí thông tin đã biết (totalPages + delay config)
- **Điều kiện thay đổi:** Nếu PAGE_LOAD_MS sai lệch nhiều (network chậm, trang nặng) → chuyển sang rolling average thực tế

### Quyết định 4: `scrapeProgress` ref thay vì format string `loadingText`
- **Đã chọn:** SummaryView giữ structured data `{ currentPage, totalPages, postsScraped }` trong ref, truyền xuống component
- **Lý do:** Component tự format message + tính progress %. Tách biệt data vs presentation. View chỉ cần set raw data.
- **Đã cân nhắc nhưng loại:**
  - Giữ `loadingText` string, parse regex trong component — fragile, coupling
  - Move scraping progress vào useLLM/composable riêng — overengineering, scraping chỉ có trong SummaryView
- **Điều kiện thay đổi:** Nếu scraping mở rộng sang view khác → cân nhắc composable riêng
