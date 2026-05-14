import type { ScrapedPost } from '@/lib/types';

interface PostFactoryOptions {
  count: number;
  contentLength?: 'short' | 'medium' | 'long' | 'very-long';
  topic?: string;
  authors?: string[];
  startPostNumber?: number;
}

const CONTENT_PRESETS: Record<string, (topic: string, author: string, index: number) => string> = {
  short: (topic, author, i) =>
    `Ý kiến về ${topic}: Tôi nghĩ vấn đề này khá đơn giản. Cần xem xét kỹ lưỡng trước khi quyết định.`,

  medium: (topic, author, i) =>
    `Về chủ đề ${topic}, cá nhân tôi có một số suy nghĩ như sau:\n\n` +
    `Thứ nhất, vấn đề này đã được thảo luận nhiều lần trên diễn đàn. ` +
    `Tuy nhiên, mỗi người có một quan điểm khác nhau và khó có thể thống nhất.\n\n` +
    `Thứ hai, theo kinh nghiệm của tôi, giải pháp khả thi nhất là tiếp cận từ từ, ` +
    `không nên vội vàng. Cần có thêm dữ liệu thực tế để đánh giá chính xác hơn.\n\n` +
    `Tóm lại, tôi ủng hộ phương án thận trọng, chờ thêm thông tin trước khi đưa ra kết luận cuối cùng.`,

  long: (topic, author, i) =>
    `Chào mọi người, tôi xin đóng góp ý kiến về chủ đề ${topic}.\n\n` +
    `**1. Bối cảnh hiện tại**\n` +
    `Vấn đề này không mới, đã xuất hiện từ khoảng 2-3 năm nay. ` +
    `Ban đầu chỉ là thảo luận nhỏ, nhưng giờ đã trở thành chủ đề nóng trên nhiều diễn đàn.\n\n` +
    `**2. Phân tích các quan điểm**\n` +
    `Hiện có 3 luồng ý kiến chính:\n` +
    `- Phe ủng hộ: Cho rằng đây là xu hướng tất yếu, cần thích nghi sớm.\n` +
    `- Phe phản đối: Lo ngại về rủi ro và tác động tiêu cực.\n` +
    `- Phe trung lập: Chờ đợi thêm bằng chứng thực tế trước khi kết luận.\n\n` +
    `**3. Kinh nghiệm thực tế**\n` +
    `Tôi đã theo dõi vấn đề này từ lâu và có một số quan sát:\n` +
    `Các trường hợp thành công thường có điểm chung: chuẩn bị kỹ, không vội vàng, ` +
    `có kế hoạch dự phòng. Ngược lại, những người thất bại thường do thiếu thông tin ` +
    `hoặc quá tự tin vào phán đoán cá nhân.\n\n` +
    `**4. Đề xuất**\n` +
    `Tôi nghĩ chúng ta nên:\n` +
    `- Thu thập thêm dữ liệu từ các nguồn đáng tin cậy\n` +
    `- Tham khảo ý kiến chuyên gia trong lĩnh vực\n` +
    `- Thử nghiệm quy mô nhỏ trước khi mở rộng\n\n` +
    `Kết luận: Cần thận trọng nhưng không nên quá bảo thủ. Cân bằng là chìa khóa.`,

  'very-long': (topic, author, i) =>
    `BÀI PHÂN TÍCH CHI TIẾT VỀ: ${topic}\n` +
    `Tác giả: ${author} | Bài viết số ${i}\n\n` +
    `=== PHẦN 1: TỔNG QUAN ===\n\n` +
    `Chủ đề này đã và đang gây tranh cãi mạnh mẽ trong cộng đồng. ` +
    `Để hiểu rõ vấn đề, chúng ta cần nhìn lại toàn bộ bối cảnh lịch sử và các sự kiện liên quan.\n\n` +
    `Lịch sử vấn đề:\n` +
    `- Giai đoạn 1 (2020-2021): Xuất hiện lần đầu, ít người chú ý\n` +
    `- Giai đoạn 2 (2022-2023): Bùng nổ thảo luận, nhiều quan điểm trái chiều\n` +
    `- Giai đoạn 3 (2024-nay): Dần đi vào ổn định, có thêm dữ liệu thực tế\n\n` +
    `=== PHẦN 2: PHÂN TÍCH CHUYÊN SÂU ===\n\n` +
    `2.1. Góc độ kinh tế\n` +
    `Về mặt kinh tế, vấn đề này tác động đến nhiều nhóm đối tượng khác nhau. ` +
    `Nhóm A chịu ảnh hưởng trực tiếp, trong khi nhóm B chịu tác động gián tiếp. ` +
    `Cần phân tích kỹ chi phí - lợi ích của từng phương án.\n\n` +
    `Theo số liệu từ các nghiên cứu gần đây, phương án X có chi phí triển khai khoảng ` +
    `15-20% cao hơn phương án Y, nhưng mang lại hiệu quả dài hạn tốt hơn khoảng 30%. ` +
    `Tuy nhiên, đây là ước tính trung bình, thực tế có thể khác biệt tùy trường hợp cụ thể.\n\n` +
    `2.2. Góc độ xã hội\n` +
    `Tác động xã hội là khía cạnh phức tạp nhất. Có nhiều yếu tố cần xem xét:\n` +
    `- Tâm lý đám đông: Dễ bị ảnh hưởng bởi thông tin một chiều\n` +
    `- Truyền thông: Đóng vai trò khuếch đại cả tích cực lẫn tiêu cực\n` +
    `- Giáo dục: Nâng cao nhận thức là giải pháp lâu dài\n\n` +
    `2.3. Góc độ pháp lý\n` +
    `Khung pháp lý hiện hành chưa theo kịp thực tế phát triển. ` +
    `Điều này tạo ra khoảng trống mà các bên liên quan cần lưu ý. ` +
    `Một số quy định cũ không còn phù hợp, cần được cập nhật.\n\n` +
    `=== PHẦN 3: SO SÁNH VỚI CÁC QUỐC GIA KHÁC ===\n\n` +
    `Kinh nghiệm quốc tế cho thấy nhiều cách tiếp cận khác nhau:\n` +
    `- Mô hình Bắc Âu: Chú trọng an sinh, chi phí cao nhưng hiệu quả tốt\n` +
    `- Mô hình Mỹ: Thị trường tự do, cạnh tranh cao, rủi ro lớn\n` +
    `- Mô hình Nhật Bản: Cân bằng giữa truyền thống và đổi mới\n\n` +
    `Việt Nam cần tìm mô hình phù hợp với đặc thù riêng, không nên sao chép máy móc.\n\n` +
    `=== PHẦN 4: KHUYẾN NGHỊ ===\n\n` +
    `Dựa trên phân tích trên, tôi đề xuất:\n\n` +
    `Ngắn hạn (1-2 năm):\n` +
    `1. Xây dựng khung pháp lý cơ bản\n` +
    `2. Thí điểm tại một số địa phương\n` +
    `3. Đào tạo nguồn nhân lực\n\n` +
    `Trung hạn (3-5 năm):\n` +
    `1. Mở rộng quy mô thí điểm\n` +
    `2. Hoàn thiện hệ thống giám sát\n` +
    `3. Đánh giá và điều chỉnh chính sách\n\n` +
    `Dài hạn (5+ năm):\n` +
    `1. Nhân rộng mô hình thành công\n` +
    `2. Hội nhập quốc tế\n` +
    `3. Liên tục cập nhật theo thực tiễn\n\n` +
    `=== KẾT LUẬN ===\n\n` +
    `Vấn đề ${topic} là chủ đề phức tạp, đòi hỏi cách tiếp cận đa chiều. ` +
    `Không có giải pháp hoàn hảo, chỉ có giải pháp phù hợp nhất trong bối cảnh cụ thể. ` +
    `Quan trọng nhất là giữ tư duy phản biện, không cực đoan, và luôn cập nhật thông tin mới.\n\n` +
    `Cảm ơn mọi người đã đọc. Mong nhận được thêm ý kiến đóng góp.`,
};

function pickAuthor(authors: string[], index: number): string {
  return authors[index % authors.length];
}

const DEFAULT_AUTHORS = [
  'vozer_01', 'nguoiquansat', 'thanh_nien', 'la_khach',
  'nguoi_cuoi_cung', 'doc_gia', 'chuyen_gia', 'thuc_te',
];

export function generatePosts(options: PostFactoryOptions): ScrapedPost[] {
  const {
    count,
    contentLength = 'medium',
    topic = 'chủ đề test',
    authors = DEFAULT_AUTHORS,
    startPostNumber = 1,
  } = options;

  const contentFn = CONTENT_PRESETS[contentLength];
  const posts: ScrapedPost[] = [];

  for (let i = 0; i < count; i++) {
    const postNumber = startPostNumber + i;
    const author = pickAuthor(authors, i);
    posts.push({
      author,
      content: contentFn(topic, author, i),
      timestamp: `2024-01-${String(Math.min(15 + Math.floor(i / 10), 28)).padStart(2, '0')}T${String(8 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
      postNumber,
      page: Math.floor((postNumber - 1) / 20) + 1,
    });
  }

  return posts;
}

export const postFactory = {
  shortThread: (count = 10, topic?: string) =>
    generatePosts({ count, contentLength: 'short', topic }),

  mediumThread: (count = 50, topic?: string) =>
    generatePosts({ count, contentLength: 'medium', topic }),

  longThread: (count = 200, topic?: string) =>
    generatePosts({ count, contentLength: 'long', topic }),

  veryLongThread: (count = 500, topic?: string) =>
    generatePosts({ count, contentLength: 'very-long', topic }),

  mixedLength: (counts: { short: number; medium: number; long: number }, topic?: string) => {
    const authors = [...DEFAULT_AUTHORS];
    let postNum = 1;
    return [
      ...generatePosts({ count: counts.short, contentLength: 'short', topic, authors, startPostNumber: postNum }),
      ...generatePosts({ count: counts.medium, contentLength: 'medium', topic, authors, startPostNumber: postNum += counts.short }),
      ...generatePosts({ count: counts.long, contentLength: 'long', topic, authors, startPostNumber: postNum += counts.medium }),
    ];
  },

  custom: (options: PostFactoryOptions) => generatePosts(options),
};
