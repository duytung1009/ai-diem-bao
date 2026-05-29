# Feature 37: Gộp Gemini + Gemini (Free Tier) thành một provider

## Overview

Hiện tại extension có hai provider riêng biệt cho Google Gemini: `gemini` và `gemini-free`. Cả hai đều trỏ đến cùng API endpoint (`generativelanguage.googleapis.com`), dùng cùng `GeminiAdapter`, và chỉ khác nhau ở default model (`gemini-2.5-flash` vs `gemini-2.5-flash-lite`). Việc tách thành hai provider gây confusing cho user (Free Tier hay Paid Tier?) trong khi thực tế API key Google AI Studio có thể dùng cho mọi model — việc ở free hay paid tier phụ thuộc vào model được chọn, không phải provider.

Mục tiêu: gộp `gemini-free` vào `gemini`, xóa `gemini-free` khỏi codebase. App chưa publish nên không cần migration — xóa thẳng.

## Goals

- Xóa `'gemini-free'` khỏi `LLMProvider` type và tất cả nơi tham chiếu
- Không thay đổi behavior của GeminiAdapter

## Requirements

### Component A — `lib/types.ts`

Sửa `LLMProvider` type:

```typescript
// Trước
export type LLMProvider = 'openai' | 'claude' | 'gemini' | 'gemini-free' | 'openrouter' | 'custom';

// Sau
export type LLMProvider = 'openai' | 'claude' | 'gemini' | 'openrouter' | 'custom';
```

### Component B — `lib/llm/factory.ts`

Xóa `case 'gemini-free':` (GeminiAdapter đã handle cả hai, giờ chỉ còn `case 'gemini':`)

```typescript
// Trước
case 'gemini':
case 'gemini-free':
  return new GeminiAdapter(config);

// Sau
case 'gemini':
  return new GeminiAdapter(config);
```

### Component C — `lib/llm/provider-origins.ts`

Xóa entry `'gemini-free'` khỏi `PROVIDER_BASE_URLS` map.

### Component D — `entrypoints/sidepanel/views/SettingsView.vue`

3 thay đổi:

**1. `providerDefaults`:** Xóa key `'gemini-free'`

**2. `isGemini` computed:** Đơn giản hóa

```typescript
// Trước
const isGemini = computed(() => config.value.provider === 'gemini' || config.value.provider === 'gemini-free');

// Sau
const isGemini = computed(() => config.value.provider === 'gemini');
```

**3. Dropdown:** Xóa option `gemini-free`, giữ `gemini`

```html
<!-- Xóa dòng này -->
<option value="gemini-free">Google Gemini (Free Tier)</option>
```

### Component E — `entrypoints/sidepanel/views/HelpView.vue`

Cập nhật text hướng dẫn về Gemini Free Tier: bỏ reference đến provider name "Google Gemini (Free Tier)", thay bằng hướng dẫn chọn model `gemini-2.5-flash-lite` trong provider `Google Gemini`.

Dòng cần sửa (khoảng line 168): thay `"Google Gemini (Free Tier)"` → `"Google Gemini"` và thêm note chọn model `gemini-2.5-flash-lite` cho free tier.

## Technical Considerations

- TypeScript sẽ báo lỗi compile nếu còn sót reference nào đến `'gemini-free'` → dùng làm safety net, chạy `pnpm build` để verify
- Không cần sửa `GeminiAdapter` — adapter không check provider name, chỉ dùng `config.model`
- Không cần sửa `token-estimator.ts` — pricing table key theo model name, không theo provider name

## Implementation Notes

Thứ tự:
1. Sửa `lib/types.ts` — xóa `'gemini-free'`
2. Để TypeScript tự phát hiện các nơi còn sót → fix theo lỗi compile
3. Sửa SettingsView, factory, provider-origins, HelpView
4. Build để verify zero TS errors

Files cần sửa:
- `lib/types.ts`
- `lib/llm/factory.ts`
- `lib/llm/provider-origins.ts`
- `entrypoints/sidepanel/views/SettingsView.vue`
- `entrypoints/sidepanel/views/HelpView.vue`

## Test Plan

- [ ] `pnpm build` không có TypeScript error
- [ ] Chọn "Google Gemini", chọn model `gemini-2.5-flash-lite` → test connection thành công
- [ ] HelpView: text hướng dẫn còn chính xác, không còn reference "Free Tier" provider

## Decision Log

### Quyết định 1: Merge vào `gemini`, không tạo tên mới

- **Đã chọn:** Giữ provider ID là `'gemini'`, xóa `'gemini-free'`
- **Lý do:** `gemini` đã là ID ổn định, được lưu trong storage của user. Đổi cả hai sang tên mới sẽ cần migration phức tạp hơn. Free vs Paid là tính chất của model, không phải provider.
- **Đã cân nhắc nhưng loại:**
  - Rename `gemini` → `google` — loại vì breaking change không cần thiết, migration nặng hơn
- **Điều kiện thay đổi:** Nếu Google tách thành hai API endpoint thực sự khác nhau

### Quyết định 2: Không giữ backward compat type alias

- **Đã chọn:** Xóa hẳn `'gemini-free'` khỏi type, dùng TypeScript compile error làm safety net
- **Lý do:** App chưa publish, không có user data cần preserve. Type alias tạm thời không cần thiết.
- **Điều kiện thay đổi:** Nếu app đã publish và có user đang dùng `gemini-free` trong storage
