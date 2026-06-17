import type { ForumThreadSummary, NewsFeedSettings } from './types';

export type HeatLevel = 'fire' | 'hot' | 'normal';

export interface HotThreadScore {
  thread: ForumThreadSummary;
  scores: {
    replyScore: number;
    viewScore: number;
    pageScore: number;
    recencyBonus: number;
    total: number;
  };
  heat: HeatLevel;
}

// `view` is a multiplier on the *logarithm* of the view count (see scoreThreads),
// so large view numbers (tens of thousands) don't dominate reply/recency. This
// keeps the ranking engagement-driven and stable across reloads — closer to the
// forum's own reply-bump ordering than a raw-view sort.
export const DEFAULT_WEIGHTS = {
  reply: 3,
  view: 30,
  page: 10,
} as const;

export const DEFAULT_THRESHOLDS = {
  fire: 1000,
  hot: 300,
} as const;

export const DEFAULT_RECENCY_MAX_BONUS = 80;
export const DEFAULT_MAX_AGE_HOURS = 24;
export const DEFAULT_TOP_N = 10;

function hoursAgo(dateStr: string, now: Date): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return Infinity;
  return Math.max(0, (now.getTime() - d.getTime()) / 3600000);
}

export function filterToday(
  threads: ForumThreadSummary[],
  maxHoursAgo: number = DEFAULT_MAX_AGE_HOURS,
  now?: Date,
): ForumThreadSummary[] {
  const ref = now ?? new Date();
  return threads.filter((t) => hoursAgo(t.lastPostTime, ref) <= maxHoursAgo);
}

export function scoreThreads(
  threads: ForumThreadSummary[],
  now?: Date,
  weights?: { reply: number; view: number; page: number },
  recencyMaxBonus?: number,
  heatThresholds?: { fire: number; hot: number },
): HotThreadScore[] {
  const w = weights ?? DEFAULT_WEIGHTS;
  const rmb = recencyMaxBonus ?? DEFAULT_RECENCY_MAX_BONUS;
  const thresh = heatThresholds ?? DEFAULT_THRESHOLDS;
  const nowDate = now ?? new Date();
  const scores: HotThreadScore[] = [];

  for (const thread of threads) {
    const replyScore = thread.replyCount * w.reply;
    // Log-scale views so a thread with 10× the views gets ~+log10 worth of score,
    // not 10× — prevents view count from dwarfing replies/recency.
    const viewScore = Math.log(Math.max(0, thread.viewCount) + 1) * w.view;
    const pageScore = Math.max(0, thread.pageCount - 1) * w.page;

    const ha = hoursAgo(thread.lastPostTime, nowDate);
    const recencyBonus = Math.max(0, Math.round(rmb - ha * (rmb / 12)));

    const total = replyScore + viewScore + pageScore + recencyBonus;

    let heat: HeatLevel;
    if (total >= thresh.fire) heat = 'fire';
    else if (total >= thresh.hot) heat = 'hot';
    else heat = 'normal';

    scores.push({
      thread,
      scores: { replyScore, viewScore, pageScore, recencyBonus, total },
      heat,
    });
  }

  return scores.sort((a, b) => b.scores.total - a.scores.total);
}

export function getTopThreads(
  threads: ForumThreadSummary[],
  settings?: Partial<NewsFeedSettings>,
  now?: Date,
): HotThreadScore[] {
  const maxAge = settings?.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const topN = settings?.maxThreads ?? DEFAULT_TOP_N;
  const weights = settings?.weights ?? DEFAULT_WEIGHTS;
  const thresholds = settings?.heatThresholds ?? DEFAULT_THRESHOLDS;

  const recent = filterToday(threads, maxAge, now);
  const scored = scoreThreads(recent, now, weights, undefined, thresholds);
  return scored.slice(0, topN);
}
