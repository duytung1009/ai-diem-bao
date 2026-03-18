# Fix UI: Bỏ nút "Tóm tắt" ở card "Tab hiện tại" trong Topic Hub

## Vấn đề
Trong TopicHubView, card "Tab hiện tại" (active tab topic chưa có trong cache) hiển thị nút "Tóm tắt" riêng biệt. Yêu cầu: bỏ nút này, card chỉ cần click để navigate sang SummaryView (giống các topic card khác).

## Task 1: Bỏ nút "Tóm tắt", đổi card thành clickable

### File: `entrypoints/sidepanel/views/TopicHubView.vue`, dòng 108-129

**Thay đổi:**
1. Đổi container `<div>` thành `<button>` (giống topic card ở dòng 141-169)
2. Xóa nút "Tóm tắt" (dòng 123-128)
3. Thêm `@click="handleActiveTabTopic"` vào card container

**Template mới cho block "Active tab topic":**
```html
<!-- Active tab topic (if not in cached list) -->
<button
  v-if="store.activeTabDetect.value && !activeTabInList"
  class="w-full text-left border-2 border-blue-200 bg-blue-50 rounded-lg p-3 hover:border-blue-400 transition-colors space-y-1.5"
  @click="handleActiveTabTopic"
>
  <div class="flex items-center gap-2">
    <span class="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">Tab hiện tại</span>
  </div>
  <p class="text-sm font-medium text-gray-900 line-clamp-2">
    {{ store.activeTabDetect.value.title }}
  </p>
  <div class="flex items-center gap-3 text-xs text-gray-500">
    <span>{{ store.activeTabDetect.value.postCount }} bài viết</span>
    <span>{{ store.activeTabDetect.value.pageCount }} trang</span>
    <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">○ Chưa tóm tắt</span>
  </div>
</button>
```

## Verification
1. `npx vue-tsc --noEmit` → pass
2. Mở sidepanel khi đang ở topic XenForo chưa cache → card "Tab hiện tại" hiển thị KHÔNG có nút "Tóm tắt"
3. Click card → navigate sang SummaryView bình thường
