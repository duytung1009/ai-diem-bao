# Fix: Content script chưa sẵn sàng khi detect sau navigate

## Vấn đề
Khi user navigate tới URL mới (trong cùng tab), `tabs.onUpdated` fire với `changeInfo.url` ngay lập tức. App.vue gửi `DETECT_XF` nhưng content script trên trang mới chưa được inject xong (WXT default `run_at: document_idle`). Message bị miss → detect fail → TopicHub không hiển thị topic mới.

## Root cause
- `changeInfo.url` fire **khi bắt đầu** navigate, không phải khi trang đã load xong
- Content script inject sau `document_idle` — có khoảng trống thời gian không có listener

---

## Task 1: Đổi trigger từ `changeInfo.url` sang `changeInfo.status === 'complete'`

### File: `entrypoints/sidepanel/App.vue`

**Cũ (dòng 23-29):**
```typescript
tabUpdatedListener = async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id === tabId) {
    await detectActiveTabTopic();
  }
};
```

**Mới:**
```typescript
tabUpdatedListener = async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id === tabId) {
    await detectActiveTabTopic();
  }
};
```

**Lý do:**
- `status: 'complete'` fire **sau khi** trang đã load xong → content script đã inject và listener đã sẵn sàng
- Đơn giản hơn retry/delay, đáng tin cậy hơn `changeInfo.url`
- `status: 'complete'` cũng fire khi reload trang → tự động re-detect

---

## Verification
1. Mở sidepanel → navigate tới topic XenForo (gõ URL hoặc click link)
2. TopicHub phải hiển thị "Tab hiện tại" với topic vừa navigate tới
3. Navigate tới trang không phải XenForo → "Tab hiện tại" biến mất
4. Reload trang topic → detect vẫn hoạt động
