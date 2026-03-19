# Fix UI: Empty state trong OpinionsView trông giống button

## Vấn đề
Ở tab Ý kiến, khi chưa phân tích, text "Bấm "Phân tích Ý kiến" để bắt đầu" nằm trong box có border + rounded trông giống một button thay vì message thông báo.

## Task 1: Đổi style empty state thành plain text

### File: `entrypoints/sidepanel/views/OpinionsView.vue`, dòng 152-158

**Cũ:**
```html
<div
  v-if="!isLoading && !opinions && cachedTopic?.posts?.length"
  class="border border-gray-200 rounded-lg p-4 text-center"
>
  <p class="text-sm text-gray-500">Bấm "Phân tích Ý kiến" để bắt đầu</p>
</div>
```

**Mới:** Bỏ border/rounded, chỉ giữ text thông báo nhẹ:
```html
<div
  v-if="!isLoading && !opinions && cachedTopic?.posts?.length"
  class="text-center py-6"
>
  <p class="text-xs text-gray-400">Bấm nút phía trên để phân tích ý kiến trong topic.</p>
</div>
```

**Thay đổi:**
- Bỏ `border border-gray-200 rounded-lg p-4` → thay bằng `py-6` (padding nhẹ, không border)
- Text size `text-sm text-gray-500` → `text-xs text-gray-400` (nhỏ hơn, nhạt hơn — rõ ràng là hint)
- Nội dung text bớt giống CTA: "Bấm nút phía trên để phân tích ý kiến trong topic."

## Verification
1. `npx vue-tsc --noEmit` → pass
2. Chọn topic có posts → vào tab Ý kiến → empty state hiển thị như plain hint text, không giống button
