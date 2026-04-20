# Bug Fix: LLM Settings không lưu riêng theo Provider

**Ngày:** 2026-04-01

---

## Bugs đã fix

### BUG-20260401-01: Model field dùng chung giá trị giữa các provider
- **Severity:** major
- **Affected module:** `entrypoints/sidepanel/views/SettingsView.vue`
- **Steps to reproduce:**
  1. Mở tab Settings, đang ở provider OpenAI
  2. Nhập model `gpt-4o-mini`
  3. Chuyển sang provider Claude → field Model vẫn hiển thị `gpt-4o-mini`
  4. Chuyển sang Gemini → tương tự
- **Expected:** Mỗi provider có model riêng, mặc định của Claude là `claude-sonnet-4-6`, Gemini là `gemini-2.5-flash`
- **Actual:** Field Model, API Key, Base URL, Temperature, Timeout dùng chung một giá trị reactively — đổi provider không reset về đúng giá trị
- **Root cause:** `config` ref là một flat object duy nhất (`LLMConfig`), không có cơ chế lưu riêng per-provider. Khi đổi provider, chỉ `config.provider` thay đổi, các field còn lại giữ nguyên giá trị cũ.

### BUG-20260401-02: API Key field không có nút toggle hiển thị
- **Severity:** minor
- **Affected module:** `entrypoints/sidepanel/views/SettingsView.vue`
- **Steps to reproduce:**
  1. Mở tab Settings
  2. Nhập API Key vào field
- **Expected:** Có icon eye để toggle hiển thị/ẩn giá trị API Key
- **Actual:** Field luôn là `type="password"`, không thể xem lại giá trị đã nhập

---

## Changes

### `lib/types.ts` — SỬA

Thêm type và interface mới:
- `LLMProvider` — extracted type alias từ union literal trong `LLMConfig`
- `ProviderSpecificConfig` — interface chứa các field đặc thù của từng provider: `model`, `apiKey`, `baseUrl`, `temperature`, `timeoutMs`
- `LLMConfig` — thêm field `perProvider?: Partial<Record<LLMProvider, ProviderSpecificConfig>>`

### `entrypoints/sidepanel/views/SettingsView.vue` — SỬA

**Fix BUG-01:**
- Thêm `providerDefaults` map — giá trị mặc định model/apiKey/baseUrl/temperature/timeoutMs cho từng provider
- Thêm `syncCurrentProvider()` — snapshot các field hiện tại vào `config.perProvider[currentProvider]`
- Thêm `watch(config.provider)` — khi đổi provider: lưu config cũ vào `perProvider`, load config mới từ `perProvider` (nếu đã có) hoặc fallback sang `providerDefaults`
- `save()` và `testConnection()` gọi `syncCurrentProvider()` trước khi gửi lên storage

**Fix BUG-02:**
- Thêm `showApiKey` ref (mặc định `false`)
- Wrap API Key input trong `<div class="relative">`, thêm button toggle tuyệt đối bên phải với icon SVG eye / eye-off
- Reset `showApiKey = false` mỗi khi đổi provider

---

## Self-review Results
- Issues found: 0
- Issues fixed: 0
- Remaining: —

**Verification:** `npm run build` → pass, `get_errors` → 0 errors trên cả 2 file đã sửa.
