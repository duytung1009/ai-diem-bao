// Optional synonym expansion for Vietnamese Q&A search.
// Seed map is intentionally small to avoid overfit/noise; extend conservatively.
// Set USE_SYNONYMS = false to disable without removing the module.
export const USE_SYNONYMS = true;

// Each group lists interchangeable terms; expansion adds all group members to
// the query token set. Keep groups small (2–4 terms) and domain-relevant.
const SYNONYM_GROUPS: string[][] = [
  ['xe máy', 'mô tô', 'xe mô tô'],
  ['điện thoại', 'dt', 'smartphone', 'dien thoai'],
  ['laptop', 'máy tính xách tay', 'notebook'],
  ['máy tính', 'pc', 'computer', 'desktop'],
  ['oto', 'ô tô', 'xe hơi', 'xe ô tô'],
  ['trẻ em', 'trẻ nhỏ', 'trẻ con', 'bé'],
  ['giúp việc', 'người giúp việc', 'osin', 'người làm'],
  ['chăm sóc', 'chăm', 'nuôi dưỡng'],
  ['kinh nghiệm', 'kinh nghiem', 'kn', 'chia sẻ kinh nghiệm'],
  ['tiền', 'chi phí', 'giá', 'giá cả', 'cost'],
  ['mua', 'mua sắm', 'purchase', 'order'],
  ['review', 'đánh giá', 'nhận xét'],
  ['lỗi', 'bug', 'sự cố', 'vấn đề'],
];

// Flatten groups into a term → sibling-terms map for O(1) lookup
const SYNONYM_MAP: Map<string, string[]> = new Map();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    SYNONYM_MAP.set(term, group.filter(t => t !== term));
  }
}

// Expand a list of already-tokenized query tokens by adding synonyms.
// Multi-word synonyms are added as-is (single tokens after joining spaces);
// for reliable matching they must appear in the same tokenized form in docs.
export function expandQueryTokens(tokens: string[]): string[] {
  if (!USE_SYNONYMS) return tokens;
  const expanded = new Set<string>(tokens);
  for (const t of tokens) {
    const synonyms = SYNONYM_MAP.get(t);
    if (synonyms) for (const s of synonyms) expanded.add(s);
  }
  return [...expanded];
}
