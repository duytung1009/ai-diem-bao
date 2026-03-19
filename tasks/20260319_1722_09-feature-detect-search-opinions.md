# Feature 09: Detect thread only, Topic Hub search/sort, Opinion bars, Fix OpinionsView cache

## Tổng quan
4 cải tiến UX đã implement: (1) chỉ detect trang bài viết cụ thể, (2) tìm kiếm + sắp xếp trong Topic Hub, (3) thanh bar tỷ lệ quan điểm trong tóm tắt, (4) fix không xem lại được ý kiến đã phân tích.

## Task 4: Fix OpinionsView stale state

**File:** `entrypoints/sidepanel/views/OpinionsView.vue`

**Bug:** `loadTopicData()` không reset `opinions` và `cachedTopic` khi chuyển topic → hiện data cũ của topic trước.

**Fix 1 — Reset state ở đầu `loadTopicData()`:**
```typescript
opinions.value = null;
cachedTopic.value = null;
```

**Fix 2 — `onActivated` refresh cache khi cùng topic:**
- Nếu URL khác → call `loadTopicData()` (như cũ)
- Nếu URL giống → fetch cache mới, sync `cachedTopic` + `opinions` (phòng data được update elsewhere)

## Task 1: Chỉ detect trang thread (không detect trang danh sách)

**File:** `entrypoints/content/index.ts`

**Thêm hàm `isThreadPage(v)` ở module level:**
- XF2: check `article.message` + (`dl.count--replies` || `.p-title-value`)
- XF1: check `li.message .messageText` || `#messageList .message`

**Gate `DETECT_XF` handler:**
```typescript
if (!isThreadPage(version)) {
  sendResponse(undefined);
  return false;
}
```

→ Forum list / homepage → sidepanel không detect → hiện empty state thay vì false positive.

## Task 2: Topic Hub — Tìm kiếm và Sắp xếp

**File:** `entrypoints/sidepanel/views/TopicHubView.vue`

**Thêm state:**
```typescript
const searchQuery = ref('');
const sortBy = ref<'recent' | 'posts' | 'title'>('recent');
```

**Thêm `filteredTopics` computed:** filter `allTopics` theo query + sort theo sortBy ('recent' = cachedAt desc, 'posts' = totalPosts desc, 'title' = localeCompare vi).

**Sửa `groupedTopics`:** dùng `filteredTopics` thay vì `allTopics` (giữ temp topic injection). Bỏ per-group sort vì đã sort globally.

**UI thêm vào template:**
- Search input với search icon (hiện khi `allTopics.length > 0`)
- 3 sort buttons: Mới nhất / Nhiều bài / Tên A-Z (active = blue highlight)
- Empty state khi search không có kết quả: "Không tìm thấy topic nào khớp..."
- Main empty state đổi từ `domainNames.length === 0` → `allTopics.length === 0`

## Task 3: Thanh bar tỷ lệ quan điểm nổi bật

### 3a. Sửa prompts

**File:** `lib/prompts.ts`

Cập nhật format `## Quan điểm nổi bật` trong 3 prompts (SUMMARY_PROMPT, INCREMENTAL_UPDATE_PROMPT, REDUCE_SUMMARY_PROMPT):
```
### Tên/mô tả quan điểm 1 (N người ủng hộ)
...
### Tên/mô tả quan điểm 2 (M người ủng hộ)
...
Trong đó N, M là số lượng tác giả ủng hộ quan điểm đó dựa trên bài viết.
```

### 3b. AccordionItem — thêm named slot `#title`

**File:** `entrypoints/sidepanel/components/AccordionItem.vue`
- `title` prop đổi sang optional (`title?: string`)
- Button header dùng `<slot name="title"><span>{{ title }}</span></slot>` thay vì plain `<span>{{ title }}</span>`
- Mọi usage cũ với `:title="..."` vẫn hoạt động qua slot fallback

### 3c. SummaryContent — parse count + render bars

**File:** `entrypoints/sidepanel/components/SummaryContent.vue`

**Opinion interface mới:**
```typescript
{ title: string; body: string; supporterCount: number | null }
```

**Section interface mới:**
```typescript
{ title: string; body: string; opinions?: ...; totalSupporters?: number }
```

**Parse logic:** regex `/\((\d+)\s*người[^)]*\)\s*$/` để extract count từ cuối title. Strip suffix khỏi display title.

**Template:** opinions accordion dùng `<template #title>` thay vì `:title` prop:
- Tên quan điểm bên trái
- Count ("N người") bên phải (ẩn nếu null)
- Bar `h-1.5 bg-blue-500` với width = `(count/total)*100%` (ẩn nếu count null hoặc total=0)
- **Graceful degradation:** LLM không trả về count → `totalSupporters=0` → bar không hiển thị → render như cũ

## Verification

- `npx vue-tsc --noEmit` → pass (no errors)
- `npm run build` → pass (303.33 kB)
