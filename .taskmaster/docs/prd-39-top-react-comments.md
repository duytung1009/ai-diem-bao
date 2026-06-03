<context>
# Overview
Tính năng "Bình luận nổi bật" (Top React Comments) thu thập số lượng react (Ưng/Gạch) cho từng bài viết trong quá trình scraping XenForo 2 (VOZ), sau đó hiển thị top N bài viết được ưng/gạch nhiều nhất trong phần tóm tắt. Dữ liệu được tính toán hoàn toàn client-side từ posts đã scrape — không dùng LLM.

# Core Features
1. **Thu thập reaction data** — scraper XF2 extract số lượng Ưng/Gạch từ DOM mỗi bài viết
2. **Tính toán top reacts** — function `computeTopReacts` client-side sort và lấy top N like/dislike posts
3. **Hiển thị trong Summary** — section "Bình luận nổi bật" trong SummaryContent.vue với link trực tiếp đến bài viết
4. **Backward compat** — topic cũ không có reaction data thì ẩn section

# User Experience
- User thấy ngay bài viết nào được cộng đồng đánh giá cao nhất (Ưng) hoặc gây tranh cãi (Gạch)
- Click "Xem bình luận" mở tab mới đến đúng bài viết đó
- Format: `* Top Ưng (159): doanh baby - [Xem bình luận](url)`
</context>
<PRD>
# Technical Architecture

## Types — `lib/types.ts`
- Thêm `PostReactions { like?: number; dislike?: number }`
- Thêm `reactions?: PostReactions` vào `ScrapedPost`
- Thêm `TopReactItem { type: 'like' | 'dislike'; count: number; author: string; postNumber: number }`

## Scraper — `lib/scrapers/xf2-scraper.ts`
- Thêm `extractReactions(article: Element): PostReactions | undefined`
  - Target selectors: `.reactionsBar` / `.js-reactionBarContainer`, `.reactionsBar-link`
  - Map reaction name: "Ưng", "Like", "Thích" → `like`; "Gạch", "Dislike", "Brick" → `dislike`
  - Trả về `undefined` nếu không tìm thấy (graceful degradation)
- Gọi trong `scrapePosts` và gán vào `ScrapedPost.reactions`
- Không cần cho xf1-scraper

## Computation — `lib/top-reacts.ts` (file mới)
- Export `computeTopReacts(posts: ScrapedPost[], topN: number = 3): TopReactItem[]`
- Filter like > 0 → sort desc → take topN → map `type: 'like'`
- Filter dislike > 0 → sort desc → take topN → map `type: 'dislike'`
- Return combined: likes trước, dislikes sau; `[]` nếu không có

## UI — `SummaryContent.vue`
- Prop `topReacts?: TopReactItem[]`
- Section "Bình luận nổi bật" sau "Kết luận" nếu `topReacts.length > 0`
- Format: `Top Ưng` / `Top Ưng #2` / `Top Gạch` / ...
- Link dùng `openPostLink(postNumber)` + `postPageMap`
- Cập nhật `formatSummaryAsText()` include topReacts

## View — `SummaryView.vue`
- Tính `topReacts` từ cachedTopic.posts (flatten segments nếu có)
- Pass xuống SummaryContent qua prop

## Exclusions
- Không thay đổi LLM / SummaryJSON / prompts
- Không thay đổi cache schema
- Chỉ XF2, không XF1

# Development Roadmap

## Phase 1: Types + Scraper
1. `lib/types.ts` — thêm PostReactions, TopReactItem types
2. `lib/scrapers/xf2-scraper.ts` — thêm extractReactions, gọi trong scrapePosts

## Phase 2: Computation
3. `lib/top-reacts.ts` — file mới với computeTopReacts

## Phase 3: UI
4. `SummaryView.vue` — flatten posts, compute topReacts, pass prop
5. `SummaryContent.vue` — render section, formatSummaryAsText update

# Logical Dependency Chain
Types → Scraper → Computation → View → UI Component
Đây là dependency tuyến tính, mỗi bước built trên bước trước.

# Risks and Mitigations
- **DOM structure không match**: Cần inspect VOZ DOM thực tế. Fallback: extractReactions trả về undefined không break scraper.
- **XF1 không support**: Đã quyết định bỏ qua, chỉ XF2.
- **Cache backward compat**: reactions field optional, computeTopReacts với posts không có reactions → [] → UI ẩn.

# Decision Log
## Quyết định 1: Client-side computation vs LLM-generated
- Chọn client-side vì chính xác 100%, không tốn token
## Quyết định 2: Không thêm topReacts vào SummaryJSON
- Giữ SummaryJSON thuần LLM output
## Quyết định 3: Chỉ hỗ trợ XF2, bỏ XF1
## Quyết định 4: Top 3 cho mỗi loại (adjustable)
</PRD>
