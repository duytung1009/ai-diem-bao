import { tokenize } from './text-similarity';
import { STOPWORDS_VI } from './stopwords-vi';
import type { NotebookEntryForQA } from './types';

// ── BM25 parameters ─────────────────────────────────────────────────────────
const K1 = 1.2;   // TF saturation (higher → slower saturation)
const B = 0.75;   // length normalization (0 = no norm, 1 = full norm)

// Field boosts: title importance > tags/category > content/note
const BOOST = { title: 3, tags: 2, category: 2, content: 1, note: 1 } as const;

// ── tokenizeForSearch ────────────────────────────────────────────────────────
// Like tokenize() from text-similarity but additionally strips stopwords.
// Kept separate so dedup (knowledge-merge.ts) continues using the unfiltered
// tokenize() without needing to retune its Jaccard threshold.
export function tokenizeForSearch(text: string): string[] {
  return tokenize(text).filter(t => !STOPWORDS_VI.has(t));
}

// ── Index types ──────────────────────────────────────────────────────────────
interface Bm25Doc {
  id: string;
  title: string[];
  content: string[];
  tags: string[];
  category: string[];
  note: string[];
}

export interface Bm25Index {
  docs: Bm25Doc[];
  /** term → number of docs containing that term (across all fields) */
  df: Map<string, number>;
  avgLen: { title: number; content: number; tags: number; category: number; note: number };
  N: number;
}

// ── buildBm25Index ───────────────────────────────────────────────────────────
export function buildBm25Index(entries: NotebookEntryForQA[]): Bm25Index {
  const docs: Bm25Doc[] = entries.map(e => ({
    id: e.id,
    title: tokenizeForSearch(e.title),
    content: tokenizeForSearch(e.content),
    tags: e.tags.flatMap(t => tokenizeForSearch(t)),
    category: e.category ? tokenizeForSearch(e.category) : [],
    note: e.userNote ? tokenizeForSearch(e.userNote) : [],
  }));

  // Document frequency: count docs that contain the term in ANY field
  const df = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set<string>([
      ...doc.title, ...doc.content, ...doc.tags, ...doc.category, ...doc.note,
    ]);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }

  // Average field length across all docs
  const sum = { title: 0, content: 0, tags: 0, category: 0, note: 0 };
  for (const d of docs) {
    sum.title += d.title.length;
    sum.content += d.content.length;
    sum.tags += d.tags.length;
    sum.category += d.category.length;
    sum.note += d.note.length;
  }
  const N = docs.length;
  const safe = (n: number) => (N > 0 ? n / N : 0) || 1; // avoid div/0 and zero avgLen
  const avgLen = {
    title: safe(sum.title),
    content: safe(sum.content),
    tags: safe(sum.tags),
    category: safe(sum.category),
    note: safe(sum.note),
  };

  return { docs, df, avgLen, N };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function tfSat(freq: number, fieldLen: number, avgLen: number): number {
  if (freq === 0 || fieldLen === 0) return 0;
  return (freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (fieldLen / avgLen)));
}

function freq(tokens: string[], term: string): number {
  let n = 0;
  for (const t of tokens) if (t === term) n++;
  return n;
}

// BM25+ IDF (always ≥ 0 even for extremely common terms)
function idf(df: number, N: number): number {
  return Math.log((N - df + 0.5) / (df + 0.5) + 1);
}

// ── scoreBm25 ────────────────────────────────────────────────────────────────
export function scoreBm25(
  queryTokens: string[],
  doc: Bm25Doc,
  index: Bm25Index,
): number {
  if (queryTokens.length === 0 || index.N === 0) return 0;
  let score = 0;
  const { df: dfMap, avgLen, N } = index;
  for (const t of queryTokens) {
    const docFreq = dfMap.get(t) ?? 0;
    if (docFreq === 0) continue;
    const termIdf = idf(docFreq, N);
    score +=
      termIdf * BOOST.title * tfSat(freq(doc.title, t), doc.title.length, avgLen.title) +
      termIdf * BOOST.tags * tfSat(freq(doc.tags, t), doc.tags.length, avgLen.tags) +
      termIdf * BOOST.category * tfSat(freq(doc.category, t), doc.category.length, avgLen.category) +
      termIdf * BOOST.content * tfSat(freq(doc.content, t), doc.content.length, avgLen.content) +
      termIdf * BOOST.note * tfSat(freq(doc.note, t), doc.note.length, avgLen.note);
  }
  return score;
}

// ── rankBm25 ─────────────────────────────────────────────────────────────────
// High-level API: tokenizes the question, builds an index over the given
// entries, and returns entries sorted by descending BM25 score.
// If the query is empty after filtering stopwords (e.g. "và hoặc là"),
// falls back to the original entry order (no filtering).
export function rankBm25(
  question: string,
  entries: NotebookEntryForQA[],
): { entry: NotebookEntryForQA; score: number }[] {
  const qTokens = tokenizeForSearch(question);
  if (qTokens.length === 0 || entries.length === 0) {
    return entries.map(entry => ({ entry, score: 0 }));
  }

  const index = buildBm25Index(entries);
  return index.docs
    .map((doc, i) => ({ entry: entries[i], score: scoreBm25(qTokens, doc, index) }))
    .sort((a, b) => b.score - a.score);
}
