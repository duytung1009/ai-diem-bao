import { describe, expect, it } from 'vitest';
import { mapExportedTopic, validateCacheExport } from '@/lib/importer';

describe('importer', () => {
  it('validates a standard cache export payload', () => {
    const raw = {
      exportedAt: '2026-05-28T00:00:00.000Z',
      version: '1.0',
      topicCount: 1,
      topics: [
        {
          url: 'https://voz.vn/threads/example.1/',
          title: 'Example topic',
          cachedAt: 1710000000000,
          llmConfig: { provider: 'openai', model: 'gpt-4o-mini' },
          totalPosts: 10,
          totalPages: 2,
          summary: 'summary',
        },
      ],
    };

    const validated = validateCacheExport(raw);
    expect(validated.topics).toHaveLength(1);
    expect(validated.version).toBe('1.0');
    expect(validated.topics[0].url).toBe('https://voz.vn/threads/example.1/');
  });

  it('keeps forward-compatible versions without throwing', () => {
    const raw = {
      exportedAt: '2026-05-28T00:00:00.000Z',
      version: '2.0',
      topicCount: 0,
      topics: [],
    };

    const validated = validateCacheExport(raw);
    expect(validated.version).toBe('2.0');
    expect(validated.topics).toEqual([]);
  });

  it('throws for malformed JSON shape', () => {
    expect(() => validateCacheExport({ version: '1.0' })).toThrow(/topics/i);
  });

  it('throws when topic misses required url/title', () => {
    const raw = {
      exportedAt: '2026-05-28T00:00:00.000Z',
      version: '1.0',
      topicCount: 1,
      topics: [{ title: 'missing url' }],
    };

    expect(() => validateCacheExport(raw)).toThrow(/url hoặc title/i);
  });

  it('maps exported topic to cached topic defaults', () => {
    const mapped = mapExportedTopic({
      url: 'https://voz.vn/threads/example.2/',
      title: 'Imported topic',
      version: 'xf2',
      posts: [
        {
          author: 'alice',
          content: 'hello',
          timestamp: '2026-05-28T00:00:00.000Z',
          postNumber: 1,
          page: 1,
        },
      ],
      lastPostNumber: 1,
      cachedAt: 1710000000000,
      llmConfig: { provider: 'gemini', model: 'gemini-2.5-flash' },
      totalPosts: 20,
      forumPostCount: 25,
      summarizedPostCount: 12,
      totalPages: 5,
      summary: 'Main summary',
      knowledgeEntries: [
        {
          id: 'k1',
          title: 'K1',
          content: 'Content',
          tags: ['tag'],
          source: { author: 'alice', postNumber: 1 },
          extractedAt: 1710000000001,
        },
      ],
      knowledgeChunks: [
        {
          index: 0,
          startPostNumber: 1,
          endPostNumber: 1,
          entries: [],
          extractedAt: 1710000000002,
        },
      ],
      segments: [
        {
          startPage: 1,
          endPage: 2,
          complete: false,
          posts: [
            {
              author: 'alice',
              content: 'segment post',
              timestamp: '2026-05-28T00:00:00.000Z',
              postNumber: 2,
              page: 1,
            },
          ],
          summary: 'Segment summary',
          postCount: 10,
          summarizedAt: 1710000000100,
        },
      ],
    });

    expect(mapped.version).toBe('xf2');
    expect(mapped.posts).toHaveLength(1);
    expect(mapped.lastPostNumber).toBe(1);
    expect(mapped.forumPostCount).toBe(25);
    expect(mapped.knowledgeEntries).toHaveLength(1);
    expect(mapped.knowledgeChunks).toHaveLength(1);
    expect(mapped.segments?.[0].posts).toHaveLength(1);
    expect(mapped.segments?.[0].complete).toBe(false);
  });

  it('normalizes invalid post records from import payload', () => {
    const validated = validateCacheExport({
      exportedAt: '2026-05-28T00:00:00.000Z',
      version: '1.0',
      topicCount: 1,
      topics: [
        {
          url: 'https://voz.vn/threads/example.3/',
          title: 'Invalid posts',
          llmConfig: { provider: 'openai', model: 'gpt-4o-mini' },
          totalPosts: 3,
          totalPages: 1,
          summary: 'summary',
          posts: [
            { author: 'ok', content: 'ok', timestamp: 'x', postNumber: 1 },
            { author: 'bad', content: 'bad', timestamp: 'x', postNumber: 0 },
            { author: 'bad2', content: 'bad2', timestamp: 'x' },
          ],
        },
      ],
    });

    expect(validated.topics[0].posts).toHaveLength(1);
    expect(validated.topics[0].posts?.[0].postNumber).toBe(1);
  });
});
