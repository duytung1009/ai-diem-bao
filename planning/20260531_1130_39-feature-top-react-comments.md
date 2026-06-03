# Feature 39: Bình luận nổi bật (Top React Comments)

## Overview

Cải tiến scraper để thu thập số lượng react (Ưng/Gạch) cho từng bài viết, sau đó hiển thị phần "Bình luận nổi bật" trong tóm tắt với định dạng:

```
* Top Ưng (159): doanh baby - [Xem bình luận](https://voz.vn/.../post-42007139)
* Top Ưng #2 (111): enninooo - [Xem bình luận](...)
* Top Gạch (190): vnzoom619 - [Xem bình luận](...)
```

Dữ liệu được tính toán **hoàn toàn client-side** từ posts đã scrape — không dùng LLM.

## Goals

- Thu thập react count (Ưng + Gạch) cho mỗi bài viết trong quá trình scraping
- Tính toán top N bài viết được ưng/gạch nhiều nhất
- Hiển thị section "Bình luận nổi bật" trong SummaryContent.vue với link trực tiếp đến bài viết
- Backward compat: topic cũ không có reaction data thì ẩn section này

## Requirements

### [Scraper — xf2-scraper.ts]

- Thêm `extractReactions(article: Element): PostReactions | undefined`
  - Target selectors (cần verify trên VOZ DOM):
    - Reaction bar: `.reactionsBar` hoặc `.js-reactionBarContainer`
    - Từng reaction item: `.reactionsBar-link` hoặc `.reaction-tooltip`
    - Type detection: alt text hoặc data attribute của reaction icon (`alt="Ưng"`, `alt="Gạch"`)
    - Count: text content của count element hoặc trong title attribute
  - Map reaction name → type:
    - "Ưng", "Like", "Thích" → `like`
    - "Gạch", "Dislike", "Brick" → `dislike`
  - Trả về `undefined` nếu không tìm thấy react bar (graceful degradation)
- Gọi `extractReactions` trong `scrapePosts` và gán vào `ScrapedPost.reactions`
- **Không cần extract reaction** cho xf1-scraper — XF1 (HVA/OtoFun cũ) không có reaction per-post

### [Types — lib/types.ts]

- Thêm interface `PostReactions`:
  ```ts
  export interface PostReactions {
    like?: number;
    dislike?: number;
  }
  ```
- Thêm field `reactions?: PostReactions` vào `ScrapedPost`
- Thêm interface `TopReactItem`:
  ```ts
  export interface TopReactItem {
    type: 'like' | 'dislike';
    count: number;
    author: string;
    postNumber: number;
  }
  ```

### [Computation — lib/top-reacts.ts (file mới)]

- Export function `computeTopReacts(posts: ScrapedPost[], topN: number = 3): TopReactItem[]`
  - Filter posts có `reactions.like > 0` → sort descending → take top N → map to `TopReactItem` với `type: 'like'`
  - Filter posts có `reactions.dislike > 0` → sort descending → take top N → map to `TopReactItem` với `type: 'dislike'`
  - Return combined array: tất cả likes trước, sau đó dislikes
  - Nếu không có post nào có reactions → return `[]`
- Hỗ trợ `posts` từ tất cả segments (caller flatten trước khi pass vào)

### [UI — entrypoints/sidepanel/components/SummaryContent.vue]

- Thêm prop `topReacts?: TopReactItem[]`
- Render section "Bình luận nổi bật" nếu `topReacts?.length > 0`, đặt **sau** section "Kết luận"
- Format từng item:
  - Like: `Top Ưng` (item đầu), `Top Ưng #2`, `Top Ưng #3`
  - Dislike: `Top Gạch`, `Top Gạch #2`, ...
  - Số lượng react trong ngoặc: `(159)`
  - Username + link: `doanh baby — [Xem bình luận](url)`
- Link sử dụng cùng logic `openPostLink(postNumber)` đã có, dùng `postPageMap`
- Nếu `topReacts` undefined hoặc empty → không render section (không để lộ heading rỗng)
- Cập nhật `formatSummaryAsText()` để include topReacts khi copy

### [View — entrypoints/sidepanel/views/SummaryView.vue]

- Tính `topReacts` từ `cachedTopic.posts` (và các segment posts nếu có)
- Pass xuống `SummaryContent` qua prop
- Flatten segment posts: collect từ `cachedTopic.segments[].posts` nếu có, else dùng `cachedTopic.posts`

## Technical Considerations

### DOM Scraping VOZ (XF2)

VOZ dùng XF2 reactions. Cần verify DOM structure thực tế. Dự kiến:
```html
<div class="message-reactionBar">
  <a class="reactionsBar-link" title="Xem reactions">
    <ul class="reactionsBar-reactionList">
      <li>
        <img alt="Ưng" class="smilie--sprite">
        <span>159</span>
      </li>
    </ul>
  </a>
</div>
```

Fallback nếu không parse được count → bỏ qua reactions (không break scraping).

### Backward Compatibility

- `ScrapedPost.reactions` là optional — posts cũ trong cache không có field này
- `computeTopReacts` với posts không có reactions → return `[]`
- UI chỉ render khi `topReacts.length > 0`

### Segments Support

Với topics có nhiều segments, posts nằm rải rác trong `cachedTopic.segments[].posts`. SummaryView phải flatten tất cả khi compute topReacts:
```ts
const allPosts = cachedTopic.segments?.flatMap(s => s.posts) ?? cachedTopic.posts;
```

### LLM — Không thay đổi

- Không thêm topReacts vào SummaryJSON schema
- Không yêu cầu LLM output reaction data
- Không thay đổi prompts

### Cache Compatibility

- `CachedTopic.posts` đã lưu `ScrapedPost[]` — khi re-scrape sẽ có reactions mới
- Old cache entries không có reactions → ẩn section (expected)

## Implementation Notes

Thứ tự implement:
1. `lib/types.ts` — thêm types mới (5 phút)
2. `lib/scrapers/xf2-scraper.ts` — thêm `extractReactions` (cần inspect VOZ DOM trước)
3. `lib/top-reacts.ts` — tạo file mới, function đơn giản (10 phút)
4. `entrypoints/sidepanel/views/SummaryView.vue` — pass topReacts prop (5 phút)
5. `entrypoints/sidepanel/components/SummaryContent.vue` — render section (15 phút)

**Lưu ý quan trọng**: Bước 2 cần inspect DOM trực tiếp trên VOZ để lấy đúng selectors trước khi code. Nếu không có browser access, cần dùng Claude in Chrome để inspect.

## Test Plan

1. Scrape một VOZ thread có nhiều react → verify `reactions` được populate trên posts
2. `computeTopReacts` trả về đúng top N theo count, đúng thứ tự
3. UI hiển thị đúng format: số, tên, link
4. Click link → mở đúng tab bài viết đó
5. Topic cũ không có reactions → section ẩn, không crash
6. Topic với segments → flatten đúng, react count đúng

## Decision Log

### Quyết định 1: Client-side computation vs LLM-generated

- **Đã chọn:** Client-side, tính từ scraped reactions
- **Lý do:** Chính xác 100% (đếm từ DOM), nhanh hơn (không LLM call thêm), không tốn token, LLM không "thấy" tất cả posts trong các topic lớn nên không đáng tin cậy để đếm react
- **Đã cân nhắc nhưng loại:**
  - LLM trích xuất từ posts — loại vì LLM không có react count trong text posts, cần inject thêm data mới dùng được
- **Điều kiện thay đổi:** Không có lý do thay đổi approach này

### Quyết định 2: Không thêm topReacts vào SummaryJSON

- **Đã chọn:** Compute at display time từ `CachedTopic.posts`, không lưu vào SummaryJSON
- **Lý do:** Giữ SummaryJSON thuần LLM output. React data là metadata từ scraper, không liên quan đến LLM. Tránh schema migration. Backward compat tự nhiên.
- **Đã cân nhắc nhưng loại:**
  - Lưu vào `SummaryJSON.topReacts` — loại vì không cần thiết và gây phức tạp schema + JSON schemas update
  - Lưu vào `CachedTopic` riêng — loại vì có thể derive từ posts sẵn có
- **Điều kiện thay đổi:** Nếu sau này muốn export topReacts trong JSON export → có thể xem xét lưu vào CachedTopic

### Quyết định 3: Chỉ hỗ trợ XF2, bỏ XF1

- **Đã chọn:** Chỉ implement cho xf2-scraper
- **Lý do:** VOZ (mục tiêu chính) là XF2. XF1 (các forum cũ) không có reaction system tương đương
- **Điều kiện thay đổi:** Nếu có forum XF1 nào có reactions → extend lúc đó

### Quyết định 4: Top 3 Ưng + Top 3 Gạch (có thể điều chỉnh)

- **Đã chọn:** `topN = 3` cho mỗi loại
- **Lý do:** Cân bằng giữa thông tin hữu ích và không làm nặng UI. User example cho thấy Top 3 Ưng + Top 1 Gạch là phù hợp
- **Điều kiện thay đổi:** Nếu user feedback muốn nhiều hơn/ít hơn → adjust constant
