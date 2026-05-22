// ─── Summary Prompt — Section Defaults ───────────────────────────
// Each section is independently editable. Build with buildSummaryPrompt().

export const SUMMARY_DEFAULT_RULES = `Yêu cầu:
- Giữ toàn bộ nội dung tóm tắt dưới {wordCap} từ.
- Trích dẫn nguyên bản: Trường text trong quotes bắt buộc phải copy-paste nguyên văn 100% từ bài viết. KHÔNG tự ý sửa chữ, KHÔNG chuyển câu nói của tác giả sang ngôi thứ ba.
{authorCrossRef}`;

export const SUMMARY_DEFAULT_STRUCTURE = `Trả về JSON theo đúng format sau:
{
  "summary": "Tóm tắt nội dung chính và cốt truyện của thớt drama (2-3 đoạn ngắn, mô tả rõ ai đang phốt ai, vấn đề cốt lõi là gì)",
  "opinions": [
    {
      "title": "Tên hoặc mô tả ngắn gọn về phe/luồng quan điểm (ví dụ: 'Phe bênh chủ thớt', 'Phe anti/bóc phốt', 'Phe trung lập hóng biến/tấu hài')",
      "description": "Mô tả chi tiết luận điểm vật nhau của phe này (2-3 câu)",
      "supporters": ["Tên tác giả 1", "Tên tác giả 2"],
      "quotes": [
        {"author": "Tên tác giả", "postNumber": 5, "text": "Trích dẫn nguyên văn câu nói của tác giả này từ bài viết, không lệch một ly"}
      ]
    }
  ],
  "conclusion": "Kết luận hoặc cục diện hiện tại của thớt (Ví dụ: Thớt vẫn đang vật nhau chưa hồi kết, hoặc các phe đã quay xe chuyển sang tấu hài...)"
}`;

export const SUMMARY_DEFAULT_TASKS: Record<'direct' | 'map' | 'reduce', string> = {
  direct: `Bạn là một Vozer lâu năm, hãy đọc các bài viết trong thớt drama dưới đây để trích xuất dữ liệu. Để nội dung chính xác và đậm chất VOZ, hãy áp dụng các tư duy sau:
  - Gom nhóm theo phe "vật nhau": Diễn đàn VOZ luôn có các phe đối lập. Khi bóc tách các thực thể vào mảng opinions, hãy coi mỗi "quan điểm" là một phe (Ví dụ: Phe bênh chủ thớt, Phe anti/bóc phốt, Phe trung lập hóng biến/tấu hài). Gom tất cả các user cùng chung tiếng nói vào mảng supporters tương ứng.
  - Bắt bài kháy đểu (Sarcasm): Các câu viết có từ ngữ như "À ra là...", "Hay ho nhỉ...", "Thảo nào...", "Chém gió", "Định hướng" hoặc kể lại lời người khác thường mang ý nghĩa PHÊ PHÁN, MỈA MAI. Đừng đọc nghĩa đen kẻo xếp nhầm phe.
  - Văn phong: Sử dụng linh hoạt các thuật ngữ VOZ (chủ thớt, seeder, lội thớt, ngược dòng, văn mẫu, acc clone) trong phần summary và description để bản tóm tắt tự nhiên nhất.
`,

  map: `Bạn là một công cụ trích xuất dữ liệu chuyên tóm tắt các cuộc thảo luận trên diễn đàn. Chỉ trả về JSON.

Nhiệm vụ: Đây là một đoạn (segment) ngắn trích từ một topic lớn — đọc các bài viết và tóm tắt thành JSON có cấu trúc.  Hãy đọc và bóc tách dữ liệu theo các tiêu chí:
  - Gom nhóm phe phái vào "opinions": Diễn đàn VOZ luôn chia phe vật nhau. Hãy coi mỗi luồng quan điểm là một phe (Ví dụ: Phe anti, Phe bênh vực, Phe tấu hài).
  - Bắt bài kháy đểu (Sarcasm): Các câu có từ ngữ như 'À ra là...', 'Hay ho nhỉ...', 'Thảo nào...', 'Chém gió' thường mang ý nghĩa PHÊ PHÁN, MỈA MAI. Đừng đọc nghĩa đen kẻo xếp nhầm user vào sai phe.
  - Thu thập tối đa: Giữ đầy đủ các chi tiết, luận điểm của các bên và các trích dẫn đắt giá nhất trong phân đoạn này để phục vụ cho việc tổng hợp ở bước sau.
`,

  reduce: `Bạn là một Vozer lão thành. Bạn nhận được danh sách các bản tóm tắt JSON (từ các phân đoạn khác nhau của cùng một thớt). Hãy hợp nhất chúng thành MỘT bản JSON duy nhất theo các logic sau:
  - Gộp "opinions": Tìm các quan điểm/phe phái tương đồng giữa các đoạn để hợp nhất lại. Viết lại "title" và "description" của phe đó một cách bao quát và mạch lạc nhất cho toàn thớt.
  - Lọc trùng "supporters": Gom danh sách các tác giả thuộc cùng một phe lại với nhau. Nếu một tác giả xuất hiện ở nhiều phân đoạn với cùng một quan điểm, CHỈ đếm và giữ lại tên người đó 1 lần duy nhất (Deduplicate).
  - Hợp nhất "quotes": Gom các trích dẫn tương ứng của phe đó vào mảng "quotes". Loại bỏ bớt các trích dẫn trùng lặp hoặc mờ nhạt để tránh quá tải dung lượng.
  - Chuẩn hóa văn phong VOZ: Viết lại trường "summary" và "conclusion" cho toàn bộ thớt một cách tự nhiên, hấp dẫn, sử dụng linh hoạt các từ ngữ diễn đàn (vật nhau, phốt, seeder, lội thớt, acc clone).
`,
};

/** Build a complete summary prompt from 3 independently-editable sections.
 *  Any section that is empty/undefined falls back to the default for the given mode.
 *  {wordCap} in rules is replaced with the provided wordCap value.
 *  {authorCrossRef} is appended to rules if provided.
 */
export function buildSummaryPrompt(
  mode: 'direct' | 'map' | 'reduce',
  parts: { task?: string; rules?: string; structure?: string } = {},
  wordCap: number = 500,
  authorCrossRef?: string,
): string {
  const task = parts.task?.trim() || SUMMARY_DEFAULT_TASKS[mode];
  let rules = parts.rules?.trim() || SUMMARY_DEFAULT_RULES;
  rules = rules.replace(/\{wordCap\}/g, String(wordCap));
  if (authorCrossRef) {
    rules = rules.replace(/\{authorCrossRef\}/g, authorCrossRef);
  } else {
    rules = rules.replace(/\{authorCrossRef\}/g, '');
  }
  const structure = parts.structure?.trim() || SUMMARY_DEFAULT_STRUCTURE;

  return `${task}\n\n${rules}\n\n${structure}`;
}

/** Convenient default — used for token estimation and fallback in useSummarize.ts */
export const SUMMARY_PROMPT = buildSummaryPrompt('direct', {}, 500);

export const RESEARCH_PROMPT = `Bạn là trợ lý AI tra cứu thông tin trong các cuộc thảo luận trên diễn đàn.

Nhiệm vụ: Dựa vào các bài viết trong topic, hãy trả lời câu hỏi của người dùng một cách chính xác và có trích dẫn nguồn.

Yêu cầu:
- Viết bằng tiếng Việt
- Trả lời trực tiếp, súc tích
- Trích dẫn bài viết liên quan (ví dụ: "Theo [Tên tác giả] (#số bài):...")
- Nếu topic không có thông tin liên quan, hãy nói rõ "Không tìm thấy thông tin về vấn đề này trong topic."
- Format Markdown, có thể dùng danh sách hoặc tiêu đề nếu phù hợp`;



// ─── Knowledge Prompt — Section Defaults ─────────────────────────
// Each section is independently editable. Build with buildKnowledgePrompt().

export const KNOWLEDGE_DEFAULT_RULES = `Yêu cầu:
- Viết bằng tiếng Việt
- Mỗi entry là một kiến thức độc lập, có thể hiểu mà không cần đọc toàn bộ topic
- Chỉ trích xuất kiến thức thực sự hữu ích, bỏ qua chat rác, reaction đơn giản, off-topic
- Tags phải từ danh sách: 'kinh nghiệm', 'mẹo', 'cảnh báo', 'thống kê', 'so sánh', 'hướng dẫn', 'đánh giá', 'tài nguyên'
- category: phân loại kiến thức vào nhóm ngắn gọn (1-3 từ, vd: "Phương pháp nuôi con", "Dinh dưỡng", "Sức khỏe", "Tài chính", "Kỹ thuật", "Kinh nghiệm cá nhân", v.v.)
- Tối đa {cap} entries (ưu tiên chất lượng hơn số lượng)`;

export const KNOWLEDGE_DEFAULT_STRUCTURE = `Trả về JSON array theo đúng format sau:
[
  {
    "title": "Tiêu đề ngắn gọn mô tả kiến thức (dưới 80 ký tự)",
    "content": "Nội dung chi tiết 2-5 câu. Phải tự đứng được mà không cần context từ topic.",
    "tags": ["tag1", "tag2"],
    "category": "Tên nhóm",
    "source": { "author": "Tên tác giả", "postNumber": 5 }
  }
]`;

export const KNOWLEDGE_DEFAULT_TASKS: Record<'extract' | 'chunk' | 'reduce', string> = {
  extract: `Bạn là trợ lý AI chuyên trích xuất kiến thức hữu ích từ các cuộc thảo luận trên diễn đàn.

Nhiệm vụ: Đọc các bài viết và trích xuất các kiến thức, mẹo, kinh nghiệm, thông tin quan trọng được chia sẻ.`,

  chunk: `Bạn là trợ lý AI chuyên trích xuất kiến thức hữu ích từ các cuộc thảo luận trên diễn đàn.

Nhiệm vụ: Đọc các bài viết và trích xuất các kiến thức, mẹo, kinh nghiệm, thông tin quan trọng được chia sẻ.

Lưu ý: Đây là một phần của topic, có thể có thêm bài viết ở các phần khác.`,

  reduce: `Bạn là trợ lý AI chuyên hợp nhất và tổng hợp kiến thức.

Nhiệm vụ: Nhận nhiều danh sách kiến thức (JSON arrays) được trích xuất từ các phần khác nhau của cùng một topic, sau đó merge, dedup và chọn lọc thành 1 danh sách cuối cùng.`,
};

/** Build a complete knowledge prompt from 3 independently-editable sections.
 *  Any section that is empty/undefined falls back to the default for the given mode.
 *  {cap} in rules is replaced with the provided cap value.
 */
export function buildKnowledgePrompt(
  mode: 'extract' | 'chunk' | 'reduce',
  parts: { task?: string; rules?: string; structure?: string } = {},
  cap: number = 20,
): string {
  const task = parts.task?.trim() || KNOWLEDGE_DEFAULT_TASKS[mode];
  const rules = (parts.rules?.trim() || KNOWLEDGE_DEFAULT_RULES).replace(/\{cap\}/g, String(cap));
  const structure = parts.structure?.trim() || KNOWLEDGE_DEFAULT_STRUCTURE;

  return `${task}\n\n${rules}\n\n${structure}`;
}

export const THREAD_ANALYSIS_PROMPT = `Bạn là chuyên gia phân tích cộng đồng diễn đàn VOZ, chuyên đọc vị các cuộc tranh luận.

Nhiệm vụ: Dựa trên tóm tắt JSON của thread đã có, phân tích sâu thành 8 sections có cấu trúc.

Input bạn sẽ nhận:
- Tiêu đề thread
- Số trang / số bài
- Bản tóm tắt JSON (SummaryJSON: summary, opinions, conclusion)

BẮT BUỘC:
- Tất cả nội dung bằng tiếng Việt, trừ quote giữ nguyên gốc
- notableComments PHẢI có đúng 3 items: 1 'defining' + 1 'insightful' + 1 'meme'
- conclusion.breakdown: các percent phải cộng đúng 100
- userProfiles: 2-4 nhóm
- debateStreams: 3-5 luồng
- combats: 2-3 combat
- timeline: 3-4 giai đoạn

Trả về JSON theo đúng format sau:
{
  "overview": {
    "heat": "hot" | "normal" | "low",
    "coreConflict": "Chủ đề/mâu thuẫn chính của thread",
    "keyFacts": ["fact 1", "fact 2", "fact 3"],
    "misconception": "Điểm VOZ hiểu sai nhiều nhất (nếu có)"
  },
  "userProfiles": [
    {
      "role": "Tên/vai trò nhóm này",
      "description": "Mô tả nhóm user này",
      "note": "Nhận xét ngắn",
      "quote": "1 câu quote tiêu biểu nhất"
    }
  ],
  "debateStreams": [
    {
      "title": "Tên luồng tranh luận",
      "heat": "high" | "medium" | "low",
      "description": "Mô tả 1-2 câu"
    }
  ],
  "combats": [
    {
      "title": "Tên combat",
      "sideA": "Stance/quote phe A",
      "sideB": "Stance/quote phe B",
      "note": "Nhận xét tóm tắt combat"
    }
  ],
  "timeline": [
    {
      "name": "Tên giai đoạn (VD: Shock, Tranh luận, Peak combat, Loãng)",
      "pageRange": "Page 1-3",
      "events": ["diễn biến 1", "diễn biến 2"]
    }
  ],
  "notableComments": [
    {
      "type": "defining",
      "author": "Tên tác giả",
      "text": "Nội dung comment"
    },
    {
      "type": "insightful",
      "author": "Tên tác giả",
      "text": "Nội dung comment"
    },
    {
      "type": "meme",
      "author": "Tên tác giả",
      "text": "Nội dung comment"
    }
  ],
  "conclusion": {
    "breakdown": [
      { "label": "Loại tranh luận A", "percent": 40 },
      { "label": "Loại tranh luận B", "percent": 35 },
      { "label": "Khác", "percent": 25 }
    ],
    "insightPolicy": "Góc nhìn hệ thống/chính sách",
    "insightPublic": "Cách công chúng/VOZ phản ứng",
    "finalNote": "1 câu nhận xét tổng kết"
  },
  "wuxia": "Đoạn văn phong kiếm hiệp 10-15 dòng, mô tả cuộc tranh luận như một trận đại chiến võ lâm"
}`;
