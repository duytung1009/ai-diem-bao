# Cơ chế Research / Q&A

> Cập nhật: 2026-04-29

## Tổng quan

Tab **Tra cứu** (Research) cho phép user đặt câu hỏi cụ thể về nội dung thread và nhận câu trả lời có trích dẫn. Hỗ trợ news detection — tự động fetch bài báo gốc nếu topic là article page.

## Research Flow

```
ResearchView.vue
    │
    ├── User nhập câu hỏi
    │
    ├── useLLM.researchTopic(posts, question)
    │   └── createTask('research', { posts, question })
    │
    ├── Background processLLMTask()
    │   └── summarizer.researchTopic(posts, question, config)
    │       └── RESEARCH_PROMPT + posts + question → LLM
    │
    ├── LLM_RESULT → answer
    │
    └── Append vào cachedTopic.researchHistory[]
        └── SAVE_CACHED_TOPIC
```

### Prompt (`RESEARCH_PROMPT`)

LLM nhận posts + câu hỏi. Yêu cầu:
- Trả lời trực tiếp, súc tích
- Trích dẫn bài viết: `"Theo [Tác giả](#số bài):..."`
- Format Markdown (danh sách, tiêu đề nếu phù hợp)
- Nếu không có thông tin: "Không tìm thấy thông tin về vấn đề này trong topic."

### Research History

```typescript
interface ResearchEntry {
  question: string;      // Câu hỏi
  answer: string;        // Câu trả lời (Markdown)
  askedAt: number;       // Timestamp
}
```

Lưu trong `CachedTopic.researchHistory` — append mỗi lần research mới. Render trong ResearchView như chat history.

## News Detection + Article Extraction

Tự động phát hiện nếu topic là news article và fetch nội dung bài báo gốc.

### `news-detector.ts`

```typescript
detectNewsThread(posts: ScrapedPost[], forumDomain: string): {
  isNews: boolean;
  articleUrls: string[];
}
```

Heuristic: kiểm tra post đầu tiên có chứa link bài báo, domain quen thuộc (vnexpress, tuoitre, v.v.) không.

### `article-extractor.ts`

```typescript
extractArticle(url: string): Promise<ArticleContent | null>
```

Gọi `SCRAPE_ARTICLE` message → background:
1. `fetch(url, { credentials: 'omit' })` — không cần cookie
2. `DOMParser` parse HTML
3. Extract title + content (heuristic: `article` tag, `[itemprop=articleBody]`, `[role=main]`)
4. Strip scripts, ads, unrelated elements

### Enrich Flow

```typescript
enrichWithNewsArticles(posts, topicUrl, onStatus, onInfo)
  → detectNewsThread(posts, forumDomain)
    → isNews? → SCRAPE_ARTICLE → articlePosts
    → prepend article posts (postNumber = -1, -2, ...) vào posts
```

LLM nhận cả bài báo gốc + bình luận forum để tóm tắt đầy đủ.

## Chunked Research

Nếu posts vượt context limit, research dùng map-reduce tương tự summarize:
1. `chunkPosts()` → chunks
2. Mỗi chunk được research riêng với câu hỏi
3. Gộp kết quả trong reduce phase
