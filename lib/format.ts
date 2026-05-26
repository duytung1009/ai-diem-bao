export function formatNumber(n: number | null | undefined): string {
  if (n === undefined || n === null) return '0';
  return n.toLocaleString('en-US');
}

/**
 * Format estimated time in milliseconds to a human-readable Vietnamese string.
 * < 60s → "~X giây"
 * 1–10 min → "~X–Y phút"
 * > 10 min → "~X phút"
 */
export function formatEstimatedTime(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `~${seconds} giây`;
  const minutes = Math.round(seconds / 60);
  if (minutes <= 10) return `~${minutes}–${minutes + 1} phút`;
  return `~${minutes} phút`;
}