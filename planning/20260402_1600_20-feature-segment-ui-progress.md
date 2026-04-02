# Feature 20: Segment Mode UI — Progress Header + Collapsible Grid

## Context

Khi topic có 1251 trang và segment size = 10, sẽ có 126 pill buttons hiển thị thẳng trong một `flex flex-wrap` grid. Grid này chiếm ~400px màn hình, đẩy toàn bộ content (tóm tắt, quan điểm) xuống dưới và làm trải nghiệm khó dùng.

**Vấn đề cụ thể:**
1. 126 pill buttons ngập tràn màn hình, không có tóm tắt tiến độ
2. Không biết đang ở đâu trong quá trình tóm tắt (đã xong bao nhiêu phần)
3. "Tổng quan" bị lẫn trong đám pills, không nổi bật
4. Không có cách nhảy nhanh đến phần tiếp theo chưa tóm tắt
5. Dots nhỏ (1.5×1.5px) khó scan trên 126 items

---

## Files cần sửa

| File | Thay đổi |
|------|----------|
| `entrypoints/sidepanel/views/SummaryView.vue` | Thêm progress header, collapsible grid, "Phần tiếp theo" button, prev/next nav |
| `entrypoints/sidepanel/composables/useSummarize.ts` | Thêm computed: `summarizedCount`, `progressPercent`, `nextPendingSegmentIndex` |

---

## Đề xuất giải pháp

### Giải pháp A (Đề xuất): Progress header + collapsible pill grid

**Thay đổi tổng quan:**
- Tách "Tổng quan" ra khỏi pill grid, đặt thành standalone button nổi bật
- Thêm progress bar + counter (`X / N phần đã tóm tắt`) luôn hiển thị
- Thêm nút "Tiếp theo →" nhảy đến segment đầu tiên có posts nhưng chưa tóm tắt
- Pill grid ẩn mặc định, expand khi click "Xem tất cả (N)"
- Khi đang xem 1 segment: hiển thị `← Trước | Sau →` navigation
- Pill grid khi mở: `max-h-48 overflow-y-auto` để không chiếm toàn màn hình

**Wireframe (collapsed state):**
```
[Tổng quan]  [Tiếp theo: Trang 21-30 →]

██████░░░░░░░░░░░  8 / 126 phần đã tóm tắt   [Xem tất cả ▼]
```

**Wireframe (expanded state):**
```
[Tổng quan]  [Tiếp theo: Trang 21-30 →]

██████░░░░░░░░░░░  8 / 126 phần đã tóm tắt   [Thu gọn ▲]
┌─────────────────────────────────────────────────────────┐
│ [Trang 1-10 ●] [Trang 11-20 ●] [Trang 21-30 ○]         │  ← scrollable
│ [Trang 31-40]  [Trang 41-50]   ...                      │    max-h-48
└─────────────────────────────────────────────────────────┘
```
(● = đã tóm tắt, ○ = có posts chưa tóm tắt, trắng = chưa scrape)

---

### Giải pháp B (Alternative): Select dropdown thay pill grid

Thay toàn bộ pill grid bằng `<select>` với optgroups theo trạng thái:
```
[Tổng quan ▼]  →  dropdown:
  ── Đã tóm tắt (8) ──
  Trang 1–10, Trang 11–20, ...
  ── Có data chưa tóm tắt (3) ──
  Trang 21–30, ...
  ── Chưa xử lý (115) ──
  Trang 31–40, ...
```
**Ưu:** Rất compact (1 dòng). **Nhược:** Kém visual, khó scan nhanh trạng thái từng phần.

---

### Giải pháp C (Alternative): Pagination của pill grid

Hiển thị 20 pills mỗi "trang", thêm `< >` navigation:
```
[Tổng quan]
[Trang 1-10 ●] [Trang 11-20 ●] [Trang 21-30 ○] ... [Trang 191-200]
                        < 1 / 7 >
```
**Ưu:** Giữ nguyên pill paradigm. **Nhược:** Thêm interaction để xem toàn bộ, không thấy progress tổng.

---

## Implementation (Giải pháp A)

### Step 1: Thêm computed vào `useSummarize.ts`

```typescript
// Số segment đã có summary
const summarizedCount = computed(() =>
  segmentSummaries.value.filter(s => s?.summary).length
);

// % tiến độ (0-100)
const progressPercent = computed(() =>
  segments.value.length > 0
    ? Math.round((summarizedCount.value / segments.value.length) * 100)
    : 0
);

// Index (0-based) của segment đầu tiên có posts nhưng chưa tóm tắt → "Tiếp theo"
const nextPendingSegmentIndex = computed((): number | null => {
  const idx = segmentSummaries.value.findIndex(
    (s, i) => i < segments.value.length && s?.posts?.length && !s?.summary
  );
  return idx >= 0 ? idx : null;
});
```

Export thêm 3 computed này từ `useSummarize`.

### Step 2: Thêm local ref vào `SummaryView.vue`

```typescript
const segmentGridExpanded = ref(false);
```

### Step 3: Thay thế đoạn segment tabs trong template `SummaryView.vue`

**Trước (lines ~190-222, SummaryView.vue):**
```vue
<div class="flex flex-wrap gap-1.5">
  <button @click="activeSegmentIndex = null">Tổng quan</button>
  <button v-for="(seg, i) in segments" ...>{{ seg.label }} <span .../> </button>
</div>
```

**Sau:**
```vue
<div class="space-y-2">
  <!-- Row 1: Tổng quan + Tiếp theo -->
  <div class="flex items-center gap-2 flex-wrap">
    <button
      class="px-3 py-1.5 text-xs rounded-full font-medium transition-colors"
      :class="activeSegmentIndex === null
        ? 'bg-blue-600 text-white'
        : 'bg-(--color-bg-muted) text-(--color-text-secondary) hover:bg-(--color-bg-muted)'"
      @click="activeSegmentIndex = null"
    >
      Tổng quan
    </button>
    <button
      v-if="nextPendingSegmentIndex !== null"
      class="px-3 py-1.5 text-xs rounded-full transition-colors bg-(--color-bg-muted) text-(--color-text-secondary) hover:text-(--color-text-primary) flex items-center gap-1"
      @click="activeSegmentIndex = nextPendingSegmentIndex"
    >
      Tiếp theo: {{ segments[nextPendingSegmentIndex!].label }}
      <span class="text-(--color-text-muted)">→</span>
    </button>
  </div>

  <!-- Row 2: Progress bar + expand toggle -->
  <div class="space-y-1">
    <div class="flex items-center justify-between text-xs text-(--color-text-secondary)">
      <span>{{ summarizedCount }} / {{ segments.length }} phần đã tóm tắt</span>
      <button
        class="underline hover:text-(--color-text-primary) transition-colors"
        @click="segmentGridExpanded = !segmentGridExpanded"
      >
        {{ segmentGridExpanded ? 'Thu gọn ▲' : `Xem tất cả ▼` }}
      </button>
    </div>
    <div class="h-1.5 rounded-full bg-(--color-bg-muted) overflow-hidden">
      <div
        class="h-full rounded-full bg-blue-500 transition-all duration-300"
        :style="{ width: progressPercent + '%' }"
      />
    </div>
  </div>

  <!-- Row 3: Collapsible pill grid -->
  <div
    v-if="segmentGridExpanded"
    class="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto"
  >
    <button
      v-for="(seg, i) in segments"
      :key="i"
      class="px-2.5 py-1 text-xs rounded-full transition-colors flex items-center gap-1"
      :class="activeSegmentIndex === i
        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-medium'
        : 'text-(--color-text-secondary) hover:bg-(--color-bg-muted)'"
      @click="activeSegmentIndex = i"
    >
      {{ seg.label }}
      <span
        v-if="segmentSummaries[i]?.summary"
        class="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"
        title="Đã tóm tắt"
      />
      <span
        v-else-if="segmentSummaries[i]?.posts?.length"
        class="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0"
        title="Đã scrape, chưa tóm tắt"
      />
    </button>
  </div>

  <!-- Row 4: Prev/Next khi đang ở 1 segment cụ thể -->
  <div
    v-if="activeSegmentIndex !== null"
    class="flex items-center justify-between text-xs text-(--color-text-secondary)"
  >
    <button
      v-if="activeSegmentIndex > 0"
      class="flex items-center gap-1 hover:text-(--color-text-primary) transition-colors"
      @click="activeSegmentIndex--"
    >
      ← {{ segments[activeSegmentIndex - 1].label }}
    </button>
    <span v-else />
    <button
      v-if="activeSegmentIndex < segments.length - 1"
      class="flex items-center gap-1 hover:text-(--color-text-primary) transition-colors"
      @click="activeSegmentIndex++"
    >
      {{ segments[activeSegmentIndex + 1].label }} →
    </button>
    <span v-else />
  </div>
</div>
```

---

## Edge Cases

1. **segments.length ≤ 5**: Progress bar + toggle vẫn render (không hại gì, grid cũng nhỏ)
2. **nextPendingSegmentIndex = null** (tất cả đã tóm tắt hoặc chưa scrape gì): nút "Tiếp theo" ẩn → không hiển thị
3. **activeSegmentIndex = 0**: "← Trước" ẩn, chỉ hiện "Sau →"
4. **activeSegmentIndex = last**: "Sau →" ẩn, chỉ hiện "← Trước"
5. **Khi đang tóm tắt**: `activeSegmentIndex` thay đổi programmatically → prev/next navigation vẫn hoạt động
6. **Topic nhỏ không có segment mode**: Toàn bộ block này wrapped trong `v-if="isSegmentMode"` (đã có), không ảnh hưởng

---

## Decision Log

### QD1: Collapsible grid (Giải pháp A) vs dropdown (B) vs pagination (C)
- **Đã chọn:** Giải pháp A (collapsible grid)
- **Lý do:** Giữ nguyên pill paradigm quen thuộc, progress bar cho overview nhanh, max-h-48 scroll giới hạn height khi expand
- **Loại B:** Select dropdown kém visual, mất khả năng scan color status
- **Loại C:** Pagination thêm interaction nhưng không cải thiện overview

### QD2: `segmentGridExpanded = false` mặc định (thay vì true)
- **Đã chọn:** Ẩn grid mặc định
- **Lý do:** Mục tiêu là giảm vertical space chiếm bởi grid; user có thể expand khi cần chọn segment cụ thể
- **Điều kiện thay đổi:** Nếu workflow chính của user là click vào từng segment → nên expand mặc định

### QD3: "Tiếp theo" button dựa trên posts?.length (thay vì chưa tóm tắt bất kỳ)
- **Đã chọn:** `nextPendingSegmentIndex` = segment đầu tiên có posts nhưng chưa summary
- **Lý do:** Đây là action có ý nghĩa nhất — segment đã scrape nhưng cần tóm tắt. Segment chưa scrape không tóm tắt được ngay
- **Điều kiện thay đổi:** Nếu muốn "Tiếp theo" = bất kỳ segment chưa tóm tắt → xóa điều kiện `s?.posts?.length`

---

## Rollback Plan

Revert chỉ `SummaryView.vue` (template section) và `useSummarize.ts` (3 computed mới). Không ảnh hưởng types, cache, hay LLM layer.

---

## Verification

1. `npx vue-tsc --noEmit` — no new errors
2. `npm run build` — pass
3. **Test thủ công:**
   - Topic 1251 trang (126 segments): kiểm tra grid ẩn mặc định, expand/collapse, progress bar chính xác
   - "Tiếp theo" button: nhảy đúng segment có posts chưa tóm tắt
   - "Tổng quan" button: nổi bật hơn segment pills, activate đúng
   - Prev/Next nav khi ở segment đầu/cuối: ẩn đúng button
   - Topic nhỏ (< 20 segments): không bị ảnh hưởng
