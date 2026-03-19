# Review: Feature 01–06 Implementation

**Reviewer:** Claude Opus 4.6
**Date:** 2026-03-19
**Build:** `npx vue-tsc --noEmit` ✅ | `npm run build` ✅ (307.76 kB)

---

## Tổng quan

6 feature + 1 bug fix đã được implement. Nhìn chung chất lượng tốt, code đúng pattern, type-safe. Phát hiện 1 bug Critical, 2 Important, 3 Minor.

---

## Issues

### C-1 — CRITICAL: `setSummarizing(null)` bị bỏ sót khi early return trong `confirmSummarize()`

**File:** `entrypoints/sidepanel/views/SummaryView.vue` dòng 232-236

```typescript
if (newPosts.length === 0) {
  summary.value = cachedTopic.value.summary;
  loadingText.value = '';
  return;  // ← BUG: không gọi store.setSummarizing(null)
}
```

**Hậu quả:** Khi incremental update nhưng không có bài mới (`newPosts.length === 0`), store vẫn ở trạng thái `summarizingUrl !== null` → TopicHubView hiện "⟳ Đang tóm tắt..." vĩnh viễn, card pulsing không dừng.

**Fix:** Thêm `store.setSummarizing(null);` trước `return;`:
```typescript
if (newPosts.length === 0) {
  summary.value = cachedTopic.value.summary;
  loadingText.value = '';
  store.setSummarizing(null);  // ← thêm dòng này
  return;
}
```

---

### I-1 — IMPORTANT: `fix-cache-display` chưa được implement

**File:** `entrypoints/sidepanel/views/SettingsView.vue`

**Planning:** `planning/fix-cache-display.md` yêu cầu thêm `onActivated` để refresh cache size mỗi khi user quay lại tab Settings.

**Thực tế:** SettingsView chỉ import `ref, computed, onMounted, watch` (dòng 2) — **không có `onActivated`**. Không có hàm `refreshCacheSize()`. Cache size chỉ load 1 lần trong `onMounted` và không bao giờ refresh.

**Hậu quả:** User tóm tắt topic → quay lại Settings → cache size vẫn hiện 0.0 MB (hoặc giá trị cũ).

**Fix:** Áp dụng đúng theo planning `fix-cache-display.md`:
1. Import `onActivated` từ `vue`
2. Tách `refreshCacheSize()` ra function riêng
3. Gọi trong cả `onMounted` và `onActivated`

---

### I-2 — IMPORTANT: `useTheme` mediaQuery listener bị duplicate

**File:** `entrypoints/sidepanel/composables/useTheme.ts` dòng 34-37

```typescript
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
mediaQuery.addEventListener('change', () => {
  if (themeMode.value === 'system') applyTheme();
});
```

**Vấn đề:** Code này chạy mỗi khi `useTheme()` được gọi (hiện tại: App.vue + SettingsView.vue = 2 lần). Mỗi lần gọi đều đăng ký thêm 1 listener mới, không bao giờ cleanup. Nếu có thêm component dùng `useTheme()` trong tương lai, listener sẽ tích lũy.

**Fix:** Dùng module-level flag để chỉ đăng ký 1 lần:
```typescript
let mediaListenerRegistered = false;

export function useTheme() {
  // ...existing code...

  if (!mediaListenerRegistered) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
      if (themeMode.value === 'system') applyTheme();
    });
    mediaListenerRegistered = true;
  }

  return { themeMode, loadTheme, setTheme };
}
```

---

### M-1 — MINOR: `useTheme` trả về `themeMode` writable ref (không readonly)

**File:** `entrypoints/sidepanel/composables/useTheme.ts` dòng 39

`return { themeMode, loadTheme, setTheme }` — `themeMode` là writable `Ref<ThemeMode>`, cho phép consumer gán trực tiếp `themeMode.value = 'dark'` mà bypass `setTheme()` (không persist, không apply).

**So sánh:** `useTopicStore` dùng `readonly()` cho tất cả state refs.

**Fix:** `themeMode: readonly(themeMode)` + import `readonly` from `vue`. SettingsView cần dùng `setTheme()` (đã đúng).

---

### M-2 — MINOR: Gemini models list chứa preview models

**File:** `entrypoints/sidepanel/views/SettingsView.vue` dòng 58-63

```typescript
const geminiModels = [
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.5-pro-preview-05-06',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];
```

`gemini-2.5-flash-preview-05-20` và `gemini-2.5-pro-preview-05-06` là preview models có thể bị Google deprecate bất kỳ lúc nào. User chọn model này có thể gặp lỗi API 404 khi model bị rút.

**Fix (tùy chọn):**
- Đổi sang GA models khi available: `gemini-2.5-flash`, `gemini-2.5-pro`
- Hoặc cho phép user nhập model name tự do (như OpenAI) thay vì dropdown cứng

---

### M-3 — MINOR: `executeClearAll()` xóa tuần tự, không có loading indicator

**File:** `entrypoints/sidepanel/views/SettingsView.vue` dòng 134-146

```typescript
async function executeClearAll() {
  try {
    const topics = await sendMessage<CachedTopic[]>('GET_ALL_CACHED_TOPICS');
    for (const topic of topics || []) {
      await sendMessage('DELETE_CACHED_TOPIC', topic.url);
    }
```

Khi có nhiều topic cached, vòng `for` xóa tuần tự từng cái → user có thể tưởng UI bị đơ (không có spinner/progress). Ngoài ra, nếu 1 topic lỗi → silent catch → các topic sau không bị xóa nhưng user không biết.

**Fix (tùy chọn):**
- Thêm `Promise.allSettled()` thay vì sequential
- Hoặc thêm loading indicator trong confirmation UI

---

## Feature-by-feature Summary

| # | Feature | Plan vs Code | Verdict |
|---|---------|--------------|---------|
| 01 | Delete topic | ✅ Khớp | PASS |
| 02 | Default prompt display | ✅ Khớp | PASS |
| 03 | Real-time summary status | ✅ Khớp + mở rộng (Task 4: temp topic card) | PASS (trừ C-1) |
| 04 | Styling rules | ✅ Khớp — design tokens, utility classes, STYLE_GUIDE.md, migration 14 files | PASS |
| 05 | Dark mode | ✅ Khớp — useTheme composable, Settings selector, dark: variants | PASS (trừ I-2, M-1) |
| 06 | Gemini provider | ✅ Khớp — GeminiAdapter, factory, SettingsView UI | PASS (trừ M-2) |
| fix | Cache display | ❌ CHƯA IMPLEMENT | FAIL |

---

## Action Items (ưu tiên)

- [ ] **C-1**: Thêm `store.setSummarizing(null)` trước early return trong `confirmSummarize()` (SummaryView.vue dòng 234)
- [ ] **I-1**: Implement `fix-cache-display` — thêm `onActivated` + `refreshCacheSize()` vào SettingsView.vue
- [ ] **I-2**: Fix duplicate mediaQuery listener trong useTheme.ts
- [ ] **M-1**: Đổi `themeMode` thành `readonly()` trong useTheme return
- [ ] **M-2**: Cân nhắc cập nhật Gemini models list khi GA models available
- [ ] **M-3**: Cân nhắc thêm loading state cho `executeClearAll()`
