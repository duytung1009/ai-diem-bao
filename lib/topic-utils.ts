import type { CachedTopic } from './types';

export type TopicSummaryStatus = 'none' | 'in-progress' | 'partial' | 'done';

export function topicSummaryStatus(
  topic: CachedTopic,
  isSummarizing: boolean,
): TopicSummaryStatus {
  if (isSummarizing) return 'in-progress';
  const hasSummary = !!(topic.summary || topic.segments?.some(s => s?.summary));
  if (!hasSummary) return 'none';
  const summarized = topic.summarizedPostCount ?? topic.totalPosts ?? 0;
  if (summarized < (topic.totalPosts ?? 0)) return 'partial';
  return 'done';
}

/** Relative if < 24 h, absolute (dd/MM/yyyy HH:mm) if >= 24 h */
export function formatTopicDate(timestampMs: number): string {
  const diff = Date.now() - timestampMs;
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'vừa xong';
  if (h < 24) return `${h} giờ trước`;
  const d = new Date(timestampMs);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
