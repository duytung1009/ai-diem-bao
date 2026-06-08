<context>
# Overview
Tính năng "Điểm báo" (News Feed / Hot Threads) — hiển thị danh sách các thớt (thread) nổi bật có hoạt động trong ngày từ forum XenForo. Extension sẽ scrape các trang danh sách thớt (forum listing page), lọc thớt có comment/tương tác trong ngày, chấm điểm độ "hot", và hiển thị top 5‑10 thớt dưới dạng danh sách giống giao diện trang forum view.

Giá trị: Người dùng không cần vào từng box forum để xem có thớt nào đang hot — extension tự động tổng hợp và hiển thị một "trang nhất" các thớt đáng đọc nhất trong ngày.

# Core Features

### F1 — Forum Listing Scraper (XF2 + XF1)
Scrape trang danh sách thớt (forum listing page) của XenForo để trích xuất metadata từng thớt: title, URL, tác giả, ngày tạo, số reply, số view, tác giả & thời gian bài cuối, sticky/locked status, số trang (từ page links). Hỗ trợ cả XF1 và XF2 (ưu tiên XF2 trước).

### F2 — Hot Thread Scoring & Ranking
Thuật toán chấm điểm thớt dựa trên trọng số:
- `replyCount × 3` — số lượng comment là tín hiệu mạnh nhất
- `viewCount × 0.1` — lượt xem cao = quan tâm cao  
- `(pageCount - 1) × 10` — thớt nhiều trang = thảo luận sôi nổi
- `recencyBonus` — bài mới nhất càng gần hiện tại càng được cộng điểm (max bonus khi < 1h)
Chỉ giữ thớt có last post ≤ 24h. Sắp xếp giảm dần theo score, lấy top N (default 10, configurable).

### F3 — News Feed View (Vue component)
Trang `/newsfeed` hiển thị danh sách thớt hot dưới dạng bảng/card, layout tương tự trang forum view XenForo:
- **Sticky threads** ở trên cùng (nếu có), có badge "Ghim"
- **Thread thường** bên dưới, mỗi hàng hiển thị: title (clickable → mở tab mới), tác giả + ngày tạo, jump đến trang (page-1, page-2, ... page-N), số reply, số view, tác giả & thời gian bài cuối
- **Phân trang** nếu nguồn có nhiều thread (scroll-based hoặc page nav)
- **Refresh button** để scrape lại
- **Loading skeleton** khi đang scrape
- **Empty state** khi không tìm thấy thớt nào

### F4 — Forum Source Selection
Cho phép người dùng chọn forum nguồn để scrape (ví dụ: "Điểm báo", "Chuyện trò linh tinh", "Kinh tế - Tài chính", ...). MVP chỉ scrape forum hiện tại (nơi user đang browse), nhưng kiến trúc hỗ trợ multi-forum.

### F5 — FEATURE 35 (Bài toán tương tự): Hỗ trợ scrape reactions cho thớt trong danh sách
Nếu forum hỗ trợ reactions, bổ sung reaction counts vào scoring (like count × 1.5, dislike count không cộng điểm nhưng hiển thị).

# User Experience

### User Persona
- **Người đọc VOZ lướt nhanh** — muốn biết hôm nay có thớt nào hot mà không cần vào từng box
- **Người theo dõi tin tức** — quan tâm các thớt dạng "điểm báo", "tin tức", muốn đọc nhanh title + stat để quyết định có vào đọc không

### Key User Flow
1. User mở Side Panel → thấy tab "Điểm báo"
2. Click tab "Điểm báo" → extension tự động scrape forum listing (FETCH_HTML qua background)
3. Hiển thị loading skeleton trong lúc scrape
4. Sau scrape, hiển thị danh sách thread hot (5‑10 thớt), sorted by hot score
5. User click vào title thớt → mở tab mới đến thớt đó
6. User có thể click Refresh để cập nhật danh sách
7. User có thể chọn forum nguồn khác (future)

### UI/UX Considerations
- Layout phải mô phỏng đúng XenForo forum view để user cảm thấy quen thuộc
- Phân biệt sticky threads (background khác, pin icon, đặt trên cùng)
- Hiển thị relative time ("5 phút trước", "2 giờ trước", "Hôm qua...") cho last post
- Color-code thread heat: 🔥 (rất hot), ⚡ (hot), không icon (bình thường)
- Responsive: hoạt động tốt trong side panel hẹp (400‑500px)
</context>
<PRD>
# Technical Architecture

## System Components

### 1. Forum Lister (`lib/scrapers/forum-lister.ts`) — NEW FILE
Trích xuất danh sách thớt từ HTML trang forum listing (XF2/XF1).
```
export interface ForumThreadSummary {
  title: string;           // Tên thớt
  url: string;             // URL đầy đủ của thớt
  author: string;          // Người tạo thớt
  authorUrl?: string;      // Link profile tác giả (optional)
  startDate: string;       // Ngày tạo (ISO hoặc raw text)
  replyCount: number;      // Số reply (tính cả bài #1)
  viewCount: number;       // Số lượt xem
  lastPostAuthor: string;  // Tác giả bài cuối
  lastPostTime: string;    // Thời gian bài cuối (ISO hoặc raw)
  lastPostUrl?: string;    // Link đến bài cuối
  isSticky: boolean;       // Thread có được ghim không
  isLocked: boolean;       // Thread có bị khóa không
  pageCount: number;       // Số trang (tính từ page links)
  forumName?: string;      // Tên forum chứa thread (khi multi-forum)
  hasPoll?: boolean;       // Có poll không (XF2 signal)
}

// Hàm chính:
export function scrapeForumList(doc: Document, forumUrl: string): ForumThreadSummary[]
```

**XF2 DOM Structure (target) cho forum listing:**
- Container: `.structItem--thread` (class này trên mỗi `<div>` thread item)
- Title: `.structItem-title a[data-tp-primary="on"]` → text + href
- Author + startDate: `.structItem-startDate a` → text, `time` → datetime attr
- Reply count: `.structItem-cell--meta dd:first-of-type` (text, parse số)
- View count: `.structItem-cell--meta dd:last-of-type`
- Last post author: `.structItem-cell--latest a.username` → text
- Last post time: `.structItem-cell--latest time` → datetime attr hoặc data-time
- Last post URL: `.structItem-cell--latest a[href*="/post-"]` → href
- Sticky: `.structItem--thread.structItem--sticky` (class existence)
- Locked: `.structItem--thread` chứa icon `.fa-lock`, `.structItem-status--locked`
- Page count: `.structItem-pageJump a` count (các link page‑2, page‑3...)
- Forum name (multi-forum): parent container title hoặc `.structItem-minor` text
- Poll: `.structItem-status--poll` icon existence

**XF1 DOM Structure:** cần research live page, pattern tương tự nhưng selector khác (`.threadListItem`, `.title`, `.posterDate`, v.v.)

**Strategy pattern:** Interface chung + 2 implementation (XF1 / XF2) tương tự scraper hiện tại.

### 2. Hot Thread Scorer (`lib/hot-threads.ts`) — NEW FILE
```
export interface HotThreadScore {
  thread: ForumThreadSummary;
  scores: {
    replyScore: number;
    viewScore: number;
    pageScore: number;
    recencyBonus: number;
    total: number;
  };
  heat: 'fire' | 'hot' | 'normal';  // 🔥 > score threshold, ⚡ > threshold, else normal
}

export function scoreThreads(threads: ForumThreadSummary[], now?: Date): HotThreadScore[]
export function filterToday(threads: ForumThreadSummary[], maxHoursAgo?: number): ForumThreadSummary[]
```

**Scoring formula:**
```
replyScore = replyCount × 3
viewScore = viewCount × 0.1
pageScore = (pageCount - 1) × 10
hoursAgo = max(0, (now - lastPostTime)) / 3600000
recencyBonus = max(0, 50 - hoursAgo × 2)  // max 50 bonus nếu < 1h, giảm dần
total = replyScore + viewScore + pageScore + recencyBonus

heat tiers:
  total >= 100  → 'fire' (🔥)
  total >= 30   → 'hot' (⚡)
  else          → 'normal'
```

**Configurable params:** `REPLY_WEIGHT`, `VIEW_WEIGHT`, `PAGE_WEIGHT`, `RECENCY_MAX_BONUS`, `MAX_AGE_HOURS`, `TOP_N` — đọc từ Settings hoặc hằng số.

### 3. Message Types — ADD to `lib/types.ts`
```typescript
// MessageType additions:
| 'FETCH_FORUM_LIST'
| 'FORUM_LIST_RESULT'

// New data interface:
export interface ForumListRequest {
  forumUrl: string;
  page?: number;        // Default 1
}

export interface ForumListResult {
  threads: ForumThreadSummary[];
  page: number;
  totalPages?: number;  // từ pagination
  errors: string[];
  forumUrl: string;
  forumName?: string;
}

// Settings additions:
export interface NewsFeedSettings {
  maxThreads: number;        // default 10
  maxAgeHours: number;       // default 24
  autoRefresh: boolean;      // default true
  selectedForums: string[];  // future: multi-forum
  heatThresholds: { fire: number; hot: number };
  weights: { reply: number; view: number; page: number };
}
```

### 4. Background Handler — MODIFY `entrypoints/background/index.ts`
- Add case `FETCH_FORUM_LIST`: fetch forum listing page URL → parse HTML → extract threads → return `ForumListResult`
- Parsing logic có thể đặt trong background hoặc dùng pattern giống `page-loader.ts` (fetch HTML → DOMParser)

### 5. New View — `entrypoints/sidepanel/views/NewsFeedView.vue` — NEW FILE
Vue SFC component dạng `setup script`:
- **State:** `threads: ForumThreadSummary[]`, `scores: HotThreadScore[]`, `loading: boolean`, `error: string`, `selectedForum: string`
- **On mounted:** tự động detect forum hiện tại (từ active tab URL) → scrape forum listing → score → display
- **Template:** Table/card layout mô phỏng XenForo forum view
  - Mỗi thread row: title, stats (reply, view), meta (author, date, last activity)
  - Sticky threads section trước
  - Có thể dùng `<table>` hoặc flexbox grid
- **Scoring display:** icon 🔥/⚡ bên cạnh title, hoặc color gradient cho score
- **Empty state:** "Không tìm thấy thớt nào có hoạt động trong 24h qua."
- **Error state:** hiển thị lỗi nếu scrape fail
- **Refresh:** nút "Làm mới" để scrape lại

### 6. Route — MODIFY `lib/create-app.ts`
- Thêm route `/newsfeed` → lazy-load `NewsFeedView.vue`

### 7. Navigation — MODIFY `entrypoints/sidepanel/App.vue`
- Thêm tab "Điểm báo" vào top-level tab bar (giữa "Thớt" và "Sổ tay")
- Route name: `newsfeed`
- Tab này không cần `isThreadActive` context (là independent tab)

### 8. Composables (Optional, cho F5 reactions)
- `useNewsFeed.ts` — quản lý state scrape forum listing, scoring, refresh
- Nếu cần LLM để phân tích thớt hot (future), tích hợp với `useLLM.ts`

## Data Flow
```
User mở Side Panel tab "Điểm báo"
  │
  ▼
Sidepanel: detect active tab URL → suy ra forum URL (VD: /f/diem-bao.33/)
  │
  ▼
Sidepanel → sendMessage('FETCH_FORUM_LIST', { forumUrl })
  │
  ▼
Background: fetch(forumUrl) → DOMParser → scrapeForumList() → return { threads, totalPages }
  │
  ▼
Sidepanel: nhận ForumListResult → filterToday(threads) → scoreThreads(filtered) → sort by total desc
  │
  ▼
NewsFeedView: render danh sách top N thread hot (kèm sticky threads riêng)
  │
  ▼
User click thread title → window.open(thread.url) (mở tab mới)
```

## CSP & Permission Considerations
- `FETCH_FORUM_LIST` sử dụng pattern giống `FETCH_HTML`: background service worker fetch → trả raw HTML hoặc parsed result → sidepanel không gọi fetch trực tiếp (tránh CSP violation per KH1)
- KHÔNG thêm `host_permissions` mới — forum listing page fetch qua service worker
- KHÔNG thêm `tabs` permission — URL lấy từ content script `DETECT_XF` response (pattern hiện tại)
- Nếu cần support multi-forum (future), content script registration qua `registerContentScripts()` (pattern F37 đã có)

# Development Roadmap

## Phase 10.1 — MVP: Forum Lister + Basic Scoring + NewsFeedView
- [ ] Tạo `lib/scrapers/forum-lister.ts` — XF2 forum listing scraper
- [ ] Tạo `lib/hot-threads.ts` — scoring & filtering logic
- [ ] Thêm types (`ForumThreadSummary`, `ForumListRequest`, `ForumListResult`, `FETCH_FORUM_LIST` message type)
- [ ] Thêm message handler `FETCH_FORUM_LIST` trong background
- [ ] Tạo `NewsFeedView.vue` với layout cơ bản (table-based)
- [ ] Thêm route `/newsfeed` trong `create-app.ts`
- [ ] Thêm tab "Điểm báo" trong `App.vue` top bar
- [ ] Implement auto-detect forum từ active tab URL
- [ ] Test với VOZ "Điểm báo" forum (XF2)

## Phase 10.2 — UI Polish & UX
- [ ] Layout mô phỏng chính xác XenForo forum view (sticky threads, phân trang, stats columns)
- [ ] Relative time display ("5 phút trước", "2 giờ trước")
- [ ] Heat indicator (🔥/⚡ icons + color coding)
- [ ] Loading skeleton animation
- [ ] Empty state & error state
- [ ] Responsive layout cho side panel width

## Phase 10.3 — Multi-Forum & Advanced
- [ ] XF1 forum listing scraper
- [ ] Multi-forum scanning (chọn nhiều forum nguồn)
- [ ] Configurable settings (max threads, thresholds, weights)
- [ ] Pagination trong forum listing (scrape page 2, 3... nếu cần thêm thread)
- [ ] Caching forum list (tránh scrape lại mỗi lần mở tab)
- [ ] Reaction integration vào scoring (F5 — nếu forum có reactions trong listing)

# Logical Dependency Chain
1. **(Foundation)** `ForumThreadSummary` types + forum lister scraper (XF2) — không có data thì không có gì để hiển thị
2. **(Logic)** Scoring engine (`hot-threads.ts`) — pure function, testable độc lập
3. **(Infrastructure)** Background handler + message types — kết nối scraper với sidepanel
4. **(UI Shell)** `NewsFeedView.vue` + route + navigation entry — minimal UI để hiển thị kết quả
5. **(UI Polish)** Layout styling, time formatting, heat indicators, loading/error/empty states
6. **(Expansion)** XF1 support, multi-forum, settings, caching

# Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| XF2 DOM structure thay đổi (forum cập nhật template) | Scraper fail, không có thread | Defensive parsing với fallback selectors; hiển thị error thay vì crash |
| Forum listing page có quá nhiều thread → scrape chậm | UX chậm | Chỉ scrape page 1 (20‑30 thread); nếu cần thêm thì mới fetch page 2 |
| User không ở trang forum (đang ở thread page hoặc tab khác) | Không detect được forum URL để scrape | Fallback: cho phép user manual input forum URL; hoặc dùng forum mặc định trong settings |
| Background SW bị terminate khi đang parse HTML lớn | Mất dữ liệu scrape | Dùng keep-alive pattern (đã có), hoặc cache partial result |
| VOZ rate-limit / block nếu scrape quá nhiều | Scrape fail | Delay giữa các request (dùng scrapeDelayMs config), chỉ scrape 1 page |
| XF1 forum listing DOM khác hoàn toàn XF2 | Cần research riêng | Implement XF1 lister sau MVP, dùng strategy pattern |

# Appendix
## XF2 Forum Listing DOM Reference (VOZ example)
Dựa trên cấu trúc XF2 chuẩn (template `forum_view`):
```html
<div class="structItem structItem--thread js-inlineModContainer js-threadListItem-12345"
     data-author="Tên tác giả">
  <div class="structItem-cell structItem-cell--icon">...</div>
  <div class="structItem-cell structItem-cell--main">
    <div class="structItem-title">
      <a href="/threads/ten-thread.12345/" data-tp-primary="on">Tên thớt</a>
      <!-- page jump links -->
      <span class="structItem-pageJump">
        <a href="/threads/.../page-2">2</a>
        <a href="/threads/.../page-3">3</a>
      </span>
    </div>
    <div class="structItem-minor">
      <ul class="structItem-parts">
        <li><a class="username">Tác giả</a></li>
        <li><time datetime="2025-01-01T...">Ngày tạo</time></li>
      </ul>
    </div>
  </div>
  <div class="structItem-cell structItem-cell--meta">
    <dl class="pairs pairs--justified">
      <dt>Replies</dt> <dd>42</dd>
    </dl>
    <dl class="pairs pairs--justified">
      <dt>Views</dt> <dd>1K</dd>
    </dl>
  </div>
  <div class="structItem-cell structItem-cell--latest">
    <a href="/posts/1234/" class="structItem-latestDate">
      <time datetime="...">Thời gian</time>
    </a>
    <span class="username">Người cuối</span>
  </div>
</div>
```

## XF1 Forum Listing DOM (cần research thực tế)
Pattern dự kiến: `.threadListItem`, `.title a`, `.posterDate`, `.stats` (reply/view), `.lastPostInfo`. Cần verify trên forum XF1 thực tế.

## Scoring Calibration
Các trọng số đề xuất:
- `REPLY_WEIGHT=3`: mỗi reply đáng 3 điểm (thớt 100 reply = 300 điểm)
- `VIEW_WEIGHT=0.1`: mỗi 1000 view = 100 điểm
- `PAGE_WEIGHT=10`: mỗi trang thêm = 10 điểm (thớt 5 trang = +40 điểm)
- `RECENCY_MAX_BONUS=50`: bài cuối < 1h = +50, giảm 2 điểm mỗi giờ
- `FIRE_THRESHOLD=100`, `HOT_THRESHOLD=30`

Cần fine-tune sau khi có data thực tế từ VOZ.
</PRD>
