# F27 — Knowledge Overhaul: Teaser sau Summary, Opt-in Persist, Sổ tay cá nhân Cross-topic

**Ngày:** 2026-05-22
**Feature số:** 27
**Tier:** Tier 3 (cross-module, schema mới, IDB version bump, route mới)
**Model:** Opus planning + review; Sonnet implement
**Tham chiếu:** F22 (knowledge tab improvements), F24 (dynamic chunks knowledge), F26 (LLM cost guard)

---

## Overview

Overhaul lại toàn bộ luồng "Tổng hợp kiến thức" theo hướng:

1. **Discovery moment** — gắn entry point trích xuất kiến thức ngay trong luồng Summary để user biết tính năng tồn tại (acquisition).
2. **Opt-in persist** — không "ép" IDB chứa kiến thức tự động. Chỉ entries user xác nhận `saved=true` mới được persist trong topic cache.
3. **Personal Notebook (Sổ tay cá nhân)** — tạo store mới `notebookEntries` lưu mọi saved entry **cross-topic**, có route `/notebook` để tra cứu/quản lý. Đây là retention moat, là **must-have** trong overhaul lần này.

Không gộp prompt summary + knowledge vào 1 LLM call (xem Decision Log #1).

## Goals

- G1: Sau khi user summarize topic, hiển thị CTA "Trích xuất kiến thức" inline trong SummaryView — không tự gọi LLM, user phải confirm.
- G2: Đổi `CachedTopic.knowledgeEntries` từ "tất cả entries" → "chỉ entries có `saved=true`". `knowledgeChunks` vẫn lưu nguyên (cho resume + khôi phục).
- G3: Thêm "Khôi phục danh sách" trong KnowledgeView để re-derive entries từ `knowledgeChunks` thông qua 1 LLM reduce call (manual, không tự chạy).
- G4: Tạo IDB store `notebookEntries` (cross-topic). Mỗi lần user toggle save trong KnowledgeView → upsert/delete đồng bộ với notebook.
- G5: Tạo route `/notebook` với `NotebookView.vue` — list tất cả saved entries cross-topic, search/filter, group, mở source topic, delete.

## Non-Goals

- Không gộp prompt summary + knowledge (Decision Log #1).
- Không auto-call LLM ở bất kỳ điểm nào (Decision Log #2).
- Không migration cho cached topics cũ (Decision Log #3).
- Không export notebook sang file (markdown/json) — phase sau nếu cần.
- Không sync notebook lên cloud — local-only, theo tinh thần extension.

---

## Requirements

### Phase A — Knowledge Teaser inline trong SummaryView

A1. Sau khi `summaryJson` đã render trong `SummaryView.vue`, hiển thị một CTA block ở cuối `SummaryContent`:

  - Nếu chưa có `knowledgeEntries` saved và chưa có `knowledgeChunks` complete:
    `"💡 Bạn có thể trích xuất kiến thức hữu ích từ thớt này. [Trích xuất]"`
  - Nếu đã có saved entries:
    `"💡 Bạn đã lưu {n} kiến thức từ thớt này. [Xem trong tab Kiến thức →]"`
  - Nếu có `knowledgeChunks` nhưng chưa có saved entries (user đã extract trước đây, không save gì):
    `"💡 Đã có dữ liệu kiến thức nhưng chưa lưu mục nào. [Khôi phục danh sách →]"`

A2. Click "Trích xuất" → router push `/knowledge` + auto-trigger confirm box (tận dụng `confirmingExtract` đã có trong KnowledgeView).

A3. Không auto-chạy LLM call. Mọi action đều cần user click 1 lần (xem Decision Log #2).

A4. CTA chỉ hiển thị khi:
  - `summaryJson` đã có nội dung (đã summarize xong),
  - `allPosts.length > 0` (có dữ liệu để extract),
  - Không trong trạng thái `isProcessing`.

### Phase B — Opt-in Persist cho topic cache

B1. Đổi semantics của `CachedTopic.knowledgeEntries`:
  - Từ: "Mọi entry sau khi reduce".
  - Sang: "Chỉ entries user đã `saved=true`".

B2. Trong `KnowledgeView`:
  - `entries.value` (Vue ref) là source of truth cho session hiện tại — chứa cả saved + unsaved.
  - Mỗi lần extract xong (`runDirectExtract` hoặc `runReducePhase`):
    - Update `entries.value = merged` như cũ.
    - **Sửa save payload**: `SAVE_CACHED_TOPIC` chỉ gửi `knowledgeEntries: merged.filter(e => e.saved)`.
  - `knowledgeChunks` vẫn save đầy đủ (không thay đổi).

B3. Khi reopen topic (`loadTopicData`):
  - `entries.value` được set từ `cachedTopic.knowledgeEntries` (chỉ saved entries).
  - Nếu user muốn xem lại danh sách cũ → bấm "Khôi phục danh sách" (Phase B5).

B4. Trong `toggleSave(entry)`:
  - Update local `entries.value`.
  - Optimistic update topic cache: chỉ save `entries.value.filter(e => e.saved)` vào `knowledgeEntries`.
  - Đồng bộ với Personal Notebook (xem Phase C2).

B5. Nút **"Khôi phục danh sách"** trong KnowledgeView:
  - Hiển thị khi `entries.value.length === 0` (hoặc chỉ có saved entries) VÀ `cachedTopic.knowledgeChunks?.length > 0`.
  - Click → gọi `reduceKnowledgeChunksTask` với existing chunks (không re-extract từng chunk, tiết kiệm token).
  - Show confirm warning nếu cost > threshold (tái dùng pattern Phase A của F26).
  - Sau khi reduce xong → entries hiện về (chưa saved). User tự bấm save từng cái.

B6. Trong `handleExtract` (path "Trích xuất bài mới"):
  - Logic resume vẫn giữ nguyên (đọc từ `knowledgeChunks`).
  - Merge giữ nguyên `mergeSavedWithFresh` (saved entries survive).
  - Sau extract: chỉ save filtered (như B2).

### Phase C — Personal Notebook (Cross-topic Sổ tay)

C1. Tạo IDB store mới `notebookEntries` trong DB `ai-diem-bao-cache`:
  - Bump `DB_VERSION` từ 2 → 3 trong `lib/cache-db.ts`.
  - Object store key: `entry.id` (uuid đã có sẵn trong `KnowledgeEntry`).
  - Indexes:
    - `by-topicUrl` (non-unique, multiEntry: **false**) — single string field, list entries theo topic.
    - `by-savedAt` (non-unique, multiEntry: **false**) — number, sort timeline.
    - `by-category` (non-unique, multiEntry: **false**) — single string field; nếu sau này đổi `category` thành array PHẢI flip sang `true`.
    - `by-tags` (non-unique, multiEntry: **true**) — **bắt buộc** `multiEntry: true` vì `tags: string[]`. Cho phép IDB tự tách mảng thành các index entries độc lập → query "tất cả entries có tag X" qua `IDBKeyRange.only(tag)` thay vì load toàn bộ store rồi filter RAM.
    - `by-orphaned` (non-unique, multiEntry: **false**) — boolean, để filter "orphan only" trong NotebookView (xem C7).

C2. Thêm interface `NotebookEntry` trong `lib/types.ts`:
  ```typescript
  export interface NotebookEntry extends KnowledgeEntry {
    sourceTopicUrl: string;       // normalized URL
    sourceTopicTitle: string;
    savedAt: number;              // timestamp khi user bấm save
    orphaned?: boolean;            // true nếu source topic đã bị xoá nhưng entry được giữ lại
    orphanedAt?: number;           // timestamp khi entry chuyển sang orphan (set cùng lúc orphaned=true)
  }
  ```

C3. Tạo `lib/notebook-db.ts` (analog với `cache-db.ts`):
  - `notebookGet(id)` — đọc 1 entry.
  - `notebookGetAll()` — list all.
  - `notebookGetByTopic(topicUrl)` — list theo topic (dùng `by-topicUrl` index).
  - `notebookGetByTag(tag)` — list theo tag duy nhất (dùng `by-tags` multiEntry index + `IDBKeyRange.only(tag)`).
  - `notebookGetByCategory(category)` — list theo category (dùng `by-category` index).
  - `notebookGetOrphans()` — list orphan entries (dùng `by-orphaned` index, key = `1`/`true`).
  - `notebookPut(entry)` — upsert.
  - `notebookDelete(id)` — xoá 1 entry.
  - `notebookOrphanByTopic(topicUrl)` — bulk update: set `orphaned=true`, `orphanedAt=now()` cho mọi entries của topic. Không xoá. Dùng cho UX "Giữ kiến thức".
  - `notebookDeleteByTopic(topicUrl)` — bulk delete khi user chọn "Xoá kèm kiến thức".
  - `notebookGetStats()` — `{ totalEntries, topicCount, orphanCount, categories: string[] }`.

C4. Thêm message types trong `lib/types.ts`:
  ```
  | 'GET_NOTEBOOK_ENTRIES'        // payload: { topicUrl?, category?, tag?, search?, orphanOnly? }
  | 'GET_NOTEBOOK_STATS'
  | 'UPSERT_NOTEBOOK_ENTRY'       // payload: NotebookEntry
  | 'DELETE_NOTEBOOK_ENTRY'       // payload: { id }
  | 'ORPHAN_NOTEBOOK_BY_TOPIC'    // payload: { topicUrl } — mark orphaned, không xoá
  | 'DELETE_NOTEBOOK_BY_TOPIC'    // payload: { topicUrl } — bulk xoá
  ```

C5. Handlers trong `entrypoints/background/index.ts` cho 6 messages mới — gọi `notebook-db.ts`. Mọi handler return Promise nên `onMessage` đã handle async response (xem `lib/messaging.ts`).

C6. Trong `KnowledgeView.toggleSave`:
  ```typescript
  async function toggleSave(entry: KnowledgeEntry) {
    const next = !entry.saved;
    const updated = entries.value.map(e => e.id === entry.id ? { ...e, saved: next } : e);
    entries.value = updated as KnowledgeEntry[];

    // 1. Save topic cache (chỉ saved entries)
    await optimisticUpdate({ knowledgeEntries: updated.filter(e => e.saved) });

    // 2. Sync notebook — fire-and-forget qua helper (xem C12)
    if (next) {
      const notebookEntry: NotebookEntry = {
        ...entry, saved: true,
        sourceTopicUrl: cachedTopic.value!.url,
        sourceTopicTitle: cachedTopic.value!.title,
        savedAt: Date.now(),
      };
      sendMessageQuiet('UPSERT_NOTEBOOK_ENTRY', notebookEntry);
    } else {
      sendMessageQuiet('DELETE_NOTEBOOK_ENTRY', { id: entry.id });
    }
  }
  ```
  Notebook sync là fire-and-forget — không rollback nếu fail; helper `sendMessageQuiet` swallow lỗi MV3 SW lifecycle (xem C12 và Decision Log #5).

C7. Khi user xoá cả topic (từ TopicHubView), confirm dialog cho **2 lựa chọn rõ ràng** (xem Decision Log #8):

  ```
  Xoá thớt "{title}"

  Thớt này có {n} kiến thức đã lưu trong Sổ tay. Bạn muốn:

  [ Chỉ xoá thớt — giữ kiến thức trong Sổ tay ]   ← default highlight
  [ Xoá cả thớt và kiến thức liên quan ]
  [ Huỷ ]
  ```

  - **"Chỉ xoá thớt — giữ kiến thức"** (default, an toàn hơn):
    - `notebookOrphanByTopic(url)` → mark `orphaned=true`, `orphanedAt=now()` cho mọi entries của topic.
    - `deleteCachedTopic(url)` → xoá khỏi `topics` store.
    - Entries vẫn xuất hiện trong NotebookView với badge "Thớt gốc đã xoá".
  - **"Xoá cả thớt và kiến thức"** (destructive):
    - `deleteCachedTopic(url)` + `notebookDeleteByTopic(url)` → xoá cả hai.

  Nếu topic không có entries trong notebook (n=0): bỏ qua dialog phức tạp, dùng confirm đơn giản như hiện tại.

  **Tự động orphan khi load notebook mà source topic không còn:** trong `GET_NOTEBOOK_ENTRIES` handler, có thể check `topicUrl` có còn trong `topics` store không. Nếu không và entry chưa `orphaned` → tự lazy-orphan. Tránh case user xoá topic bằng đường khác mà notebook chưa được sync.

C8. Tạo `entrypoints/sidepanel/views/NotebookView.vue` với route mới `/notebook`:

  Layout:
  - Header: search box + stats inline (`"42 kiến thức từ 8 thớt · 5 mồ côi"`).
  - Filter bar: category pills + tag pills + topic filter dropdown + toggle "🪦 Chỉ hiện mồ côi".
  - View modes (toggle button group): `By topic` | `By category` | `By tag` | `Timeline`.
  - Entry cards: tái sử dụng layout từ KnowledgeView (chevron expand, save icon, tags) + thêm dòng "Từ thớt: [title] ↗" làm link mở topic.
    - Nếu `orphaned=true`: dòng source hiển thị "Từ thớt: ~~[title]~~ (đã xoá)" với badge nhỏ "🪦 Mồ côi". Nút "Open source" → vẫn cho mở URL gốc (post có thể vẫn còn trên VOZ dù topic đã xoá khỏi extension cache). Nút "Open in extension" → disabled hoặc đổi thành "Tạo lại topic từ kiến thức" (scope F28).
  - Empty state: "Sổ tay trống. Mở một thớt và lưu kiến thức để bắt đầu."

C9. Action trên mỗi notebook entry:
  - **Open source** — `browser.tabs.create({ url: post deep link })`.
  - **Open in extension** — router push `/knowledge?focus={id}` (xem C9a cho cơ chế đồng bộ).
  - **Unsave** — `DELETE_NOTEBOOK_ENTRY` + nếu source topic đang trong cache, cũng update `knowledgeEntries` của topic đó (remove entry vì list này chỉ chứa saved).
  - **Delete forever** — xoá khỏi notebook (giữ trong source topic nếu vẫn còn).

C9a. **Focus race condition (`?focus={id}` → KnowledgeView)** — phải dùng pattern `watch + nextTick` chứ không gọi `getElementById` ngay trong `onMounted/onActivated`:

  ```typescript
  // Trong KnowledgeView setup
  const route = useRoute();
  const focusId = computed(() => (route.query.focus as string | null) ?? null);
  const hasFocused = ref(false);

  // Trigger scroll khi entries đã render + focusId có giá trị
  watch(
    () => [entries.value.length, focusId.value] as const,
    async ([count, id]) => {
      if (!id || count === 0 || hasFocused.value) return;
      await nextTick();             // chờ DOM render xong các card
      const el = document.getElementById(`knowledge-entry-${id}`);
      if (!el) return;              // entry có thể đã bị filter ra khỏi list
      expandedIds.value = new Set([...expandedIds.value, id]);  // auto-expand
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-blue-500');
      setTimeout(() => el.classList.remove('ring-2', 'ring-blue-500'), 2000);
      hasFocused.value = true;       // chỉ focus 1 lần per navigation

      // Clear query để back/refresh không trigger lại
      router.replace({ query: { ...route.query, focus: undefined } });
    },
    { immediate: true },
  );

  // Reset hasFocused khi route thay đổi (re-enter view)
  watch(() => route.fullPath, () => { hasFocused.value = false; });
  ```

  Lý do: `entries.value` load async từ IDB qua `sendMessage('GET_CACHED_TOPIC')`. Tại setup() time, list rỗng → `getElementById` trả null. Watch trigger lại khi entries arrive + DOM đã render qua `nextTick`.

  Card DOM phải có `id="knowledge-entry-{entry.id}"` để query được.

C9b. **Filter có thể che entry đang focus**: nếu user vào với `?focus={id}` nhưng entry đó bị filter bởi search/tag/category → bỏ qua focus (đã không có element). Trade-off chấp nhận được vì user filter chủ động. Có thể bonus: reset filter khi focus query param có giá trị (deferred).

C10. Update router trong `main.ts`:
  ```typescript
  { path: '/notebook', name: 'notebook', component: () => import('./views/NotebookView.vue') },
  ```

C11. Thêm tab "Sổ tay" trong navigation (nếu có nav component) hoặc icon ở `TopicHubView` header. Theo flow hiện tại, có thể thêm:
  - Trong `TopicHubView` header: nút "📒 Sổ tay ({n})" với count từ notebook stats.
  - Trong `KnowledgeView` header: nút "📒 Xem sổ tay" góc phải.

C12. **MV3 Service Worker lifecycle — `sendMessageQuiet` helper**:

  MV3 service worker có thể bị terminate khi idle. Khi user toggle save liên tục rồi close sidepanel ngay, hoặc khi background đang "wake up", `sendMessage` có thể throw `Extension context invalidated` hoặc reject với `Could not establish connection`. Hiện tại `lib/messaging.ts` không tự catch — caller phải `.catch(() => {})` mỗi nơi.

  Thêm helper vào `lib/messaging.ts`:

  ```typescript
  /**
   * Fire-and-forget sendMessage — swallow MV3 SW lifecycle errors silently.
   * Dùng cho các sync không critical (notebook sync, telemetry, optimistic updates).
   * KHÔNG dùng cho các call cần response (GET_*, action lúc start LLM task...).
   */
  export function sendMessageQuiet(type: MessageType, payload?: unknown): void {
    try {
      const p = browser.runtime.sendMessage({ type, payload } satisfies Message);
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        (p as Promise<unknown>).catch(() => { /* swallow SW lifecycle errors */ });
      }
    } catch {
      // sendMessage throws synchronously khi extension context bị invalidate
      // (rất hiếm — chỉ xảy ra khi extension vừa update/reload)
    }
  }
  ```

  Quy tắc dùng:
  - Notebook UPSERT/DELETE → `sendMessageQuiet` (chấp nhận eventual consistency, xem Decision Log #5).
  - Notebook `ORPHAN_BY_TOPIC` / `DELETE_BY_TOPIC` khi xoá topic → dùng `sendMessage` thông thường (cần response để confirm).
  - GET_NOTEBOOK_ENTRIES/STATS → `sendMessage` (cần data).

---

## Technical Considerations

### Affected files

**New:**
- `lib/notebook-db.ts` — IDB wrapper cho notebook store.
- `entrypoints/sidepanel/views/NotebookView.vue` — main UI.
- `entrypoints/sidepanel/composables/useNotebook.ts` (optional) — composable wrapper cho notebook ops nếu reuse nhiều.

**Modified:**
- `lib/cache-db.ts` — bump `DB_VERSION` to 3, thêm createObjectStore + indexes cho `notebookEntries`.
- `lib/types.ts` — thêm `NotebookEntry`, 5 message types, comment đổi semantics `knowledgeEntries`.
- `lib/cache-manager.ts` — `deleteCachedTopic` gọi thêm `notebookDeleteByTopic`.
- `entrypoints/background/index.ts` — 5 message handlers mới.
- `entrypoints/sidepanel/main.ts` — thêm route `/notebook`.
- `entrypoints/sidepanel/views/SummaryView.vue` — render teaser CTA.
- `entrypoints/sidepanel/components/SummaryContent.vue` (hoặc slot trong SummaryView) — slot cho teaser.
- `entrypoints/sidepanel/views/KnowledgeView.vue`:
  - Đổi payload `SAVE_CACHED_TOPIC` (chỉ saved entries).
  - Thêm `toggleSave` sync với notebook.
  - Thêm button "Khôi phục danh sách" + handler `handleRestore`.
  - Thêm nút "📒 Xem sổ tay" header.
  - Hỗ trợ query param `?focus={id}` để scroll/highlight entry.
- `entrypoints/sidepanel/views/TopicHubView.vue` — thêm CTA Sổ tay + confirm dialog khi xoá topic nhắc về notebook entries.

### Data flow

```
User toggle save trong KnowledgeView
  │
  ├── entries.value updated (local)
  │
  ├── SAVE_CACHED_TOPIC { knowledgeEntries: filter(saved) }
  │        → IDB topics store
  │
  └── UPSERT_NOTEBOOK_ENTRY { ...entry, sourceTopicUrl, sourceTopicTitle, savedAt }
            (hoặc DELETE_NOTEBOOK_ENTRY khi unsave)
           → IDB notebookEntries store
```

```
User mở NotebookView
  │
  ├── GET_NOTEBOOK_STATS → display header
  ├── GET_NOTEBOOK_ENTRIES (with filters) → render cards
  │
  └── (per entry) click "Open in extension"
        → router push /knowledge?focus={id}
          → KnowledgeView load topic by url (từ notebook entry) + scroll vào entry
```

### Dependencies giữa phases

- Phase A độc lập, không phụ thuộc B/C (chỉ render CTA + router).
- Phase B độc lập về kỹ thuật, nhưng UX không có ý nghĩa nếu chưa có B (vì entries vẫn auto-persist).
- Phase C **phụ thuộc** Phase B — vì notebook chỉ sync khi user toggle save, mà Phase B mới biến save thành hành động có ý nghĩa.

→ **Thứ tự bắt buộc:** B → C → A.
(A để cuối vì cần B+C ổn định để CTA dẫn user vào luồng đúng.)

### Edge cases

1. **User toggle save → unsave → save lại liên tục:** mỗi lần `UPSERT_NOTEBOOK_ENTRY` overwrite (key `entry.id` không đổi). OK.
2. **User mở 2 sidepanel cho 2 topic khác nhau, save entry từ topic A, sau đó từ topic B với cùng `entry.id`:** không xảy ra vì `entry.id` được generate uuid khi LLM extract — unique per call. Nếu cùng id (hi hữu) → notebook key trùng, overwrite. Document trong code, không xử lý đặc biệt.
3. **Source topic bị xoá trong khi NotebookView đang mở:** notebook entries của topic đó vẫn còn (cleanup C7 chỉ chạy sau khi user xoá). Nếu C7 chạy → NotebookView cần refresh on focus (đã có pattern `onActivated`).
4. **Khôi phục danh sách khi `knowledgeChunks` rỗng:** disable nút, hiển thị tooltip "Chưa có dữ liệu để khôi phục — bấm Trích xuất".
5. **Khôi phục khi `knowledgeChunks` có 1 chunk:** skip reduce LLM call, chỉ enrichEntries từ chunk[0].entries.
6. **IDB version bump (2→3) khi user có cache cũ:** `onupgradeneeded` chỉ tạo store mới, không touch store cũ. Safe.
7. **Notebook entry trỏ về topic không còn trong cache:** sau Phase C7, scenario này hiển thị orphan badge. "Open source" vẫn cho mở URL gốc. "Open in extension" disabled (hoặc deferred "Tạo lại topic").
8. **User unsave trong NotebookView nhưng source topic đang load trong sidepanel:** sau khi `DELETE_NOTEBOOK_ENTRY` + update topic cache (set `saved=false` trong knowledgeEntries — nhưng theo Phase B, knowledgeEntries chỉ chứa saved → effectively remove entry khỏi topic cache). Send message `RELOAD_TOPIC_CACHE` hoặc dùng cache invalidation pattern hiện có.
9. **Focus race condition** (xem C9a): `?focus={id}` vào KnowledgeView khi `entries` chưa load → phải dùng `watch + nextTick`, không gọi `getElementById` ngay trong `onMounted`.
10. **Focus query param bị giữ sau back/refresh:** sau khi focus xong, `router.replace` để clear query → tránh re-focus loop khi user filter hoặc switch tab.
11. **Entry bị filter khi đang được focus:** `getElementById` trả null → silently skip focus (acceptable trade-off; user đã chủ động filter). Có thể bonus auto-clear filter khi có focus query (deferred).
12. **MV3 SW termination giữa lúc UPSERT_NOTEBOOK_ENTRY:** `sendMessageQuiet` swallow lỗi → entry chưa được lưu vào notebook. Lần save tiếp theo sẽ sync lại (eventual consistency). Nếu user lo lắng: lazy reconciliation khi mở NotebookView (so sánh saved entries trong các topic cache với notebook entries, upsert những cái thiếu).
13. **User chọn "Chỉ xoá thớt — giữ kiến thức" nhưng entry có `orphaned=true` rồi (xoá lần 2 hoặc edge case sync):** `notebookOrphanByTopic` idempotent — overwrite `orphaned=true`, không gây lỗi.
14. **User dùng "Xoá cả" cho topic có 0 entries trong notebook:** skip notebook call, chỉ `deleteCachedTopic`. Dialog có thể đơn giản hoá thành confirm thường ở case này (xem C7).

### Constraints

- **Local-only:** notebook chỉ trong IDB của user. Không sync cloud.
- **Size:** mỗi `NotebookEntry` ~500–2000 bytes. 10000 entries ~10–20MB → safe trong quota IDB (mặc định ~50% free disk).
- **No external dependencies:** không thêm dexie hay idb wrapper library — dùng raw IDB API như cache-db.ts hiện tại.
- **Performance NotebookView:** list 500+ entries cần virtual scroll? — không trong scope F27 (defer to F28 nếu cần). Hiện tại render tất cả + search/filter client-side.

---

## Implementation Notes

### Thứ tự implement (Phase B trước, sau đó C, cuối cùng A)

**Phase B — opt-in persist (estimate 1–2 ngày):**
1. KnowledgeView: đổi mọi `SAVE_CACHED_TOPIC` payload `knowledgeEntries` → filter saved.
2. Thêm `handleRestore` + button "Khôi phục danh sách" (tái dùng `runReducePhase` với `entries = []`).
3. Update empty state logic — hiện CTA Restore nếu có chunks.
4. Test: extract → save 2/5 entries → reopen topic → chỉ thấy 2 entries → bấm Khôi phục → thấy lại 5.

**Phase C — personal notebook (estimate 3–4 ngày):**
1. `lib/cache-db.ts` — bump DB_VERSION + add notebookEntries store + indexes.
2. `lib/notebook-db.ts` — wrapper functions.
3. `lib/types.ts` — `NotebookEntry`, message types.
4. `background/index.ts` — 5 handlers.
5. Tích hợp `toggleSave` (B+C cross-cutting): gửi UPSERT/DELETE.
6. `NotebookView.vue` + route + composable.
7. `TopicHubView.vue` — entry point + confirm dialog when delete topic.
8. Test: save entry trong topic A + topic B → mở `/notebook` → thấy đủ → unsave từ NotebookView → biến mất + topic cache đồng bộ.

**Phase A — teaser CTA (estimate 0.5 ngày):**
1. `SummaryView.vue` — slot/render block sau `<SummaryContent>`.
2. Logic 3 trạng thái (chưa extract / có chunks / có saved).
3. Click handler push router + activate confirm.
4. Test: summarize topic → thấy CTA → click → vào KnowledgeView với confirm box mở sẵn.

### Patterns cần tái sử dụng

- **Optimistic update**: `useOptimisticUpdate` cho topic cache updates.
- **Fire-and-forget**: notebook sync (không block UI).
- **Cost guard**: Khôi phục danh sách phải qua `LLM_WARN_THRESHOLD_CALLS` check (tái dùng `confirmingExtract` pattern).
- **ConfirmInline component**: cho confirm dialog xoá topic (cảnh báo notebook entries).
- **`onActivated` refresh**: NotebookView reload khi user quay lại tab.

### Anti-patterns cần tránh

- **KHÔNG** auto-trigger LLM call ở bất kỳ điểm nào (Decision Log #2).
- **KHÔNG** gộp prompt summary + knowledge (Decision Log #1).
- **KHÔNG** đồng bộ notebook qua API hay localStorage — chỉ qua background message handlers + IDB.
- **KHÔNG** dùng `dbGetAll` trong hot path (search/filter trong NotebookView). Phải dùng index hoặc cache local trong composable.

---

## Test Plan

### Phase B

- [ ] Topic A có 10 entries sau extract → save 3 → close sidepanel → reopen → chỉ thấy 3.
- [ ] Topic A có 0 saved + có `knowledgeChunks` → nút "Khôi phục danh sách" hiển thị → bấm → reduce LLM call duy nhất → list 10 entries hiện về (unsaved).
- [ ] Topic A có 0 saved + 0 chunks → empty state với CTA "Trích xuất Kiến thức".
- [ ] Trích xuất bài mới (`newPostsCount > 0`): saved entries cũ được giữ, new entries hiện thêm chưa saved.
- [ ] Cost warning hiện đúng khi extract / restore vượt threshold.

### Phase C

- [ ] Save entry trong topic A → mở `/notebook` → thấy entry với source topic = A.
- [ ] Save 5 entries từ topic A + 3 từ topic B → notebook stats hiện "8 kiến thức từ 2 thớt".
- [ ] Filter by topic A trong NotebookView → chỉ thấy 5.
- [ ] Search "kinh nghiệm" — filter cả title + content + tags.
- [ ] Unsave từ NotebookView → entry biến mất + nếu topic A đang trong cache → `knowledgeEntries` không còn entry đó.
- [ ] Delete topic A từ TopicHubView khi A có entries trong notebook → confirm dialog cho 2 lựa chọn → chọn "Chỉ xoá thớt — giữ kiến thức" → topic bị xoá, notebook entries vẫn còn với badge "🪦 Mồ côi".
- [ ] Delete topic A → chọn "Xoá cả" → cả topic và notebook entries bị xoá.
- [ ] Delete topic A khi A có 0 entries trong notebook → confirm đơn giản (không hiện 2 lựa chọn).
- [ ] Trong NotebookView toggle "Chỉ hiện mồ côi" → chỉ list orphan entries.
- [ ] Notebook "Open source" cho orphan entry → tab mới mở URL gốc bình thường.
- [ ] Notebook "Open in extension" cho orphan entry → disabled / tooltip giải thích.
- [ ] Index `by-tags` (multiEntry: true) hoạt động: filter `tag="cảnh báo"` → chỉ trả entries có tag đó trong mảng `tags[]`, không load toàn bộ store.
- [ ] Focus race: từ NotebookView click "Open in extension" → KnowledgeView mở → entry tương ứng auto-expand + scroll + highlight ring 2s.
- [ ] Focus race với entry bị filter: vào `/knowledge?focus={id}` khi search query active loại entry đó → không crash, không scroll.
- [ ] MV3 SW lifecycle: close sidepanel ngay sau toggle save → reopen → entry đã sync vào notebook (test với SW idle timeout).
- [ ] `sendMessageQuiet` swallow lỗi: simulate `Extension context invalidated` → không exception trên console.
- [ ] Open source link → tab mới mở đúng URL + post#.
- [ ] Open in extension → router push `/knowledge?focus={id}` → KnowledgeView highlight entry tương ứng.
- [ ] IDB version bump: user upgrade từ extension cũ → DB upgrade thành công, store cũ không mất data.

### Phase A

- [ ] Sau summarize: thấy CTA trạng thái "Chưa có entries".
- [ ] Sau extract + save 2 entries: CTA hiện trạng thái "Đã lưu 2 kiến thức".
- [ ] Sau extract + 0 saved: CTA hiện "Đã có dữ liệu — Khôi phục".
- [ ] Click "Trích xuất" → vào KnowledgeView với confirm box mở sẵn.
- [ ] Click "Xem trong tab Kiến thức" → vào KnowledgeView không trigger gì.

### Integration

- [ ] Compile clean: `npm run compile`.
- [ ] Test suite pass: `npm run test`.
- [ ] Manual: full flow user — summarize → CTA → extract → save → open notebook → unsave → trở lại topic xác nhận đồng bộ.

---

## Rollback Plan

- **Phase A**: revert SummaryView.vue + SummaryContent slot → CTA biến mất.
- **Phase B**: revert KnowledgeView.vue `SAVE_CACHED_TOPIC` payload → behavior cũ (persist tất cả). Không cần migration.
- **Phase C**: revert cache-db DB_VERSION → 2 (Chrome sẽ skip downgrade — phải dùng `indexedDB.deleteDatabase()` workaround). **Hoặc**: giữ DB_VERSION=3 nhưng remove notebook-db.ts + handlers + view + route. Store rỗng cũng không gây hại.

→ Khuyến nghị nếu cần rollback Phase C: giữ schema, remove code path. Rollback bằng remove DB version là rủi ro.

---

## Decision Log

### Quyết định 1: Không gộp prompt Summary + Knowledge vào 1 LLM call
- **Đã chọn:** Hai prompt riêng biệt, hai LLM call riêng biệt (giữ kiến trúc hiện tại).
- **Lý do:**
  - Summary prompt rất "VOZ-flavored" (sarcasm detection, faction grouping, từ lóng); Knowledge prompt trung tính, structured output.
  - Output JSON 2 schema khác nhau, gộp vào 1 JSON output làm tăng rủi ro parsing (đã từng tốn công với `parseSummaryJSON` + `repairUnescapedQuotes`).
  - Map-reduce logic khác nhau: summary reduce gộp opinions theo phe, knowledge reduce dedupe theo title.
  - Output budget khác nhau: summary ~500 từ + quotes; knowledge up to 200 entries × ~200 tokens. Gộp dễ overflow context.
- **Đã cân nhắc nhưng loại:**
  - Gộp prompt — loại vì 4 lý do trên; tiết kiệm token marginal nhưng tăng failure rate.
  - Knowledge inline trong summary output (1 field `knowledgeEntries[]` thêm vào SummaryJSON) — loại vì làm SummaryJSON phình to, ảnh hưởng các consumer khác (ExportButton, ThreadAnalysis).
- **Điều kiện thay đổi:** Khi có LLM hỗ trợ structured output reliable (JSON Schema mode) và token cost trở thành bottleneck → cân nhắc lại.

### Quyết định 2: Mọi LLM trigger đều cần user xác nhận, không auto-call
- **Đã chọn:** CTA "Trích xuất" sau Summary chỉ điều hướng + open confirm box. "Khôi phục danh sách" cũng cần user click. Không có auto-extract ngầm.
- **Lý do:** User quan ngại "chi phí không kiểm soát" khi auto-call LLM (đặc biệt với paid API). Pattern hiện tại `confirmingExtract` đã quen.
- **Đã cân nhắc nhưng loại:**
  - Auto-call sau summary nếu topic nhỏ (< 1 chunk, < N posts) — loại vì vẫn có rủi ro paid call với model đắt; principle "user-in-control" quan trọng hơn UX shortcut.
  - Settings toggle "Auto-extract knowledge after summarize" — loại trong scope F27, có thể thêm sau nếu nhiều user yêu cầu.
- **Điều kiện thay đổi:** Nếu có cost meter realtime (F26 + future work) và user opt-in → mở Settings toggle.

### Quyết định 3: Không migration cho cached topics cũ
- **Đã chọn:** Topic cache cũ (đang có full `knowledgeEntries`) sẽ giữ nguyên data. Lần extract tiếp theo sẽ áp dụng filter saved (effectively xoá unsaved entries khỏi cache).
- **Lý do:** Project trong internal/dev phase — user là single developer, có thể clear cache nếu cần. Migration thêm code complexity và edge cases (mark tất cả `saved=true`? đặt flag `legacy`?).
- **Đã cân nhắc nhưng loại:**
  - Migration auto mark `saved=true` cho mọi entry hiện có — loại vì sẽ ép notebook chứa tất cả entries cũ → đúng concern "bãi rác" mà overhaul đang giải quyết.
  - Migration ngược lại: clear `knowledgeEntries` của mọi topic cũ — loại vì destructive, user mất data đã extract.
  - One-time prompt "Có muốn import N entries cũ vào sổ tay?" — loại vì over-engineer cho internal phase.
- **Điều kiện thay đổi:** Khi extension được publish public → cần một trong các migration strategy trên (prompt user là an toàn nhất).

### Quyết định 4: Personal Notebook dùng cùng IDB database, store mới
- **Đã chọn:** Bump `ai-diem-bao-cache` DB_VERSION từ 2 → 3, thêm object store `notebookEntries` cùng database.
- **Lý do:**
  - Đơn giản — 1 connection, 1 upgrade path.
  - Atomic transaction nếu cần (xoá topic + cleanup notebook entries → có thể cross-store txn).
  - Phù hợp pattern cache-db.ts hiện tại.
- **Đã cân nhắc nhưng loại:**
  - Tạo database riêng `ai-diem-bao-notebook` — loại vì 2 connections, không cần thiết, harder để query liên store.
  - Lưu notebook vào `chrome.storage.local` — loại vì storage.local limit 10MB, không index, search chậm.
- **Điều kiện thay đổi:** Nếu notebook grow vượt 100K entries → cân nhắc database riêng cho isolation.

### Quyết định 5: Notebook sync fire-and-forget (không rollback nếu fail)
- **Đã chọn:** `toggleSave` thực hiện optimistic update topic cache (có rollback) + fire-and-forget UPSERT/DELETE notebook (không rollback).
- **Lý do:**
  - Local IDB hiếm khi fail. Failure case (disk full, quota exceeded) là rare nhưng user nên biết qua console warning, không cần rollback UI.
  - Rollback notebook khi user đã unsave từ NotebookView dẫn đến UX confusion (entry "tự xuất hiện lại").
  - Source of truth cho "saved" là `entry.saved` trong topic cache → eventual consistency: lần extract tiếp theo / save next sẽ re-sync.
- **Đã cân nhắc nhưng loại:**
  - Đồng bộ atomic 2-phase commit (topic cache + notebook) — loại vì over-engineer cho local IDB.
  - Notebook là source of truth (topic cache derive từ notebook) — loại vì đảo ngược kiến trúc hiện tại, scope quá rộng.
- **Điều kiện thay đổi:** Nếu user report mất sync giữa topic và notebook thường xuyên → thêm reconciliation job khi mở sidepanel.

### Quyết định 6: Thứ tự implement Phase B → C → A
- **Đã chọn:** B trước (đổi semantics), C sau (build notebook trên semantics mới), A cuối (CTA dẫn vào luồng đã sẵn sàng).
- **Lý do:**
  - C phụ thuộc B (xem Dependencies section).
  - A là enhancement UX, không nên ship trước khi B/C ổn định (nếu A ship trước, CTA dẫn vào KnowledgeView vẫn chạy luồng cũ → confuse user).
- **Đã cân nhắc nhưng loại:**
  - A → B → C (theo thứ tự visible-first) — loại vì A khi đó không có hành vi đúng.
  - C đầu (build notebook isolated, integrate sau) — loại vì C cần `toggleSave` đã đổi behavior từ B.
- **Điều kiện thay đổi:** Nếu B chậm hơn dự kiến → có thể ship A với scope thu hẹp (chỉ CTA "Xem tab Kiến thức", không trạng thái "Đã lưu N").

### Quyết định 7: Khi xoá topic, default giữ kiến thức (orphan), không bulk delete
- **Đã chọn:** Confirm dialog cho 2 lựa chọn rõ ràng, default highlight "Chỉ xoá thớt — giữ kiến thức". Entry chuyển sang `orphaned=true` thay vì xoá. Hiện badge "🪦 Mồ côi" trong NotebookView.
- **Lý do:**
  - Kiến thức là tài sản user đã "đãi cát tìm vàng" để lưu. Việc user xoá topic (drama loãng, lỗi cache, không muốn nhìn thấy) không đồng nghĩa muốn vứt kiến thức.
  - "Retention moat" — nếu mỗi lần dọn cache user mất kiến thức đã save thì notebook không có giá trị dài hạn.
  - Destructive option vẫn có sẵn cho user muốn dọn sạch hoàn toàn.
- **Đã cân nhắc nhưng loại:**
  - Auto-delete kèm như bản đầu PRD — loại theo review point #4 về UX.
  - Settings toggle "Auto-orphan vs auto-delete khi xoá topic" — loại vì over-engineer; default tốt hơn switch.
  - Soft-delete topic 30 ngày rồi mới xoá entries — loại vì user mong đợi xoá là xoá ngay, soft-delete làm topic list rối.
- **Điều kiện thay đổi:** Nếu orphan entries phình to gây bloat IDB (>5000 orphans, hiếm xảy ra) → thêm batch action "Dọn orphan cũ hơn N ngày" trong NotebookView.

### Quyết định 8: Index `by-tags` dùng `multiEntry: true`
- **Đã chọn:** `tags` là `string[]` → index với `multiEntry: true` để IDB tự tách mảng. `category` (single string) giữ `multiEntry: false`.
- **Lý do:**
  - Query "entries có tag X" qua `IDBKeyRange.only(tag)` chạy thẳng trên index, không phải load all + filter RAM.
  - Quan trọng khi notebook scale lên (500+ entries × 5 tags trung bình = 2500 index records — vẫn fast với native B-tree IDB).
- **Đã cân nhắc nhưng loại:**
  - Load all + filter client-side — loại vì O(N) mỗi lần filter, lãng phí khi N lớn.
  - Tách bảng `tagsByEntry` riêng (junction table) — loại vì IDB native multiEntry đã giải quyết, không cần thêm store.
- **Điều kiện thay đổi:** Nếu sau này đổi schema `tags` thành nested object hoặc thêm `categories: string[]` array → audit lại tất cả indexes, flip `multiEntry` cho field mới.

### Quyết định 9: `sendMessageQuiet` helper cho fire-and-forget MV3 calls
- **Đã chọn:** Thêm helper vào `lib/messaging.ts` swallow lỗi sync (throw) + async (reject). Dùng cho mọi notebook sync và các action không cần response.
- **Lý do:**
  - MV3 SW có thể bị terminate khi idle. Calls trong khoảnh khắc wake-up/sleep dễ throw `Extension context invalidated` hoặc `Could not establish connection`.
  - Mỗi caller phải nhớ `.catch(() => {})` là anti-pattern — dễ quên gây Uncaught Exception bắn lên console user.
  - Helper centralize: 1 nơi định nghĩa policy "fire-and-forget".
- **Đã cân nhắc nhưng loại:**
  - Sửa `sendMessage` mặc định swallow lỗi — loại vì sẽ silent fail cho mọi caller (kể cả các call quan trọng cần response).
  - Retry mechanism cho notebook sync — loại vì over-engineer cho local IDB; eventual consistency đã đủ.
  - Queue pending messages khi SW ngủ — loại vì Chrome đã có message queue internal cho MV3.
- **Điều kiện thay đổi:** Nếu user report mất sync notebook thường xuyên (>1% rate) → thêm reconciliation khi mở NotebookView (so sánh saved entries của topic cache với notebook, upsert những cái thiếu).

### Quyết định 10: Focus race resolution dùng `watch + nextTick`, không `onMounted + getElementById`
- **Đã chọn:** Pattern `watch([entries.length, focusId], ...)` với `await nextTick()` + clear query param sau khi focus xong.
- **Lý do:**
  - `entries` load async từ IDB qua message → tại `onMounted` time list rỗng → `getElementById` trả null.
  - `watch` với `immediate: true` chạy ngay nếu đã sẵn, hoặc đợi entries arrive — handle cả 2 case.
  - `nextTick` đảm bảo DOM card đã render.
  - Clear `?focus=` sau focus tránh re-trigger khi user filter/refresh.
- **Đã cân nhắc nhưng loại:**
  - `setTimeout(scroll, 500)` — loại vì brittle, race condition vẫn có khả năng xảy ra với IDB chậm hoặc SW lifecycle.
  - Server-side rendering style `defineAsyncComponent` — loại vì Vue 3 + Vite SPA không có SSR.
  - Lift `entries` state lên App.vue pre-load — loại vì làm App nặng + leak state qua các tab.
- **Điều kiện thay đổi:** Nếu Vue 4 / Suspense API thay đổi → cân nhắc dùng `<Suspense>` boundary chờ entries load.

### Quyết định 11: NotebookView không có virtual scroll trong F27
- **Đã chọn:** Render tất cả notebook entries client-side. Search/filter client-side.
- **Lý do:** Realistic max trong internal phase ~500–1000 entries. Vue 3 render đủ nhanh ở mức này.
- **Đã cân nhắc nhưng loại:**
  - Virtual scroll (vue-virtual-scroller hoặc tự build) — loại vì thêm dependency / complexity cho scale chưa đến.
  - Pagination 50/page — loại vì worse UX cho search/filter.
- **Điều kiện thay đổi:** Khi notebook vượt 2000 entries hoặc user report lag → tách F28 thêm virtual scroll.
