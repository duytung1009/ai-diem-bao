# Task: Move maxTokens & contextWindow to Per-Provider Config

## Mô tả

Di chuyển `maxTokens` và `contextWindow` vào cấu hình riêng của từng LLM provider trong Settings tab. Trước đây, hai trường này là global — khi đổi provider thì giá trị bị ghi đè. Nay mỗi provider lưu riêng.

## Files Changed

- `lib/types.ts` — Thêm `maxTokens?: number` và `contextWindow?: number` vào `ProviderSpecificConfig`
- `entrypoints/sidepanel/views/SettingsView.vue` — Cập nhật 3 nơi:
  - `providerDefaults` — thêm `maxTokens: 4096, contextWindow: undefined` cho mỗi provider
  - `syncCurrentProvider()` — lưu `maxTokens` và `contextWindow` khi sync
  - `watch(() => config.value.provider, ...)` — lưu khi rời provider, restore khi vào provider mới

## Self-review Results

- Issues found: 0
- Issues fixed: 0
- Remaining: none
