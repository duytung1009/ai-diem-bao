# Fix: Cache local hiển thị không đúng trong Settings

## Tóm tắt
Bug I-1 từ review/features-01-to-06.md — SettingsView chỉ load cache size trong `onMounted`, nhưng do App dùng `<keep-alive>`, `onMounted` chỉ chạy một lần khi view được mount lần đầu. Khi user quay lại tab Settings sau khi đã tóm tắt topic, cache size không được refresh.

## Root cause
- `<keep-alive>` giữ component instance alive giữa các lần chuyển tab
- `onMounted` không chạy lại khi component được "reactivate"
- `onActivated` là lifecycle hook đúng để dùng trong trường hợp này

## Thay đổi

### `entrypoints/sidepanel/views/SettingsView.vue`

1. **Import `onActivated`** (dòng 2):
   ```typescript
   import { ref, computed, onMounted, onActivated, watch } from 'vue';
   ```

2. **Tách logic load cache size thành function riêng** `refreshCacheSize()` (dòng 71–74):
   ```typescript
   async function refreshCacheSize() {
     const sizeResult = await sendMessage<{ bytes: number }>('GET_CACHE_SIZE').catch(() => null);
     if (sizeResult) cacheSizeBytes.value = sizeResult.bytes;
   }
   ```

3. **Gọi `refreshCacheSize()` trong `onMounted`** thay vì inline logic, và thêm `onActivated` (dòng 76–88):
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

## Verification
- `npx vue-tsc --noEmit` → pass (no errors)
- `npm run build` → pass (307.83 kB, 3.02s)

## Status: DONE
