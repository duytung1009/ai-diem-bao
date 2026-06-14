import { describe, it, expect } from 'vitest';
import { filterToday, scoreThreads, getTopThreads } from '@/lib/hot-threads';
import type { ForumThreadSummary } from '@/lib/types';

function makeThread(overrides: Partial<ForumThreadSummary> & { lastPostTime: string }): ForumThreadSummary {
  return {
    title: 'Test',
    url: 'https://voz.vn/threads/test.1/',
    author: 'user_a',
    startDate: '2026-01-01T00:00:00Z',
    replyCount: 0,
    viewCount: 0,
    lastPostAuthor: 'user_b',
    isSticky: false,
    isLocked: false,
    pageCount: 1,
    ...overrides,
  };
}

describe('filterToday', () => {
  it('giữ thread có lastPost trong vòng 24h', () => {
    const now = new Date('2026-06-03T12:00:00Z');
    const threads = [
      makeThread({ lastPostTime: '2026-06-03T10:00:00Z' }),
      makeThread({ lastPostTime: '2026-06-02T13:00:00Z' }),
    ];
    const result = filterToday(threads, 24, now);
    expect(result).toHaveLength(2);
  });

  it('loại thread có lastPost > 24h', () => {
    const now = new Date('2026-06-03T12:00:00Z');
    const threads = [
      makeThread({ lastPostTime: '2026-06-01T08:00:00Z' }),
      makeThread({ lastPostTime: '2026-06-03T10:00:00Z' }),
    ];
    const result = filterToday(threads, 24, now);
    expect(result).toHaveLength(1);
    expect(result[0].lastPostTime).toBe('2026-06-03T10:00:00Z');
  });

  it('trả về mảng rỗng nếu không có thread nào trong 24h', () => {
    const now = new Date('2026-06-03T12:00:00Z');
    const threads = [
      makeThread({ lastPostTime: '2026-05-01T00:00:00Z' }),
    ];
    const result = filterToday(threads, 24, now);
    expect(result).toHaveLength(0);
  });

  it('trả về mảng rỗng nếu input rỗng', () => {
    const now = new Date('2026-06-03T12:00:00Z');
    const result = filterToday([], 24, now);
    expect(result).toHaveLength(0);
  });
});

describe('scoreThreads', () => {
  const baseTime = new Date('2026-06-03T12:00:00Z');

  it('tính đúng replyScore: replyCount * 3', () => {
    const threads = [makeThread({ replyCount: 100, lastPostTime: '2026-06-03T11:00:00Z' })];
    const result = scoreThreads(threads, baseTime);
    expect(result[0].scores.replyScore).toBe(300);
  });

  it('tính đúng viewScore: viewCount * 0.1', () => {
    const threads = [makeThread({ viewCount: 5000, lastPostTime: '2026-06-03T11:00:00Z' })];
    const result = scoreThreads(threads, baseTime);
    expect(result[0].scores.viewScore).toBe(500);
  });

  it('tính đúng pageScore: (pageCount - 1) * 10', () => {
    const threads = [makeThread({ pageCount: 5, lastPostTime: '2026-06-03T11:00:00Z' })];
    const result = scoreThreads(threads, baseTime);
    expect(result[0].scores.pageScore).toBe(40);
  });

  it('pageScore = 0 khi pageCount = 1', () => {
    const threads = [makeThread({ pageCount: 1, lastPostTime: '2026-06-03T11:00:00Z' })];
    const result = scoreThreads(threads, baseTime);
    expect(result[0].scores.pageScore).toBe(0);
  });

  it('recencyBonus giảm theo thời gian: 0h = 50, 12h = 0', () => {
    const fresh = makeThread({ lastPostTime: '2026-06-03T12:00:00Z' });
    const old = makeThread({ lastPostTime: '2026-06-03T00:00:00Z' });
    const result = scoreThreads([fresh, old], baseTime);
    expect(result.find((s) => s.thread === fresh)?.scores.recencyBonus).toBe(50);
    expect(result.find((s) => s.thread === old)?.scores.recencyBonus).toBe(0);
  });

  it('heat: fire >= 1000, hot >= 300, normal < 300', () => {
    const fireThread = makeThread({ replyCount: 340, lastPostTime: '2026-06-03T12:00:00Z' });  // 340*3+50=1070 >= 1000
    const hotThread = makeThread({ replyCount: 100, lastPostTime: '2026-06-03T12:00:00Z' });   // 100*3+50=350 >= 300
    const normalThread = makeThread({ replyCount: 10, lastPostTime: '2026-06-03T00:00:00Z' }); // 10*3+0=30 < 300
    const result = scoreThreads([fireThread, hotThread, normalThread], baseTime);
    expect(result.find((s) => s.thread === fireThread)?.heat).toBe('fire');
    expect(result.find((s) => s.thread === hotThread)?.heat).toBe('hot');
    expect(result.find((s) => s.thread === normalThread)?.heat).toBe('normal');
  });

  it('sắp xếp giảm dần theo total', () => {
    const a = makeThread({ replyCount: 100, lastPostTime: '2026-06-03T12:00:00Z' }); // 350+50=400
    const b = makeThread({ replyCount: 10, lastPostTime: '2026-06-03T12:00:00Z' });  // 30+50=80
    const result = scoreThreads([b, a], baseTime);
    expect(result[0].scores.total).toBeGreaterThanOrEqual(result[1].scores.total);
    expect(result[0].thread.replyCount).toBe(100);
  });
});

describe('getTopThreads', () => {
  const baseTime = new Date('2026-06-03T12:00:00Z');
  const threads = [
    makeThread({ title: 'A', replyCount: 100, lastPostTime: '2026-06-03T11:00:00Z' }),
    makeThread({ title: 'B', replyCount: 50, lastPostTime: '2026-06-03T11:00:00Z' }),
  ];

  it('trả về top N thread', () => {
    const result = getTopThreads(threads, { maxThreads: 1 }, baseTime);
    expect(result).toHaveLength(1);
    expect(result[0].thread.title).toBe('A');
  });

  it('dùng default settings nếu không truyền', () => {
    const result = getTopThreads(threads, undefined, baseTime);
    expect(result).toHaveLength(2);
  });
});
