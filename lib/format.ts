export function formatNumber(n: number | null | undefined): string {
  if (n === undefined || n === null) return '0';
  return n.toLocaleString('en-US');
}