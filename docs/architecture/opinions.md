# Cơ chế Phân tích Ý kiến (Opinions)

> Cập nhật: 2026-04-29

## Tổng quan

Opinion analysis nhóm các quan điểm trong thread, xác định phe ủng hộ/phản đối, và hiển thị supporter bars. Đây là một phần của output JSON từ tab Tóm tắt — không phải task riêng biệt.

## Data Model

### Trong `SummaryJSON`

```typescript
interface SummaryJSON {
  summary: string;           // Tóm tắt nội dung chính
  opinions: OpinionItem[];   // Mảng các quan điểm
  conclusion: string;        // Kết luận
}

interface OpinionItem {
  title: string;             // Tên quan điểm
  description: string;       // Mô tả chi tiết
  supporters: string[];      // Danh sách tác giả ủng hộ
  quotes: QuoteItem[];       // Trích dẫn tiêu biểu
}

interface QuoteItem {
  author: string;            // Tác giả
  postNumber: number;        // Số bài
  text: string;              // Trích dẫn nguyên văn
}
```

### Trong `CachedTopic`

```typescript
cachedTopic.summaryJson: SummaryJSON | undefined
cachedTopic.summarizedPostCount: number  // Số bài đã tóm tắt (cho supporter %)
cachedTopic.totalPosts: number            // Tổng số bài
```

## Prompt (`OPINION_ANALYSIS_PROMPT`)

```typescript
export const OPINION_ANALYSIS_PROMPT = `...`;
```

Yêu cầu LLM:
- Tìm 2-4 nhóm quan điểm chính
- Ghi rõ số người ủng hộ + tên tác giả đại diện
- Trích dẫn tiêu biểu (1-2 câu)
- Đánh giá sentiment: "Tích cực", "Tiêu cực", "Trung lập"

Output format:
```json
{
  "mainTopic": "Đề tài chung",
  "sentiment": "Tích cực" | "Tiêu cực" | "Trung lập",
  "opinions": [
    {
      "name": "Tên quan điểm",
      "supporters": ["Tên tác giả"],
      "supporterCount": 5,
      "description": "Mô tả chi tiết",
      "quote": "Trích dẫn tiêu biểu"
    }
  ],
  "summary": "Tóm tắt tranh luận"
}
```

## Cross-Segment Author Dedup (F19)

Khi topic có nhiều segments, cùng một tác giả có thể xuất hiện ở nhiều segment → supporter count bị inflate.

### `buildAuthorCrossReference()`

Trước mỗi reduce call, hàm tìm tác giả xuất hiện ở ≥2 segments và prepend vào combined content:

```
=== TÁC GIẢ XUẤT HIỆN Ở NHIỀU PHẦN ===
- UserA: Phần 1 ('Quan điểm X'), Phần 3 ('Quan điểm Y')
```

LLM sẽ biết đây là cùng một người → không đếm trùng.

### `deduplicateSupporters()`

Sau khi reduce xong, safety net loại tên supporter trùng trong mỗi opinion (case-insensitive).

## Supporter Bars UI

Trong `SummaryJSON`:
- `opinions[]` chứa danh sách quan điểm
- `supporters[]` list tên supporter
- Supporter count = `supporters.length`
- Phần trăm = `supporters.length / summarizedPostCount * 100`

**Render:** Thanh ngang với width tương ứng %, hiển thị tên tác giả khi hover.

## Flow

```
summarize() hoặc updateSummary()
  │
  ├── LLM trả về SummaryJSON
  │     └── opinions[] chứa dữ liệu
  │
  ├── parseSummaryJSON() → validate
  │
  ├── OpinionsView redirect → KnowledgeView
  │     (tab Ý kiến đã được thay bằng tab Kiến thức)
  │
  └── SummaryContent hiển thị opinions
```

**Note:** Tab Ý kiến (`OpinionsView.vue`) hiện tại redirect sang tab Kiến thức. Opinions chỉ hiển thị trong `SummaryContent` component như một phần của summary output.
