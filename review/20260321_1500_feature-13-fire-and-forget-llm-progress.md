# Review: Feature 13 — Fire-and-Forget LLM Progress

**Date:** 2026-03-21
**review_tier:** sonnet
**Files reviewed:**
- `entrypoints/sidepanel/composables/useLLM.ts`
- `entrypoints/sidepanel/components/LLMProgress.vue`
- `entrypoints/background/index.ts` (START_LLM_TASK handler + processLLMTask)
- `lib/llm/summarizer.ts`
- `entrypoints/sidepanel/views/SummaryView.vue` (LLM call sites + stale guard)
- `entrypoints/sidepanel/views/OpinionsView.vue`
- `entrypoints/sidepanel/views/ResearchView.vue`
- `lib/types.ts`

---

## Tổng quan

Kiến trúc fire-and-forget được implement sạch và đúng đắn:

```
User action → useLLM wrapper → START_LLM_TASK (immediate response)
                                  ↓ background async
                              LLM_PROGRESS ×N → useLLM.handleProgress()
                              LLM_RESULT → useLLM.handleResult() → Promise resolve
                                              ↓
                                         View's await resumes → update UI/cache
```

- Singleton module-level state trong `useLLM.ts` (không duplicate listener)
- `activeSummarizeId` stale guard đầy đủ: tăng lên khi `loadTopicData()`, kiểm tra sau mỗi await LLM
- Keepalive pattern (ping storage.sync mỗi 20s) ngăn service worker bị terminate
- 3 views (SummaryView, OpinionsView, ResearchView) đều dùng cùng pattern nhất quán
- Cleanup: `activeTasks` tự xóa sau 5s, interval timer xóa trong `watchEffect` onCleanup

**Verdict: ✅ Excellent** — không có lỗi logic hay critical bug. Chỉ có 1 issue Important + 3 Minor.

---

## Issues

### I-1: `currentModel` trong useLLM.ts bị stale sau khi đổi model trong Settings

**File:** `entrypoints/sidepanel/composables/useLLM.ts` — lines 23, 54–57

**Code:**
```typescript
const currentModel = ref<string>('');
let listenerRegistered = false;

async function loadSpeedStats() {
  const stored = await browser.storage.sync.get([key, STORAGE_KEYS.SETTINGS]);
  if (stored[key]) modelSpeedStats.value = stored[key] as ...;
  const settings = stored[STORAGE_KEYS.SETTINGS] as { model?: string } | undefined;
  if (settings?.model) currentModel.value = settings.model;
}

export function useLLM() {
  if (!listenerRegistered) {
    // ...
    listenerRegistered = true;
    loadSpeedStats(); // ← chỉ gọi 1 lần trong suốt session
  }
}
```

**Vấn đề:** `currentModel.value` chỉ được set 1 lần khi `useLLM()` được gọi lần đầu. Nếu user vào Settings, đổi sang model khác (ví dụ từ `gemini-2.0-flash` sang `gemini-2.5-pro`), rồi quay về SummaryView và tóm tắt, `estimateETA()` vẫn dùng speed stats của model cũ → ETA không chính xác.

**Impact:** Chỉ ảnh hưởng đến hiển thị ETA (best-effort) — fallback `tokens * 20` vẫn hoạt động nếu model mới chưa có stats. Không ảnh hưởng đến tính đúng đắn của tóm tắt.

**Fix:** Reload `currentModel` mỗi khi useLLM được gọi (không cần await, fire-and-forget):

```typescript
export function useLLM() {
  if (!listenerRegistered) {
    // ...
    listenerRegistered = true;
    loadSpeedStats(); // load đầy đủ lần đầu
  } else {
    // Refresh chỉ model setting (không cần load stats lại)
    browser.storage.sync.get(STORAGE_KEYS.SETTINGS).then((r) => {
      const s = r[STORAGE_KEYS.SETTINGS] as { model?: string } | undefined;
      if (s?.model) currentModel.value = s.model;
    }).catch(() => {});
  }
  // ...
}
```

Hoặc đơn giản hơn: lấy model từ LLMConfig khi gọi `startTask()` và truyền vào `estimateETA()`.

---

### M-1: LLMProgress.vue — biểu thức ETA rườm rà đánh giá thành 0

**File:** `entrypoints/sidepanel/components/LLMProgress.vue` — line 34

**Code hiện tại:**
```typescript
const elapsed = t.elapsedMs > 0
  ? t.elapsedMs
  : (now.value - (now.value - (t.estimatedTotalMs * 0)));
//   ↑ = (now.value - (now.value - 0)) = (now.value - now.value) = 0
```

**Vấn đề:** Nhánh `else` luôn bằng `0` do `estimatedTotalMs * 0 = 0`. Đây là dead code confusing, không phản ánh ý định thực sự.

**Fix:**
```typescript
const elapsed = t.elapsedMs > 0 ? t.elapsedMs : 0;
```

Behavior không đổi: khi task mới start (`elapsedMs = 0`), `elapsed = 0` → `remaining = estimatedTotalMs` → hiện full ETA. ✅

---

### M-2: SummaryView.vue — `as any` trong `store.updateSelectedTopic`

**File:** `entrypoints/sidepanel/views/SummaryView.vue` — line 603

**Code hiện tại:**
```typescript
store.updateSelectedTopic({
  title: topic.title,
  version: topic.version,
  totalPages: topic.totalPages,
  segments: updated,
} as any);
```

**Vấn đề:** `as any` bypass type checking. `updateSelectedTopic` nhận `Partial<CachedTopic>` — object trên đúng type, chỉ cần bỏ `as any`. `updated` là `TopicSegment[]` (hoặc `(TopicSegment | null)[]` — xem M-3), `CachedTopic.segments` là `TopicSegment[] | undefined` → tương thích.

**Fix:** Bỏ `as any`, hoặc thêm cast `as Partial<CachedTopic>` nếu TypeScript báo lỗi về null slots.

---

### M-3: SummaryView.vue — `as TopicSegment[]` cast che giấu null slots

**File:** `entrypoints/sidepanel/views/SummaryView.vue` — lines 567–568

**Code hiện tại:**
```typescript
const count = Math.max(segmentSummaries.value.length, segmentIndex + 1);
const updated = Array.from({ length: count }, (_, i) => segmentSummaries.value[i] ?? null) as TopicSegment[];
```

**Vấn đề:** Array có thể chứa `null` ở các slot chưa tóm tắt (ví dụ segment 0 xong, segment 2 xong trước 1), nhưng cast `as TopicSegment[]` ẩn điều này. Downstream code dùng `seg?.summary` với optional chaining nên không bị runtime error — nhưng type không trung thực.

Thực tế trường hợp này (segment không liên tục) rất hiếm trong thực tế sử dụng, và `?.` handling đã đủ.

**Fix nhẹ:** Đổi type annotation thành `(TopicSegment | null)[]` và cập nhật nơi dùng, hoặc đơn giản hơn:
```typescript
const updated = [...segmentSummaries.value];
updated[segmentIndex] = newSeg;
// (JS tự xử lý sparse array; slots trước đó là undefined, được xử lý bởi ?. operator)
```

---

## Điểm tốt đáng ghi nhận

- **Stale guard pattern** (`activeSummarizeId`) được apply nhất quán ở cả 4 async paths trong SummaryView. Stale callback vẫn save vào cache nhưng không update UI — edge case được xử lý đúng.
- **`onComplete` callback pattern** trong `startTask()`: Promise resolve/reject được wire qua callback → caller có thể `await result` mà không cần polling — elegant.
- **`watchEffect` + timer** trong LLMProgress.vue: onCleanup tự xóa interval khi task chuyển sang 'done' — không memory leak.
- **Keepalive** dùng `browser.storage.sync.get('')` (no-op) thay vì `setTimeout` recursive → không bị terminate, `finally` đảm bảo clear dù LLM throw.
- **`listenerRegistered` flag**: đúng module-level (không phải composable-level) → listener thực sự chỉ đăng ký 1 lần dù có nhiều component gọi `useLLM()`.
