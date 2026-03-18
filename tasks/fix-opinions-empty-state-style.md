# Task Summary: Fix Empty State Style trong OpinionsView

## Trạng thái: DONE ✓
- Type check: pass
- Build: pass (288.88 kB)

## Vấn đề
Ở tab "Ý kiến", khi topic đã có posts nhưng chưa phân tích, empty state hiển thị trong một box có `border border-gray-200 rounded-lg p-4` — trông giống một button/card thay vì hint text thông báo.

## Thay đổi đã thực hiện

### `entrypoints/sidepanel/views/OpinionsView.vue` — dòng 164-170

**Trước:**
```html
<div
  v-if="!isLoading && !opinions && cachedTopic?.posts?.length"
  class="border border-gray-200 rounded-lg p-4 text-center"
>
  <p class="text-sm text-gray-500">Bấm "Phân tích Ý kiến" để bắt đầu</p>
</div>
```

**Sau:**
```html
<div
  v-if="!isLoading && !opinions && cachedTopic?.posts?.length"
  class="text-center py-6"
>
  <p class="text-xs text-gray-400">Bấm nút phía trên để phân tích ý kiến trong topic.</p>
</div>
```

**Chi tiết thay đổi:**
1. Bỏ `border border-gray-200 rounded-lg p-4` → không còn trông giống card/button
2. Giữ `text-center`, đổi padding thành `py-6` (breathing room nhẹ)
3. Text size: `text-sm text-gray-500` → `text-xs text-gray-400` (nhỏ hơn, mờ hơn — clearly là hint)
4. Nội dung: "Bấm "Phân tích Ý kiến" để bắt đầu" → "Bấm nút phía trên để phân tích ý kiến trong topic."
   (Bớt giống CTA, rõ hơn về vị trí nút)

## Điều kiện hiển thị không thay đổi
`v-if="!isLoading && !opinions && cachedTopic?.posts?.length"` — chỉ hiện khi có posts nhưng chưa có kết quả phân tích.
