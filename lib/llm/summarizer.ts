import type { ScrapedPost, LLMConfig } from '../types';
import { createProvider } from './factory';

const SUMMARY_SYSTEM_PROMPT = `Bạn là trợ lý AI chuyên tóm tắt các cuộc thảo luận trên diễn đàn.

Nhiệm vụ: Đọc các bài viết trong topic và tạo bản tóm tắt ngắn gọn, dễ hiểu.

Yêu cầu:
- Viết bằng tiếng Việt
- Tóm tắt nội dung chính của cuộc thảo luận
- Nêu các quan điểm/ý kiến nổi bật (ghi rõ tác giả nếu có)
- Nêu kết luận hoặc đồng thuận chung (nếu có)
- Giữ bản tóm tắt dưới 500 từ
- Không thêm thông tin ngoài nội dung các bài viết`;

export async function summarizeTopic(
  posts: ScrapedPost[],
  config: LLMConfig,
): Promise<string> {
  const provider = createProvider(config);
  const response = await provider.summarize(posts, SUMMARY_SYSTEM_PROMPT);
  return response.content;
}

export async function testLLMConnection(config: LLMConfig): Promise<boolean> {
  const provider = createProvider(config);
  return provider.testConnection();
}
