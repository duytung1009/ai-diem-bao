// Vietnamese stopword list for search token filtering.
// Sources: common NLP resources for Vietnamese + manual curation for forum context.
// Conservative: only removes clear function words. Content-bearing terms are kept
// even if frequent, to avoid dropping useful search signal.
export const STOPWORDS_VI: Set<string> = new Set([
  // Pronouns (đại từ nhân xưng)
  'tôi', 'mình', 'mày', 'tao', 'nó', 'họ', 'chúng', 'ta',
  'bạn', 'bác', 'anh', 'chị', 'em', 'con', 'ông', 'bà',
  'các', 'những',

  // Demonstratives (chỉ định từ)
  'này', 'đó', 'kia', 'ấy', 'đây', 'đấy', 'nào', 'gì',

  // Conjunctions (liên từ)
  'và', 'với', 'hoặc', 'hay', 'nhưng', 'mà', 'thì', 'là', 'bị',
  'vì', 'nên', 'do', 'tuy', 'dù', 'dẫu', 'hơn', 'hay', 'nếu',
  'khi', 'lúc', 'trước', 'sau', 'trong', 'ngoài', 'giữa',

  // Prepositions (giới từ)
  'của', 'cho', 'về', 'đến', 'tới', 'từ', 'tại', 'ở', 'theo',
  'bằng', 'qua', 'qua', 'trên', 'dưới',

  // Auxiliary / modal verbs (không mang nghĩa nội dung)
  'đã', 'sẽ', 'đang', 'được', 'bị', 'có', 'không', 'chưa', 'rồi',
  'cũng', 'vẫn', 'đều', 'lại', 'ra', 'vào', 'lên', 'xuống',

  // Measure / quantifier
  'một', 'hai', 'ba', 'mọi', 'nhiều', 'ít', 'rất', 'khá', 'quá',
  'hơn', 'nhất', 'thêm',

  // Particles / discourse markers
  'thôi', 'nhé', 'nha', 'ạ', 'ơi', 'à', 'ừ', 'vậy', 'thế',
  'đó', 'đây', 'như', 'chứ', 'thật', 'thực',

  // Common English stopwords that appear in Vietnamese forum text
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was',
  'be', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
  'this', 'that', 'it', 'as', 'from', 'not', 'no', 'so',
]);
