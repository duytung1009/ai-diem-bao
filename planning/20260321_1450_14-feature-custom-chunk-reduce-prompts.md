# Planning: Feature 14 — Custom Chunk & Reduce Prompt Templates

**Timestamp:** 2026-03-21 14:50
**Model policy:** Sonnet (implementation routine)

---

## Objective & Scope

Thêm 2 tab mới "Tóm tắt phần" và "Gộp tóm tắt" vào section **Prompt Templates** trong Settings, cho phép user tùy chỉnh `CHUNK_SUMMARY_PROMPT` (map phase) và `REDUCE_SUMMARY_PROMPT` (reduce phase) của pipeline map-reduce.

Scope:
- Chỉ ảnh hưởng đến pipeline map-reduce (chỉ kích hoạt khi topic vượt context window)
- Không thay đổi UX của 3 tab hiện có (Tóm tắt / Ý kiến / Tra cứu)
- Không thêm message type mới — `GET/SAVE_CUSTOM_PROMPTS` đã xử lý đủ

---

## Affected Modules

| File | Thay đổi |
|------|---------|
| `lib/types.ts` | Mở rộng `CustomPrompts` interface |
| `lib/llm/summarizer.ts` | Thread custom chunk/reduce qua pipeline |
| `entrypoints/sidepanel/views/SettingsView.vue` | Thêm 2 tab UI + import prompts mới |

Background `index.ts` **không cần sửa** — `prompts` từ `getCustomPrompts()` đã được pass vào tất cả 4 hàm LLM.

---

## Implementation Steps

### Step 1: `lib/types.ts` — Mở rộng CustomPrompts

```typescript
export interface CustomPrompts {
  summary?: string;
  opinions?: string;
  research?: string;
  chunk?: string;   // CHUNK_SUMMARY_PROMPT (map phase)
  reduce?: string;  // REDUCE_SUMMARY_PROMPT (reduce phase)
}
```

---

### Step 2: `lib/llm/summarizer.ts` — Thread custom prompts

**2a. `summarizeWithMapReduce()` — thêm param `customChunkPrompt`**

```typescript
async function summarizeWithMapReduce(
  posts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: (...) => void,
  suggestedChunks?: number,
  finalPrompt?: string,
  customChunkPrompt?: string,   // THÊM MỚI
): Promise<string> {
  const combined = await summaryChunks(
    posts, config, onProgress, suggestedChunks,
    customChunkPrompt,  // mapPrompt
    finalPrompt,        // reducePrompt
  );
  return combined;
}
```

**2b. `summarizeTopic()` — pass `customPrompts.chunk`**

Thay dòng gọi:
```typescript
// Cũ:
return summarizeWithMapReduce(posts, config, onProgress, contextCheck.chunksNeeded, systemPrompt);

// Mới:
return summarizeWithMapReduce(
  posts, config, onProgress, contextCheck.chunksNeeded,
  systemPrompt,
  customPrompts?.chunk,
);
```

**2c. `updateSummary()` — pass `customPrompts.chunk` và `customPrompts.reduce`**

Thay dòng gọi:
```typescript
// Cũ:
return summarizeWithMapReduce(postsWithContext, config, onProgress, contextCheck.chunksNeeded);

// Mới:
return summarizeWithMapReduce(
  postsWithContext, config, onProgress, contextCheck.chunksNeeded,
  customPrompts?.reduce,    // finalPrompt = custom reduce (hoặc default REDUCE_SUMMARY_PROMPT)
  customPrompts?.chunk,     // mapPrompt = custom chunk
);
```

> **Lưu ý logic:** Khi `finalPrompt = undefined`, `summaryChunks` vẫn dùng default `REDUCE_SUMMARY_PROMPT`. Cần truyền `customPrompts?.reduce` (undefined nếu không có custom) — default fallback trong `summaryChunks` sẽ handle.

**2d. `researchTopic()` — pass `customPrompts.chunk`**

Thay dòng gọi `summaryChunks`:
```typescript
// Cũ:
const mapResult = await summaryChunks(posts, config, onProgress, contextCheck.chunksNeeded, CHUNK_SUMMARY_PROMPT);

// Mới:
const mapResult = await summaryChunks(
  posts, config, onProgress, contextCheck.chunksNeeded,
  customPrompts?.chunk || CHUNK_SUMMARY_PROMPT,
);
```

**2e. (Bonus) Fix bug token estimate trong recursive reduce:**

```typescript
// Cũ (line ~232) — hardcoded, không phản ánh custom reduce prompt:
const combinedTokens = estimateTokens(combinedText) + estimateTokens(REDUCE_SUMMARY_PROMPT) + 2000;

// Mới:
const combinedTokens = estimateTokens(combinedText) + estimateTokens(reducePrompt) + 2000;
```

---

### Step 3: `entrypoints/sidepanel/views/SettingsView.vue` — UI

**3a. Import thêm từ prompts:**

```typescript
import {
  SUMMARY_PROMPT,
  OPINION_ANALYSIS_PROMPT,
  RESEARCH_PROMPT,
  CHUNK_SUMMARY_PROMPT,   // THÊM
  REDUCE_SUMMARY_PROMPT,  // THÊM
} from '@/lib/prompts';
```

**3b. Cập nhật type `activePromptTab`:**

```typescript
// Cũ:
const activePromptTab = ref<'summary' | 'opinions' | 'research'>('summary');

// Mới:
const activePromptTab = ref<'summary' | 'opinions' | 'research' | 'chunk' | 'reduce'>('summary');
```

**3c. Cập nhật `defaultPrompts`:**

```typescript
const defaultPrompts = {
  summary: SUMMARY_PROMPT,
  opinions: OPINION_ANALYSIS_PROMPT,
  research: RESEARCH_PROMPT,
  chunk: CHUNK_SUMMARY_PROMPT,    // THÊM
  reduce: REDUCE_SUMMARY_PROMPT,  // THÊM
};
```

**3d. Cập nhật `promptTabLabels`:**

```typescript
const promptTabLabels = {
  summary: 'Tóm tắt',
  opinions: 'Ý kiến',
  research: 'Tra cứu',
  chunk: 'Tóm tắt phần',  // THÊM
  reduce: 'Gộp tóm tắt',  // THÊM
};
```

**3e. Cập nhật template — tabs array:**

```html
<!-- Cũ: -->
v-for="tab in (['summary', 'opinions', 'research'] as const)"

<!-- Mới: -->
v-for="tab in (['summary', 'opinions', 'research', 'chunk', 'reduce'] as const)"
```

**3f. Thêm note giải thích khi active tab là `chunk` hoặc `reduce`:**

Ngay trên textarea, hiển thị note khi `activePromptTab` là `chunk` hoặc `reduce`:

```html
<p
  v-if="activePromptTab === 'chunk' || activePromptTab === 'reduce'"
  class="text-xs text-(--color-text-secondary) mb-1"
>
  ⚙️ Prompt này chỉ dùng trong map-reduce — khi topic vượt quá context window của model.
  Đảm bảo output của "Tóm tắt phần" có cấu trúc nhất quán để "Gộp tóm tắt" hoạt động tốt.
</p>
```

---

## Edge Cases

- **Tab `chunk`/`reduce` có custom prompt nhưng topic nhỏ (không trigger map-reduce):** Custom prompt được lưu nhưng không được dùng — không có side effect.
- **Custom `reduce` = undefined:** `summarizeWithMapReduce` truyền `undefined` là `finalPrompt` → `summaryChunks` fallback về default `REDUCE_SUMMARY_PROMPT` — đúng behavior.
- **Custom `reduce` cho `summarizeTopic`:** Không áp dụng — `summarizeTopic` dùng `SUMMARY_PROMPT` (hoặc custom summary) làm reduce prompt để output đúng format cuối. Custom `reduce` chỉ áp dụng cho `updateSummary`.
- **Blue dot indicator** (custom prompt đang active): Tab `chunk` và `reduce` có `customPrompts[tab]` check — tự hoạt động không cần thêm code.

---

## Test Plan

1. **Settings UI:**
   - Mở Settings → Prompt Templates → có 5 tabs (Tóm tắt / Ý kiến / Tra cứu / Tóm tắt phần / Gộp tóm tắt)
   - Tab mới hiện note giải thích màu gray
   - "Xem prompt mặc định" hiện đúng `CHUNK_SUMMARY_PROMPT` / `REDUCE_SUMMARY_PROMPT`
   - Lưu/Reset hoạt động, blue dot hiện khi có custom

2. **Functional (cần topic dài):**
   - Nhập custom `CHUNK_SUMMARY_PROMPT` → tóm tắt topic dài → verify chunk output theo format custom
   - Reset → tóm tắt lại → verify dùng default prompt

3. **Type check:**
   - `npx vue-tsc --noEmit` → pass

---

## Rollback Plan

Revert 3 files: `lib/types.ts`, `lib/llm/summarizer.ts`, `SettingsView.vue`.
Không ảnh hưởng đến dữ liệu — các key `chunk`/`reduce` trong storage bị ignore nếu revert.
