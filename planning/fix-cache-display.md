# Fix: Cache local hiển thị không đúng trong Settings

## Mục tiêu
Phần "Cache local" trong SettingsView phải hiển thị dung lượng cache chính xác, cập nhật mỗi khi user quay lại tab Settings.

## Phân tích hiện trạng

### Bug root cause:
- `SettingsView.vue` chỉ load `GET_CACHE_SIZE` trong `onMounted` (dòng 58)
- App dùng `<keep-alive>` cho `<router-view>` → `onMounted` chỉ chạy **1 lần duy nhất**
- Khi user tóm tắt topic (tạo cache mới) rồi quay lại Settings, cache size vẫn hiện giá trị cũ (thường là 0 nếu chưa có cache khi mở extension)
- Cần dùng `onActivated` (lifecycle hook của `<keep-alive>`) để refresh data mỗi khi view được kích hoạt lại

---

## Task 1: Chuyển sang `onActivated` để refresh cache size

### File: `entrypoints/sidepanel/views/SettingsView.vue`

**1a. Import `onActivated`:**

Dòng 1, thay:
```typescript
import { ref, computed, onMounted } from 'vue';
```
thành:
```typescript
import { ref, computed, onMounted, onActivated } from 'vue';
```

**1b. Tách logic load cache size ra function riêng:**

Thêm function mới (sau `onMounted` block, khoảng dòng 62):
```typescript
async function refreshCacheSize() {
  const sizeResult = await sendMessage<{ bytes: number }>('GET_CACHE_SIZE').catch(() => null);
  if (sizeResult) cacheSizeBytes.value = sizeResult.bytes;
}
```

**1c. Gọi trong cả `onMounted` và `onActivated`:**

Sửa `onMounted` (dòng 53-62), bỏ logic cache size inline:
```typescript
onMounted(async () => {
  const loaded = await sendMessage<LLMConfig>('GET_SETTINGS');
  if (loaded?.apiKey !== undefined) {
    config.value = { ...loaded, timeoutMs: loaded.timeoutMs ?? 120000 };
  }
  await refreshCacheSize();
  const loadedPrompts = await sendMessage<CustomPrompts>('GET_CUSTOM_PROMPTS').catch(() => ({}));
  if (loadedPrompts) customPrompts.value = loadedPrompts;
});

onActivated(async () => {
  await refreshCacheSize();
});
```

---

## Verification
1. Mở extension lần đầu → Settings → Cache local hiện 0.0 MB (đúng vì chưa có cache)
2. Chuyển sang tab Chủ đề → chọn topic → Tóm tắt → đợi tóm tắt xong
3. Quay lại tab Cài đặt → Cache local hiện dung lượng > 0 (refresh đúng)
4. `npx vue-tsc --noEmit` + `npm run build` → pass
