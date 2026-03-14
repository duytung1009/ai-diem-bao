import type { ScrapedPost, LLMConfig } from '../types';
import { createProvider } from './factory';

const SUMMARY_SYSTEM_PROMPT = `Bạn là trợ lý AI chuyên tóm tắt các cuộc thảo luận trên diễn đàn.

Nhiệm vụ: Đọc các bài viết trong topic và tạo bản tóm tắt ngắn gọn, dễ hiểu theo format Markdown.

Yêu cầu:
- Viết bằng tiếng Việt
- Giữ bản tóm tắt dưới 500 từ
- Không thêm thông tin ngoài nội dung các bài viết
- PHẢI tuân theo format Markdown sau:

## Tóm tắt
Tóm tắt nội dung chính của cuộc thảo luận trong 2-3 đoạn ngắn.

## Quan điểm nổi bật
### Tên/mô tả quan điểm 1
Nội dung chi tiết, ghi rõ tác giả nếu có.
### Tên/mô tả quan điểm 2
Nội dung chi tiết, ghi rõ tác giả nếu có.

## Kết luận
Kết luận hoặc đồng thuận chung (nếu có).`;

const INCREMENTAL_SYSTEM_PROMPT = `Bạn là trợ lý AI chuyên cập nhật tóm tắt các cuộc thảo luận trên diễn đàn.

Nhiệm vụ: Bạn sẽ nhận bản tóm tắt cũ và các bài viết MỚI. Hãy cập nhật bản tóm tắt để bao gồm nội dung mới.

Yêu cầu:
- Viết bằng tiếng Việt
- Giữ bản tóm tắt dưới 500 từ
- Giữ nguyên thông tin cũ vẫn còn liên quan, bổ sung thông tin mới
- PHẢI tuân theo format Markdown sau:

## Tóm tắt
Tóm tắt nội dung chính của cuộc thảo luận trong 2-3 đoạn ngắn.

## Quan điểm nổi bật
### Tên/mô tả quan điểm 1
Nội dung chi tiết, ghi rõ tác giả nếu có.
### Tên/mô tả quan điểm 2
Nội dung chi tiết, ghi rõ tác giả nếu có.

## Kết luận
Kết luận hoặc đồng thuận chung (nếu có).`;

export async function summarizeTopic(
  posts: ScrapedPost[],
  config: LLMConfig,
): Promise<string> {
  const provider = createProvider(config);
  const response = await provider.summarize(posts, SUMMARY_SYSTEM_PROMPT);
  return response.content;
}

export async function updateSummary(
  previousSummary: string,
  newPosts: ScrapedPost[],
  config: LLMConfig,
): Promise<string> {
  const provider = createProvider(config);
  // Prepend the previous summary as a context post
  const postsWithContext: ScrapedPost[] = [
    { author: 'SYSTEM', content: `[BẢN TÓM TẮT CŨ]\n${previousSummary}`, timestamp: '', postNumber: 0 },
    ...newPosts,
  ];
  const response = await provider.summarize(postsWithContext, INCREMENTAL_SYSTEM_PROMPT);
  return response.content;
}

export async function testLLMConnection(config: LLMConfig): Promise<boolean> {
  const provider = createProvider(config);
  return provider.testConnection();
}
