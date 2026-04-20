# Fix: Code Review Issues — Features 01–06

**Date:** 2026-03-19
**Source review:** `review/features-01-to-06.md`
**Type check:** `npx vue-tsc --noEmit` ✅

---

## Tóm tắt

Áp dụng tất cả các fix từ code review features-01-to-06 (1 Critical, 2 Important *, 3 Minor).

> *I-1 (fix-cache-display) đã được implement trước đó — SettingsView.vue đã có `onActivated` + `refreshCacheSize()`. Review bị outdated.

---

## Các fix đã thực hiện

### C-1 — CRITICAL: `setSummarizing(null)` bị thiếu (early return)

**File:** `entrypoints/sidepanel/views/SummaryView.vue` ~dòng 232

**Vấn đề:** Khi `newPosts.length === 0` trong incremental update, hàm `confirmSummarize()` return sớm mà không clear `summarizingUrl` → TopicHubView hiện "⟳ Đang tóm tắt..." vĩnh viễn.

**Fix:**
```typescript
if (newPosts.length === 0) {
  summary.value = cachedTopic.value.summary;
  loadingText.value = '';
  store.setSummarizing(null);  // ← thêm
  return;
}
```

---

### I-2 — IMPORTANT: useTheme duplicate mediaQuery listener

**File:** `entrypoints/sidepanel/composables/useTheme.ts`

**Vấn đề:** `mediaQuery.addEventListener` chạy mỗi lần `useTheme()` được gọi → tích lũy listener (App.vue + SettingsView = 2 lần, có thể nhiều hơn).

**Fix:** Module-level flag `mediaListenerRegistered` đảm bảo chỉ đăng ký 1 listener duy nhất:
```typescript
let mediaListenerRegistered = false;

// inside useTheme():
if (!mediaListenerRegistered) {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => { ... });
  mediaListenerRegistered = true;
}
```

---

### M-1 — MINOR: `useTheme` trả về writable ref

**File:** `entrypoints/sidepanel/composables/useTheme.ts`

**Vấn đề:** Consumer có thể gán `themeMode.value = 'dark'` trực tiếp, bypass `setTheme()` (không persist, không apply).

**Fix:** Return `readonly(themeMode)`, import `readonly` from 'vue':
```typescript
return { themeMode: readonly(themeMode), loadTheme, setTheme };
```

---

### M-2 — MINOR: Gemini preview models

**File:** `entrypoints/sidepanel/views/SettingsView.vue`

**Vấn đề:** `gemini-2.5-flash-preview-05-20`, `gemini-2.5-pro-preview-05-06` là preview có thể bị Google deprecate.

**Fix:** Đổi sang GA model names:
```typescript
const geminiModels = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];
```

---

### M-3 — MINOR: `executeClearAll` sequential deletes

**File:** `entrypoints/sidepanel/views/SettingsView.vue`

**Vấn đề:** `for` loop xóa tuần tự từng topic — chậm, UI có vẻ đơ khi nhiều topics.

**Fix:** Dùng `Promise.allSettled` để xóa song song:
```typescript
await Promise.allSettled(
  (topics || []).map((topic) => sendMessage('DELETE_CACHED_TOPIC', topic.url))
);
```

---

## Ghi chú

- **I-1 (fix-cache-display):** Đã implement trước — `SettingsView.vue` hiện có đủ `refreshCacheSize()` + `onMounted` + `onActivated`. Không cần sửa.
- **useTheme `readonly`:** SettingsView dùng `currentTheme` chỉ để so sánh trong template, không assign trực tiếp → backward compatible.
