# Task Summary: Bỏ nút "Tóm tắt" ở card "Tab hiện tại" trong Topic Hub

## Trạng thái: DONE ✓
- Type check: pass
- Build: pass (288.88 kB)

## Vấn đề
Card "Tab hiện tại" trong `TopicHubView` (hiển thị khi active tab là topic XenForo chưa có cache) có thêm 1 nút "Tóm tắt" riêng biệt bên trong card. Yêu cầu: bỏ nút này, card tự nó phải clickable (navigate sang SummaryView).

## Thay đổi đã thực hiện

### `entrypoints/sidepanel/views/TopicHubView.vue` — Template

**Trước:**
```html
<div
  v-if="store.activeTabDetect.value && !activeTabInList"
  class="border-2 border-blue-200 bg-blue-50 rounded-lg p-3 space-y-2"
>
  <!-- ... title, post/page count ... -->
  <button class="w-full py-2 bg-blue-600 text-white ..." @click="handleActiveTabTopic">
    Tóm tắt
  </button>
</div>
```

**Sau:**
```html
<button
  v-if="store.activeTabDetect.value && !activeTabInList"
  class="w-full text-left border-2 border-blue-200 bg-blue-50 rounded-lg p-3 hover:border-blue-400 transition-colors space-y-1.5"
  @click="handleActiveTabTopic"
>
  <!-- Tab hiện tại badge + title + stats + "○ Chưa tóm tắt" badge -->
</button>
```

**Chi tiết thay đổi:**
1. Đổi `<div>` → `<button>` clickable toàn bộ card (consistent với topic card khác)
2. Xóa `<button>Tóm tắt</button>` bên trong
3. Thêm `hover:border-blue-400 transition-colors` để card có feedback khi hover
4. Thêm badge `○ Chưa tóm tắt` (consistent với topic card chưa tóm tắt)
5. Spacing: `space-y-2` → `space-y-1.5` (nhất quán với topic card thường)

## Logic không thay đổi
- `handleActiveTabTopic()`: vẫn navigate sang `/summary`, tạo minimal CachedTopic từ detect result
- `activeTabInList`: computed vẫn ẩn card này khi topic đã có trong danh sách cached
