import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { migrateKnowledge } from '@/lib/migration';
import * as cacheDb from '@/lib/cache-db';
import type { CachedTopic, KnowledgeEntry, GlobalKnowledgeEntry } from '@/lib/types';

function makeTopic(overrides: Partial<CachedTopic> = {}): CachedTopic {
  return {
    url: 'https://example.com/t/1/',
    title: 'Topic 1',
    version: 'xf2',
    posts: [],
    summary: '',
    llmConfig: { provider: 'openai', model: 'gpt-4o-mini' },
    cachedAt: Date.now(),
    lastPostNumber: 10,
    totalPosts: 10,
    totalPages: 1,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'entry-1',
    title: 'Entry 1',
    content: 'Content 1',
    tags: ['tag1'],
    source: { author: 'user1', postNumber: 1 },
    extractedAt: 1000,
    ...overrides,
  };
}

describe('migrateKnowledge', () => {
  let storedEntries: GlobalKnowledgeEntry[] = [];

  beforeEach(() => {
    storedEntries = [];
    vi.spyOn(cacheDb, 'dbGetAll').mockResolvedValue([]);
    vi.spyOn(cacheDb, 'dbUpsertKnowledge').mockImplementation(async (entry: GlobalKnowledgeEntry) => {
      const idx = storedEntries.findIndex(e => e.id === entry.id);
      if (idx >= 0) {
        storedEntries[idx] = entry;
      } else {
        storedEntries.push(entry);
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('migrates knowledge entries from topics to global store', async () => {
    const topic = makeTopic({
      knowledgeEntries: [makeEntry(), makeEntry({ id: 'entry-2', title: 'Entry 2' })],
    });
    vi.mocked(cacheDb.dbGetAll).mockResolvedValue([topic]);

    const result = await migrateKnowledge();

    expect(result.migrated).toBe(2);
    expect(result.skipped).toBe(0);
    expect(storedEntries).toHaveLength(2);
    expect(storedEntries[0].id).toBe('entry-1');
    expect(storedEntries[0].sources).toHaveLength(1);
    expect(storedEntries[0].sources[0].topicUrl).toBe('https://example.com/t/1/');
    expect(storedEntries[0].sources[0].topicTitle).toBe('Topic 1');
    expect(storedEntries[0].topicRefs).toEqual(['https://example.com/t/1/']);
    expect(storedEntries[0].mergedCount).toBe(0);
  });

  it('is idempotent — running twice does not duplicate entries', async () => {
    const topic = makeTopic({
      knowledgeEntries: [makeEntry(), makeEntry({ id: 'entry-2' })],
    });
    vi.mocked(cacheDb.dbGetAll).mockResolvedValue([topic]);

    await migrateKnowledge();
    expect(storedEntries).toHaveLength(2);

    await migrateKnowledge();
    expect(storedEntries).toHaveLength(2);
  });

  it('skips topics without knowledge entries', async () => {
    const topic = makeTopic();
    vi.mocked(cacheDb.dbGetAll).mockResolvedValue([topic]);

    const result = await migrateKnowledge();
    expect(result.migrated).toBe(0);
    expect(storedEntries).toHaveLength(0);
  });

  it('preserves global entries when source topic is deleted', async () => {
    const topic = makeTopic({
      knowledgeEntries: [makeEntry()],
    });
    vi.mocked(cacheDb.dbGetAll).mockResolvedValue([topic]);
    await migrateKnowledge();
    expect(storedEntries).toHaveLength(1);

    vi.mocked(cacheDb.dbGetAll).mockResolvedValue([]);
    await migrateKnowledge();
    expect(storedEntries).toHaveLength(1);
  });

  it('handles entries with missing source gracefully', async () => {
    const entry = makeEntry({ source: { author: '', postNumber: 0 } });
    const topic = makeTopic({ knowledgeEntries: [entry] });
    vi.mocked(cacheDb.dbGetAll).mockResolvedValue([topic]);

    const result = await migrateKnowledge();
    expect(result.migrated).toBe(1);
    expect(storedEntries[0].sources[0].author).toBe('');
  });
});
