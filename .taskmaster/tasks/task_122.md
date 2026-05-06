# Task ID: 122

**Title:** Thêm `totalPosts` vào `selectedTopicKey` để sync đúng khi totalPosts thay đổi

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Include `totalPosts` trong computed `selectedTopicKey` để watcher fire khi field này thay đổi (ví dụ sau re-summarize), đảm bảo `allTopics[idx]` sync đúng với `selectedTopic`

**Details:**

**File:** `entrypoints/sidepanel/views/TopicHubView.vue`

**Root cause:** `selectedTopicKey` (line 111) không track `totalPosts`. Khi chỉ `totalPosts` thay đổi (sau summarize + IDB update), watcher (line 114) không fire → `allTopics[idx].totalPosts` không sync.

**Implementation:**

1. **Update line 111:**
```typescript
return `${t.url}|${t.summary?.slice(0, 20) ?? ''}|${t.segments?.length ?? 0}|${t.bookmarked ?? false}|${t.knowledgeEntries?.length ?? 0}|${t.totalPosts ?? 0}`;
```

**Pseudo-code:**
```
COMPUTED selectedTopicKey:
  t = store.selectedTopic
  IF t is null → return null
  RETURN concatenate:
    - t.url
    - t.summary (first 20 chars)
    - t.segments.length
    - t.bookmarked
    - t.knowledgeEntries.length
    - t.totalPosts  ← NEW
  with "|" separator

WATCH selectedTopicKey:
  WHEN key changes:
    Find topic in allTopics with same URL
    IF found → merge selectedTopic fields into allTopics[idx]
```

**Why this matters:**
- Khi summarize xong, background script update `totalPosts` trong IDB
- `store.selectedTopic` được reload từ IDB → `totalPosts` mới
- Nếu không có trong key → watcher không fire → hub card vẫn hiện totalPosts cũ
- Thêm vào key → watcher fire → sync đúng

**Edge cases:**
- `totalPosts` undefined → `?? 0` → key = "...||0" ✓
- Topic chưa có trong `allTopics` → watcher add vào danh sách (line 132-140) ✓
- Key thay đổi nhiều lần (nhiều fields đổi cùng lúc) → watcher fire 1 lần (Vue batch) ✓

**Test Strategy:**

1. **Setup:** Topic cached có `totalPosts = 45`, `summarizedPostCount = 40`
2. **Test sync:** Mở summary view → trigger summarize toàn bộ → sau khi xong, verify:
   - IDB có `totalPosts = 50` (mocked)
   - `allTopics[idx].totalPosts = 50` (synced từ selectedTopic)
   - Hub card hiện "50 bài" đúng
3. **Test không leak:** Thay đổi field KHÁC (ví dụ `bookmarked`) → verify watcher fire, `totalPosts` không bị ghi đè
4. **Test new topic:** Summarize topic chưa có trong cache → verify watcher add vào `allTopics` với `totalPosts` đúng
5. **Regression test:** Verify các field khác vẫn trigger watcher (summary, segments, bookmarked, knowledgeEntries)
