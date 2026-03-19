# Feature: Hiện default prompt ở phần Prompt Templates trong Settings

## Mục tiêu
User có thể xem toàn bộ default prompt (không chỉ 120 ký tự đầu trong placeholder) để hiểu prompt mặc định trước khi quyết định tuỳ chỉnh.

## Phân tích hiện trạng
- `SettingsView.vue` dòng 298: textarea dùng `:placeholder="defaultPrompts[activePromptTab].slice(0, 120) + '...'"` — chỉ hiện 120 ký tự đầu
- Khi textarea trống (chưa custom), placeholder mờ nhạt và bị cắt → user không biết prompt mặc định đầy đủ
- `defaultPrompts` object đã import sẵn (`SUMMARY_PROMPT`, `OPINION_ANALYSIS_PROMPT`, `RESEARCH_PROMPT`) — chỉ cần hiển thị

---

## Task 1: Thêm toggle "Xem prompt mặc định" dưới textarea

### File: `entrypoints/sidepanel/views/SettingsView.vue`

**1a. Thêm ref mới** (trong `<script setup>`, khoảng dòng 20):
```typescript
const showDefaultPrompt = ref(false);
```

**1b. Thêm toggle button + default prompt display** — sau textarea (dòng 298), trước `<div class="flex gap-2">` (dòng 300):

```html
<!-- Default prompt viewer -->
<button
  type="button"
  class="text-xs text-blue-600 hover:text-blue-700 transition-colors"
  @click="showDefaultPrompt = !showDefaultPrompt"
>
  {{ showDefaultPrompt ? '▾ Ẩn prompt mặc định' : '▸ Xem prompt mặc định' }}
</button>
<div
  v-if="showDefaultPrompt"
  class="border border-gray-200 rounded-lg p-2 bg-gray-50 max-h-48 overflow-y-auto"
>
  <pre class="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">{{ defaultPrompts[activePromptTab] }}</pre>
</div>
```

**1c. Reset `showDefaultPrompt` khi chuyển tab** — thêm watch (trong `<script setup>`):
```typescript
import { ref, computed, onMounted, watch } from 'vue';

watch(activePromptTab, () => {
  showDefaultPrompt.value = false;
});
```

**1d. Cải thiện placeholder** — thay placeholder cũ bằng hint rõ ràng hơn:

Dòng 298, thay:
```html
:placeholder="defaultPrompts[activePromptTab].slice(0, 120) + '...'"
```
thành:
```html
placeholder="Nhập prompt tuỳ chỉnh... (bấm 'Xem prompt mặc định' để xem prompt gốc)"
```

---

## Verification
1. Mở Settings → Prompt Templates → textarea trống hiện placeholder hướng dẫn
2. Bấm "▸ Xem prompt mặc định" → hiện full prompt trong box scrollable
3. Chuyển tab (Tóm tắt → Ý kiến) → default prompt viewer tự đóng
4. Bấm "▾ Ẩn prompt mặc định" → ẩn box
5. `npx vue-tsc --noEmit` + `npm run build` → pass
