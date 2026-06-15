import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { insertWithDedup } from '@/lib/knowledge-merge';
import * as cacheManager from '@/lib/cache-manager';
import type { KnowledgeEntry, GlobalKnowledgeEntry } from '@/lib/types';

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Sample Title',
    content: 'Sample content text.',
    tags: ['test'],
    source: { author: 'user1', postNumber: 1 },
    extractedAt: 1000,
    ...overrides,
  };
}

const topic = { url: 'https://example.com/t/1/', title: 'Example Topic' };

describe('insertWithDedup', () => {
  let stored: GlobalKnowledgeEntry[] = [];

  beforeEach(() => {
    stored = [];
    vi.spyOn(cacheManager, 'getAllKnowledge').mockImplementation(async () => [...stored]);
    vi.spyOn(cacheManager, 'upsertKnowledgeEntry').mockImplementation(async (entry: GlobalKnowledgeEntry) => {
      const idx = stored.findIndex(e => e.id === entry.id);
      if (idx >= 0) {
        stored[idx] = entry;
      } else {
        stored.push(entry);
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts first entry into empty store', async () => {
    const result = await insertWithDedup([makeEntry()], topic);
    expect(result.inserted).toBe(1);
    expect(result.merged).toBe(0);
    expect(stored).toHaveLength(1);
    expect(stored[0].sources).toHaveLength(1);
    expect(stored[0].topicRefs).toEqual([topic.url]);
  });

  it('merges similar entry instead of inserting duplicate', async () => {
    await insertWithDedup([makeEntry({ title: 'Mèo con dễ thương', content: 'Bài viết về mèo con rất dễ thương' })], topic);
    expect(stored).toHaveLength(1);

    const result = await insertWithDedup(
      [makeEntry({ title: 'Mèo con đáng yêu', content: 'Nội dung tương tự về mèo con dễ thương' })],
      { url: 'https://example.com/t/2/', title: 'Other Topic' }
    );
    expect(result.inserted).toBe(0);
    expect(result.merged).toBe(1);
    expect(stored).toHaveLength(1);
    expect(stored[0].sources).toHaveLength(2);
    expect(stored[0].topicRefs).toHaveLength(2);
    expect(stored[0].mergedCount).toBe(1);
  });

  it('inserts separate entry for dissimilar content', async () => {
    await insertWithDedup([makeEntry({ title: 'Học lập trình Python', content: 'ngôn ngữ lập trình python cơ bản' })], topic);
    expect(stored).toHaveLength(1);

    const result = await insertWithDedup([makeEntry({ title: 'Nấu ăn món Việt', content: 'công thức nấu phở bò ngon' })], topic);
    expect(result.inserted).toBe(1);
    expect(result.merged).toBe(0);
    expect(stored).toHaveLength(2);
  });

  it('tracks mergedCount correctly across multiple merges', async () => {
    await insertWithDedup([makeEntry({ title: 'Kinh tế vi mô', content: 'Tổng quan về kinh tế vi mô' })], topic);
    await insertWithDedup([makeEntry({ title: 'Kinh tế vi mô cơ bản', content: 'Các nguyên lý kinh tế vi mô' })],
      { url: 'https://example.com/t/2/', title: 'Topic 2' });
    await insertWithDedup([makeEntry({ title: 'Kinh tế vi mô nâng cao', content: 'Phân tích chuyên sâu kinh tế vi mô' })],
      { url: 'https://example.com/t/3/', title: 'Topic 3' });

    expect(stored).toHaveLength(1);
    expect(stored[0].mergedCount).toBe(2);
    expect(stored[0].sources).toHaveLength(3);
    expect(stored[0].topicRefs).toHaveLength(3);
  });

  it('keeps longer content on merge', async () => {
    await insertWithDedup([makeEntry({ title: 'Test', content: 'ngắn' })], topic);
    await insertWithDedup([makeEntry({ title: 'Test', content: 'dài hơn nhiều so với bản gốc' })], topic);

    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('dài hơn nhiều so với bản gốc');
  });

  it('does not merge with dissimilar entry', async () => {
    await insertWithDedup([makeEntry({ title: 'Học tiếng Anh', content: 'Phương pháp học từ vựng hiệu quả' })], topic);
    await insertWithDedup([makeEntry({ title: 'Nấu ăn ngon', content: 'Công thức món Việt' })], topic);

    expect(stored).toHaveLength(2);
  });

  it('handles empty input', async () => {
    const result = await insertWithDedup([], topic);
    expect(result.inserted).toBe(0);
    expect(result.merged).toBe(0);
    expect(stored).toHaveLength(0);
  });

  it('avoids duplicate sources on re-extract same topic', async () => {
    await insertWithDedup([makeEntry({ title: 'Test', source: { author: 'alice', postNumber: 5 } })], topic);
    await insertWithDedup([makeEntry({ title: 'Test Retry', source: { author: 'alice', postNumber: 5 } })], topic);

    expect(stored).toHaveLength(1);
    expect(stored[0].sources).toHaveLength(1);
    expect(stored[0].mergedCount).toBe(1);
  });
});
