import { dbGetAll, dbUpsertKnowledge } from './cache-db';
import { toGlobalEntry } from './knowledge-merge';
import type { CachedTopic } from './types';

export async function migrateKnowledge(): Promise<{ migrated: number; skipped: number }> {
  const allTopics: CachedTopic[] = await dbGetAll();
  let migrated = 0;
  let skipped = 0;

  for (const topic of allTopics) {
    const entries = topic.knowledgeEntries;
    if (!entries || entries.length === 0) continue;

    for (const entry of entries) {
      const globalEntry = toGlobalEntry(entry, { url: topic.url, title: topic.title });

      try {
        await dbUpsertKnowledge(globalEntry);
        migrated++;
      } catch {
        skipped++;
      }
    }
  }

  return { migrated, skipped };
}
