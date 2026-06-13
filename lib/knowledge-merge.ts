import type { KnowledgeEntry, GlobalKnowledgeEntry, KnowledgeSource } from './types';
import { tokenSet, jaccardSimilarity } from './text-similarity';
import { getAllKnowledge, upsertKnowledgeEntry } from './cache-manager';

const MERGE_THRESHOLD = 0.2;

function buildCombinedText(title: string, content: string): string {
  return `${title} ${title} ${content}`;
}

function mergeEntry(existing: GlobalKnowledgeEntry, newEntry: KnowledgeEntry, topic: { url: string; title: string }): GlobalKnowledgeEntry {
  const newSource: KnowledgeSource = {
    topicUrl: topic.url,
    topicTitle: topic.title,
    author: newEntry.source?.author ?? '',
    postNumber: newEntry.source?.postNumber ?? 0,
    timestamp: newEntry.source?.timestamp,
  };

  const hasSource = existing.sources.some(
    s => s.topicUrl === topic.url && s.author === newEntry.source?.author && s.postNumber === newEntry.source?.postNumber
  );

  const sources = hasSource ? existing.sources : [...existing.sources, newSource];
  const topicRefs = existing.topicRefs.includes(topic.url) ? existing.topicRefs : [...existing.topicRefs, topic.url];
  const tags = [...new Set([...existing.tags, ...(newEntry.tags ?? [])])];
  const content = newEntry.content.length > existing.content.length ? newEntry.content : existing.content;

  return {
    ...existing,
    title: existing.title,
    content,
    tags,
    category: newEntry.category ?? existing.category,
    sources,
    topicRefs,
    updatedAt: Date.now(),
    mergedCount: (existing.mergedCount ?? 0) + 1,
  };
}

export function toGlobalEntry(entry: KnowledgeEntry, topic: { url: string; title: string }): GlobalKnowledgeEntry {
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    tags: entry.tags ?? [],
    category: entry.category,
    sources: [{
      topicUrl: topic.url,
      topicTitle: topic.title,
      author: entry.source?.author ?? '',
      postNumber: entry.source?.postNumber ?? 0,
      timestamp: entry.source?.timestamp,
    }],
    topicRefs: [topic.url],
    extractedAt: entry.extractedAt,
    updatedAt: entry.extractedAt,
    mergedCount: 0,
  };
}

export async function insertWithDedup(
  newEntries: KnowledgeEntry[],
  topic: { url: string; title: string },
): Promise<{ inserted: number; merged: number }> {
  const existingEntries = await getAllKnowledge();
  let inserted = 0;
  let merged = 0;

  // Precompute token sets once per existing entry so the inner loop is pure
  // set-intersection instead of re-tokenizing the same text on every comparison.
  const existingPrecomp = existingEntries.map(existing => ({
    entry: existing,
    titleSet: tokenSet(existing.title),
    combinedSet: tokenSet(buildCombinedText(existing.title, existing.content)),
  }));

  for (const entry of newEntries) {
    const newTitleSet = tokenSet(entry.title);
    const newCombinedSet = tokenSet(buildCombinedText(entry.title, entry.content));
    let bestMatch: { entry: GlobalKnowledgeEntry; score: number } | null = null;

    for (const existing of existingPrecomp) {
      const combinedScore = jaccardSimilarity(newCombinedSet, existing.combinedSet);
      const titleScore = jaccardSimilarity(newTitleSet, existing.titleSet);
      const isMatch =
        (titleScore >= 0.5 && combinedScore >= 0.1) ||
        (titleScore >= 0.3 && combinedScore >= MERGE_THRESHOLD) ||
        combinedScore >= 0.4;
      if (isMatch && combinedScore > (bestMatch?.score ?? 0)) {
        bestMatch = { entry: existing.entry, score: combinedScore };
      }
    }

    if (bestMatch) {
      const updated = mergeEntry(bestMatch.entry, entry, topic);
      await upsertKnowledgeEntry(updated);
      merged++;
    } else {
      const newGlobal = toGlobalEntry(entry, topic);
      await upsertKnowledgeEntry(newGlobal);
      inserted++;
    }
  }

  return { inserted, merged };
}
