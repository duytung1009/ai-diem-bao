import type { GlobalKnowledgeEntry, KnowledgeEntry, NotebookEntryForQA } from './types';

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\sÀ-ɏḀ-ỿ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

export function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  if (set1.size === 0 && set2.size === 0) return 0;
  let intersection = 0;
  for (const t of set1) if (set2.has(t)) intersection++;
  const union = set1.size + set2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function keywordSimilarity(text1: string, text2: string): number {
  return jaccardSimilarity(tokenSet(text1), tokenSet(text2));
}

export function scoreEntryByTokens(
  questionTokens: string[],
  title: string,
  content: string,
  tags: string[],
  category?: string,
  userNote?: string,
): number {
  const titleWords = new Set(tokenize(title));
  const contentWords = new Set(tokenize(content));
  const tagWords = new Set(tags.flatMap(t => tokenize(t)));
  const catWords = category ? new Set(tokenize(category)) : new Set<string>();
  const noteWords = userNote ? new Set(tokenize(userNote)) : new Set<string>();

  let score = 0;
  for (const qt of questionTokens) {
    for (const w of titleWords) { if (w.includes(qt) || qt.includes(w)) { score += 3; break; } }
    for (const w of tagWords) { if (w.includes(qt) || qt.includes(w)) { score += 2; break; } }
    for (const w of catWords) { if (w.includes(qt) || qt.includes(w)) { score += 2; break; } }
    for (const w of contentWords) { if (w.includes(qt) || qt.includes(w)) { score += 1; break; } }
    for (const w of noteWords) { if (w.includes(qt) || qt.includes(w)) { score += 1; break; } }
  }
  return score;
}

export function scoreNotebookEntry(questionTokens: string[], entry: NotebookEntryForQA): number {
  return scoreEntryByTokens(questionTokens, entry.title, entry.content, entry.tags, entry.category, entry.userNote);
}

export function scoreGlobalKnowledgeEntry(questionTokens: string[], entry: GlobalKnowledgeEntry): number {
  return scoreEntryByTokens(questionTokens, entry.title, entry.content, entry.tags, entry.category);
}

// Project a global knowledge entry back into the per-topic KnowledgeEntry shape
// used by the Knowledge view (collapses the primary source, marks unsaved).
export function globalToKnowledgeEntry(e: GlobalKnowledgeEntry): KnowledgeEntry {
  return {
    id: e.id,
    title: e.title,
    content: e.content,
    tags: e.tags,
    category: e.category,
    source: e.sources[0] ?? { author: '', postNumber: 0 },
    extractedAt: e.extractedAt,
    saved: false,
  };
}

export function toNotebookEntryForQA(entry: GlobalKnowledgeEntry): NotebookEntryForQA {
  const primarySource = entry.sources[0];
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    category: entry.category,
    tags: entry.tags,
    sourceTopicTitle: primarySource?.topicTitle ?? entry.topicRefs[0] ?? '',
    source: {
      author: primarySource?.author ?? '',
      postNumber: primarySource?.postNumber ?? 0,
    },
  };
}
