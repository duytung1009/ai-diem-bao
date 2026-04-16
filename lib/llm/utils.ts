/**
 * Merge multiple AbortSignals into one: aborts the combined controller when any input fires.
 * Fallback for environments where AbortSignal.any() is not available.
 */
export function mergeAbortSignals(...signals: (AbortSignal | undefined)[]): AbortController {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) { ctrl.abort(s.reason); break; }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl;
}
