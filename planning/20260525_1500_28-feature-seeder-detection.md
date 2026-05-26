# Feature 28 — Seeder Detection & User Trust Score

## Overview

Phát hiện tự động các account có dấu hiệu seeder/shill dựa trên metadata account (join date, message count, reaction score) được scrape trực tiếp từ DOM XenForo, kết hợp với hành vi trong thread (tần suất post, pattern nội dung). Kết quả là trust score per-user, được highlight trực tiếp trên SummaryView khi hiển thị opinions và trên ThreadAnalysis.

Không dùng LLM cho scoring — pure heuristics, chạy local, không tốn token.

## Goals

- Scrape user metadata (join date, post count, reaction score) từ DOM XenForo khi đang load topic
- Tính trust score (0–100, càng thấp càng đáng ngờ) per username dựa trên heuristics
- Lưu score vào CachedTopic cùng với dữ liệu scraping
- Hiển thị badge/highlight trên UI cho user có score thấp (suspicious)
- Không breaking change — feature opt-in, graceful fallback khi không có metadata

## Requirements

### A. Scrape User Metadata từ DOM

XenForo 2 (standard) — mỗi `article.message` có sidebar:
```html
<aside class="message-userDetails">
  <dl class="pairs pairs--justified">
    <dt>Messages</dt><dd>42</dd>
    <dt>Reaction score</dt><dd>5</dd>
    <dt>Joined</dt><dd>Jan 5, 2024</dd>
  </dl>
</aside>
```

**VOZ (XF2 custom theme)** — cấu trúc khác: không có `aside`, dùng `div` bên trong `section.message-user`. Quan trọng hơn, VOZ **không hiển thị message count / join date / reaction score** trong sidebar thread. Chỉ có `userTitle` (cấp bậc):
```html
<section class="message-user">
  <div class="message-userDetails">
    <h4 class="message-name">...</h4>
    <h5 class="userTitle message-userTitle">Senior Member</h5>
  </div>
</section>
```

XenForo 1 — mỗi `li.message` có:
```html
<div class="messageUserInfo">
  <dl class="pairsJustified">
    <dt>Messages</dt><dd>42</dd>
    <dt>Likes Received</dt><dd>3</dd>
  </dl>
</div>
```

- Extend `ScrapedPost` với optional field `userMeta?: UserMeta`
- `UserMeta` interface:
  ```typescript
  interface UserMeta {
    messageCount?: number;   // Tổng số bài toàn forum
    reactionScore?: number;  // Reaction score / likes received
    joinDate?: string;       // ISO string hoặc raw text từ DOM
    userTitle?: string;      // Cấp bậc (e.g. "Senior Member", "Junior Member")
  }
  ```
- Chỉ scrape lần đầu gặp username (first occurrence per page), các bài sau của cùng user bỏ qua để tránh redundancy
- Graceful: nếu DOM không có → `userMeta: undefined`, không crash

#### VOZ Rank System

VOZ có hệ thống cấp bậc (`h5.userTitle`) dùng làm signal chính khi không có stats:

| Cấp bậc | Ý nghĩa | Score | Restricted |
|---|---|---|---|
| New Member | Tài khoản vừa đăng ký | 15 | ✅ |
| Junior Member | Mặc định sau tạo acc, hạn chế đăng bài | 25 | ✅ |
| Member | Đủ điều kiện cơ bản (120 ngày, avatar, liên kết MXH) | 70 | ❌ |
| Senior Member | Đã check-in xác thực, đăng được hầu hết chuyên mục | 80 | ❌ |
| Active Member | Tương tác & like ở mức cơ bản | 85 | ❌ |
| Well-known Member | Tích cực, nhiều đóng góp, nhiều Ưng | 90 | ❌ |
| Đã tốn tiền | Từng ủng hộ diễn đàn (SMS/quyên góp) | 85 | ❌ |
| Thành viên tích cực | Thủ công, bài chất lượng, uy tín | 90 | ❌ |
| Staff/Mod/Admin | Ban quản trị | 95 | ❌ |
| Title tùy chỉnh khác | Custom title từ Admin/Mod | `no_meta` | — |

`Restricted = true` → flag `voz_rank_restricted` → badge **"⚠ Acc hạn chế"** trên UI.

### B. Tính Trust Score

Logic chạy sau khi scrape xong toàn bộ topic (hoặc lazy khi mở tab Analysis). Output: `Map<username, TrustScore>`.

```typescript
interface TrustScore {
  username: string;
  score: number;           // 0–100, thấp = đáng ngờ hơn
  flags: TrustFlag[];      // Lý do bị flag
  postCountInThread: number;
  meta?: UserMeta;
}

type TrustFlag =
  | 'new_account'          // join date < 90 ngày tính từ ngày scrape
  | 'low_post_count'       // messageCount < 50
  | 'low_reaction_ratio'   // reactionScore / messageCount < 0.05
  | 'high_thread_activity' // postCountInThread > 5 AND score đã thấp
  | 'no_meta'              // Không có metadata để đánh giá
```

**Scoring formula (additive penalties):**

| Điều kiện | Penalty |
|---|---|
| Baseline | 100 |
| join date < 30 ngày | -40 |
| join date 30–90 ngày | -25 |
| join date 90–180 ngày | -10 |
| messageCount < 10 | -30 |
| messageCount 10–50 | -15 |
| reactionScore/messageCount < 0.02 | -20 |
| reactionScore/messageCount 0.02–0.05 | -10 |
| postCountInThread > 5 (khi score < 50) | -10 |

Score tối thiểu = 0. Không có metadata → score = null (không hiển thị badge).

Threshold hiển thị badge: score < 40 = "suspicious", 40–60 = "watch".

**VOZ rank-only mode** (khi chỉ có `userTitle`, không có stats):
Thay thế toàn bộ formula trên — dùng bảng `VOZ_RANK_SCORES` trong `trust-scorer.ts`.
Flag `voz_rank_restricted` → badge **"⚠ Acc hạn chế"** (màu cam, tương đương suspicious).
Title tùy chỉnh không nhận ra → `no_meta`, không hiển thị badge.

### C. Lưu trữ

- Thêm `userTrustScores?: Record<string, TrustScore>` vào `CachedTopic`
- Tính và lưu sau mỗi lần scrape hoàn tất (cùng lúc với save topic)
- Không tính lại khi chỉ load từ cache (đã có sẵn)
- Recalculate khi scrape thêm bài mới (incremental update)

### D. UI — Highlight trong SummaryView (Opinions)

Trong phần hiển thị opinions, mỗi khi mention username:
- Score < 40: badge màu vàng cam `⚠ Newbie` kèm tooltip giải thích flags
- Score 40–60: badge xám nhạt `? Ít hoạt động`
- Score >= 60 hoặc null: không có badge

Tooltip format: "Acc mới (30 ngày) · 12 bài toàn forum · Reaction thấp"

### E. UI — Highlight trong ThreadAnalysis

Trong `userProfiles` section của Thread Analysis view:
- Thêm trust indicator cạnh tên nhóm nếu nhóm đó chứa nhiều user score thấp
- Không thay đổi data structure của AI output — chỉ enrich UI bằng score đã tính

### F. Settings — Toggle

Thêm checkbox trong Settings: "Hiển thị chỉ số độ tin cậy tài khoản (Seeder Detection)" — mặc định ON.

## Technical Considerations

**Scraping timing:** User metadata chỉ có khi page đang load trong browser (content script). Khi scrape multi-page qua background fetch, `page-loader.ts` fetch raw HTML — metadata vẫn có trong HTML, cần parse từ DOMParser.

**Username dedup:** Một user có thể post nhiều trang. Map `username → UserMeta` được build dần qua các trang, chỉ lấy lần đầu (first-seen-wins vì metadata ít thay đổi trong thời gian ngắn).

**XF1 vs XF2:** Selectors khác nhau, cần abstract qua `extractUserMeta(article: Element, version: XenForoVersion): UserMeta | undefined`.

**Join date parsing:** DOM có thể trả về "Jan 5, 2024" hoặc relative "2 years ago" hoặc datetime attribute. Ưu tiên `<time datetime="...">` nếu có, fallback parse text với date-fns hoặc native Date.

**Privacy:** Không gửi username hay metadata ra ngoài. Toàn bộ xử lý local.

**Affected files:**
- `lib/types.ts` — thêm `UserMeta`, `TrustScore`, `TrustFlag`
- `lib/scrapers/xf2-scraper.ts` — extract userMeta trong `scrapePosts()`
- `lib/scrapers/xf1-scraper.ts` — extract userMeta trong `scrapePosts()`
- `lib/trust-scorer.ts` — NEW: tính trust score từ posts array
- `lib/cache-manager.ts` — lưu `userTrustScores` vào topic
- `entrypoints/background/index.ts` — gọi trust scorer sau khi scrape xong
- `entrypoints/sidepanel/views/SummaryView.vue` — hiển thị badge trên opinions
- `entrypoints/sidepanel/views/ThreadAnalysisView.vue` — enrich userProfiles
- `entrypoints/sidepanel/views/SettingsView.vue` — thêm toggle

## Implementation Notes

Thứ tự implement:
1. Types trước (`UserMeta`, `TrustScore`)
2. Scraper extract metadata (XF2 trước, XF1 sau)
3. `trust-scorer.ts` — pure function, dễ test
4. Wiring: background gọi scorer → save vào cache
5. UI: badge trên SummaryView opinions
6. UI: ThreadAnalysis enrich
7. Settings toggle

`trust-scorer.ts` nên là pure function `computeTrustScores(posts: ScrapedPost[]): Record<string, TrustScore>` — không có side effects, dễ unit test.

Join date parsing: dùng `new Date(str)` trước, nếu invalid thì regex parse "Jan 5, 2024" pattern. Không cần date-fns để tránh thêm dependency.

## Test Plan

- Unit test `trust-scorer.ts`: các case boundary (new account, no meta, high ratio)
- Manual test trên Voz thread có mix user cũ/mới — verify badge xuất hiện đúng
- Verify không crash khi forum không có metadata trong DOM (graceful fallback)
- Test XF1 forum nếu có access

## Decision Log

### Quyết định 1: Pure heuristics vs LLM-based scoring
- **Đã chọn:** Pure heuristics local
- **Lý do:** Không tốn token, chạy instant, không cần round-trip. LLM không có lợi thế ở đây vì metadata là số, không phải ngữ nghĩa.
- **Đã cân nhắc nhưng loại:**
  - LLM phân tích content pattern để detect shill text — loại vì tốn token, chậm, và accuracy không cao hơn đáng kể với heuristics cơ bản
- **Điều kiện thay đổi:** Nếu false positive rate quá cao → thêm content analysis layer (Phase 2)

### Quyết định 2: Lưu score trong CachedTopic vs tính on-the-fly
- **Đã chọn:** Lưu vào CachedTopic
- **Lý do:** Scoring cần toàn bộ posts để tính postCountInThread, và cần chạy một lần duy nhất. On-the-fly sẽ tính lại mỗi lần mở tab.
- **Đã cân nhắc nhưng loại:**
  - Tính lazy khi mở ThreadAnalysis tab — loại vì cần toàn bộ posts đã load, không biết khi nào đủ data
- **Điều kiện thay đổi:** Nếu schema CachedTopic quá nặng → move sang separate IndexedDB store

### Quyết định 3: Threshold hiển thị badge
- **Đã chọn:** < 40 = suspicious (cam), 40–60 = watch (xám)
- **Lý do:** Account mới (< 30 ngày) + ít bài (< 10) đã bị -70 điểm → score 30, hiển thị suspicious. Account bình thường với vài tháng tuổi và reaction ok sẽ > 60.
- **Điều kiện thay đổi:** Sau khi test thực tế, có thể cần calibrate lại threshold dựa trên false positive rate.

### Quyết định 5: VOZ không expose stats trong thread HTML
- **Đã chọn:** Dùng `userTitle` (cấp bậc) làm signal chính thay thế, với bảng score cố định
- **Lý do:** VOZ theme không render `dl.pairs` với message count / join date trong sidebar post. Chỉ có `h5.userTitle` là đáng tin cậy. Cấp bậc VOZ có ý nghĩa rõ ràng (New Member / Junior Member = tài khoản bị hạn chế), nên có thể map trực tiếp sang score.
- **Đã cân nhắc nhưng loại:**
  - Fetch thêm profile page để lấy stats — loại vì tốn request, chậm, cần thêm permission hoặc rate limit phức tạp hơn
  - Dùng member tooltip AJAX endpoint (`/members/{id}/card`) — loại vì cần reverse-engineer API, dễ bị ban
- **Điều kiện thay đổi:** Nếu VOZ cập nhật theme và expose stats trong HTML → branch `userTitle-only` bị bypass tự nhiên vì `messageCount` sẽ có giá trị

### Quyết định 4: Không flag username trong AI output
- **Đã chọn:** Enrich UI bằng pre-computed scores, không truyền score vào LLM prompt
- **Lý do:** Tránh bias AI output. Score là heuristic, không phải ground truth — không nên để AI kết luận dựa trên đó.
- **Điều kiện thay đổi:** Không có — quyết định này cố định.
