import type { SummaryJSON, KnowledgeEntry } from '@/lib/types';

export const mockSummaryResponses: Record<string, SummaryJSON> = {
  singleSegment: {
    summary: 'Topic thảo luận về vấn đề X với nhiều quan điểm trái chiều. Đa số ủng hộ phương án thận trọng.',
    opinions: [
      {
        title: 'Ủng hộ phương án thận trọng',
        description: 'Cho rằng cần chờ thêm dữ liệu trước khi quyết định',
        supporters: ['vozer_01', 'thanh_nien', 'doc_gia'],
        quotes: [
          { author: 'vozer_01', postNumber: 3, text: 'Cần thận trọng, không nên vội vàng.' },
          { author: 'thanh_nien', postNumber: 7, text: 'Tôi đồng ý, cần thêm thời gian.' },
        ],
      },
      {
        title: 'Ủng hộ hành động ngay',
        description: 'Cho rằng đây là cơ hội không nên bỏ lỡ',
        supporters: ['nguoiquansat', 'chuyen_gia'],
        quotes: [
          { author: 'nguoiquansat', postNumber: 5, text: 'Cơ hội hiếm có, cần nắm bắt.' },
        ],
      },
    ],
    conclusion: 'Cần cân nhắc kỹ giữa rủi ro và cơ hội. Đa số nghiêng về thận trọng.',
  },

  segment1: {
    summary: 'Phần đầu: Giới thiệu vấn đề và các quan điểm ban đầu. Nhiều người bày tỏ lo ngại.',
    opinions: [
      {
        title: 'Lo ngại về rủi ro',
        description: 'Nhiều ý kiến bày tỏ quan ngại về tác động tiêu cực',
        supporters: ['vozer_01', 'la_khach', 'thuc_te'],
        quotes: [
          { author: 'vozer_01', postNumber: 2, text: 'Rủi ro rất lớn, cần cân nhắc.' },
          { author: 'la_khach', postNumber: 8, text: 'Tôi cũng thấy lo ngại.' },
        ],
      },
      {
        title: 'Lạc quan về tiềm năng',
        description: 'Một số người tin vào tiềm năng phát triển',
        supporters: ['chuyen_gia', 'nguoiquansat'],
        quotes: [
          { author: 'chuyen_gia', postNumber: 12, text: 'Tiềm năng rất lớn nếu làm đúng.' },
        ],
      },
    ],
    conclusion: 'Phần đầu chủ yếu là thảo luận mở, chưa có kết luận rõ ràng.',
  },

  segment2: {
    summary: 'Phần giữa: Phân tích chuyên sâu và so sánh với kinh nghiệm quốc tế.',
    opinions: [
      {
        title: 'Học hỏi từ mô hình Bắc Âu',
        description: 'Nhiều người đề xuất áp dụng mô hình Bắc Âu',
        supporters: ['thanh_nien', 'doc_gia', 'vozer_01'],
        quotes: [
          { author: 'thanh_nien', postNumber: 25, text: 'Mô hình Bắc Âu rất đáng học hỏi.' },
          { author: 'doc_gia', postNumber: 30, text: 'Đồng ý, họ làm rất tốt.' },
        ],
      },
      {
        title: 'Phù hợp với Việt Nam',
        description: 'Cần điều chỉnh cho phù hợp bối cảnh trong nước',
        supporters: ['chuyen_gia', 'thuc_te'],
        quotes: [
          { author: 'chuyen_gia', postNumber: 35, text: 'Không thể sao chép máy móc.' },
        ],
      },
    ],
    conclusion: 'Phần giữa đi sâu vào phân tích, nhiều so sánh quốc tế được đưa ra.',
  },

  segment3: {
    summary: 'Phần cuối: Đề xuất giải pháp và kết luận. Đa số thống nhất cần tiếp cận từng bước.',
    opinions: [
      {
        title: 'Tiếp cận từng bước',
        description: 'Đề xuất thí điểm trước khi mở rộng',
        supporters: ['vozer_01', 'thanh_nien', 'chuyen_gia', 'thuc_te'],
        quotes: [
          { author: 'vozer_01', postNumber: 45, text: 'Nên thí điểm quy mô nhỏ trước.' },
          { author: 'chuyen_gia', postNumber: 50, text: 'Đồng ý, cần đánh giá kết quả.' },
        ],
      },
      {
        title: 'Mở rộng nhanh',
        description: 'Một số ít cho rằng cần triển khai nhanh',
        supporters: ['nguoiquansat'],
        quotes: [
          { author: 'nguoiquansat', postNumber: 48, text: 'Cần nhanh kẻo lỡ cơ hội.' },
        ],
      },
    ],
    conclusion: 'Phần cuối đạt được sự đồng thuận tương đối về phương án tiếp cận từng bước.',
  },

  emptyOpinions: {
    summary: 'Topic này chủ yếu là chia sẻ thông tin, không có tranh luận đáng kể.',
    opinions: [],
    conclusion: 'Mọi người đều đồng tình với thông tin được chia sẻ.',
  },

  minimal: {
    summary: 'Tóm tắt ngắn gọn về chủ đề.',
    opinions: [],
    conclusion: 'Không có gì thêm.',
  },
};

export const mockKnowledgeResponses: Record<string, KnowledgeEntry[]> = {
  basic: [
    {
      id: 'know-1',
      title: 'Vấn đề X đã tồn tại từ lâu',
      content: 'Chủ đề này không mới, đã được thảo luận nhiều năm.',
      tags: ['bối cảnh', 'lịch sử'],
      source: { author: 'vozer_01', postNumber: 1 },
      extractedAt: Date.now(),
    },
    {
      id: 'know-2',
      title: 'Có 3 luồng ý kiến chính',
      content: 'Ủng hộ, phản đối, và trung lập.',
      tags: ['quan điểm', 'phân tích'],
      source: { author: 'thanh_nien', postNumber: 5 },
      extractedAt: Date.now(),
    },
  ],

  chunk1: [
    {
      id: 'chunk1-1',
      title: 'Bối cảnh lịch sử vấn đề',
      content: 'Xuất hiện từ 2020, bùng nổ 2022-2023, ổn định từ 2024.',
      tags: ['lịch sử', 'timeline'],
      source: { author: 'vozer_01', postNumber: 1 },
      extractedAt: Date.now(),
    },
    {
      id: 'chunk1-2',
      title: 'Tác động kinh tế',
      content: 'Chi phí phương án X cao hơn 15-20% nhưng hiệu quả tốt hơn 30%.',
      tags: ['kinh tế', 'chi phí'],
      source: { author: 'chuyen_gia', postNumber: 10 },
      extractedAt: Date.now(),
    },
  ],

  chunk2: [
    {
      id: 'chunk2-1',
      title: 'Kinh nghiệm quốc tế',
      content: 'Bắc Âu, Mỹ, Nhật Bản có các mô hình khác nhau.',
      tags: ['quốc tế', 'so sánh'],
      source: { author: 'doc_gia', postNumber: 25 },
      extractedAt: Date.now(),
    },
    {
      id: 'chunk2-2',
      title: 'Khuyến nghị ngắn hạn',
      content: 'Xây khung pháp lý, thí điểm, đào tạo nhân lực.',
      tags: ['khuyến nghị', 'ngắn hạn'],
      source: { author: 'thuc_te', postNumber: 30 },
      extractedAt: Date.now(),
    },
  ],
};

export function mockJsonResponse(json: SummaryJSON): string {
  return JSON.stringify(json, null, 2);
}

export function mockFencedResponse(json: SummaryJSON): string {
  return '```json\n' + JSON.stringify(json, null, 2) + '\n```';
}

export function mockBrokenJsonResponse(json: SummaryJSON): string {
  const raw = JSON.stringify(json);
  return raw.replace(/"([^"]*)"/g, (match, content) => {
    if (content.includes('cần') || content.includes('rủi ro')) {
      return `"${content.replace(/cần/g, 'cần "phải"')}"`;
    }
    return match;
  });
}

export function mockMarkdownResponse(json: SummaryJSON): string {
  return `Dưới đây là tóm tắt:\n\n\`\`\`json\n${JSON.stringify(json, null, 2)}\n\`\`\`\n\nHy vọng hữu ích!`;
}
