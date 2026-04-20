# Bug Fix: isSameTopicUrl — Missing Import in TopicHubView + Refactor to Shared Utility

**Date:** 2026-03-21 00:36
**Files changed:** `lib/cache-manager.ts`, `entrypoints/sidepanel/views/SummaryView.vue`, `entrypoints/sidepanel/views/TopicHubView.vue`

---

## Vấn đề

`isSameTopicUrl()` được định nghĩa local trong `SummaryView.vue` nhưng lại được dùng trong template của `TopicHubView.vue` mà **không có import hay định nghĩa** → hàm `undefined` tại runtime → badge "Đang tóm tắt..." không hiện ở Topic Hub.

Ngoài ra, logic normalize URL trong `isSameTopicUrl` bị trùng lặp với `normalizeUrl()` đã có sẵn trong `lib/cache-manager.ts`.

---

## Thay đổi

### `lib/cache-manager.ts`
- Thêm export `isSameTopicUrl(url1: string | null, url2: string | null): boolean`
- Tái dùng `normalizeUrl()` — không duplicate logic
- Nhận `null` trả về `false` (phù hợp với kiểu `store.summarizingUrl.value: string | null`)

```ts
export function isSameTopicUrl(url1: string | null, url2: string | null): boolean {
  if (!url1 || !url2) return false;
  try {
    return normalizeUrl(url1) === normalizeUrl(url2);
  } catch { return url1 === url2; }
}
```

### `SummaryView.vue`
- Thêm `import { isSameTopicUrl } from '@/lib/cache-manager'`
- Xóa định nghĩa local 13 dòng của `isSameTopicUrl`

### `TopicHubView.vue`
- Thêm `import { isSameTopicUrl } from '@/lib/cache-manager'`
- Fix bug: hàm này được gọi trong template (`v-if="isSameTopicUrl(...)"`) nhưng chưa bao giờ được import

---

## Kết quả

- Type check (`npx vue-tsc --noEmit`) pass không lỗi
- Badge "Đang tóm tắt..." trên TopicHubView hoạt động đúng
- Không còn duplicate URL normalization logic
