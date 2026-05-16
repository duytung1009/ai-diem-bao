/**
 * RunGuard — Stale-run detection helper.
 *
 * Replaces manual `activeSummarizeId` / `activeAnalyzeId` counters with
 * an encapsulated monotonic token. Multiple guards can coexist for different
 * operation scopes (summarize vs analyze).
 */
export interface RunGuard {
  /** Increment the guard and return a new token. Use at the start of a run. */
  begin(): number;
  /** Returns true if `token` is older than the latest `begin()` call (run was superseded or cancelled). */
  isStale(token: number): boolean;
}

export function createRunGuard(): RunGuard {
  let current = 0;
  return {
    begin() {
      return ++current;
    },
    isStale(token: number) {
      return token !== current;
    },
  };
}
