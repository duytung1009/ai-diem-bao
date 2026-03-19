# Feature 08 — Task 2 (revisit): Auto-update cached topic metadata

## Status: ✅ DONE

## File Changed

- `entrypoints/sidepanel/App.vue`

---

## Thay đổi

### Thêm imports
```typescript
import { normalizeUrl, getCachedTopic, saveCachedTopic } from '@/lib/cache-manager';
```

### Sửa `detectActiveTabTopic()`
- Xóa 2 dòng `console.log` debug
- Sau `store.setActiveTab(result, tab.url)`, thêm call `await autoUpdateCachedTopic(tab.url, result)`

### Thêm `autoUpdateCachedTopic(tabUrl, detect)`
Logic:
1. `getCachedTopic(tabUrl)` — nếu URL chưa cache → return early
2. So sánh `totalPosts`, `totalPages`, `title` với `detect`
3. Nếu không có thay đổi → return early (tránh write thừa vào IndexedDB)
4. Nếu có thay đổi → `saveCachedTopic({ ...cached, totalPosts, totalPages, title })`
5. Nếu topic đang selected trong store (so sánh via `normalizeUrl`) → `store.updateSelectedTopic(...)`
6. Catch block: silent fail — không ảnh hưởng UX

---

## Tại sao làm thế này?

- `detectActiveTabTopic()` đã chạy mỗi khi user switch tab hoặc page load xong
- Tận dụng `DetectResult` đã có sẵn — không cần request thêm
- `getCachedTopic()` normalize URL nội bộ → khớp chính xác với cache key
- Chỉ write IndexedDB khi `hasChanges === true` → tránh thừa I/O
- Bổ trợ Task 4 (CacheIndicator): `cachedTopic.totalPosts` trong IndexedDB luôn mới → `evaluateFreshness()` càng chính xác hơn

---

## Verification
- `npx vue-tsc --noEmit` ✅ pass
- `npm run build` ✅ pass (302.69 kB)
