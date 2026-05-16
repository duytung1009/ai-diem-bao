import { describe, it, expect } from 'vitest';
import { createRunGuard } from '@/lib/run-guard';

describe('RunGuard', () => {
  describe('begin()', () => {
    it('returns incrementing tokens starting from 1', () => {
      const guard = createRunGuard();
      expect(guard.begin()).toBe(1);
      expect(guard.begin()).toBe(2);
      expect(guard.begin()).toBe(3);
    });

    it('multiple guards have independent counters', () => {
      const g1 = createRunGuard();
      const g2 = createRunGuard();
      expect(g1.begin()).toBe(1);
      expect(g2.begin()).toBe(1);
      expect(g1.begin()).toBe(2);
      expect(g2.begin()).toBe(2);
    });
  });

  describe('isStale()', () => {
    it('token from begin() is not stale immediately', () => {
      const guard = createRunGuard();
      const token = guard.begin();
      expect(guard.isStale(token)).toBe(false);
    });

    it('token becomes stale after another begin()', () => {
      const guard = createRunGuard();
      const token1 = guard.begin();
      guard.begin(); // start a new run, invalidates token1
      expect(guard.isStale(token1)).toBe(true);
    });

    it('latest token is never stale', () => {
      const guard = createRunGuard();
      guard.begin();
      guard.begin();
      const token3 = guard.begin();
      expect(guard.isStale(token3)).toBe(false);
    });

    it('begin() called without capturing token invalidates all previous tokens (cancel pattern)', () => {
      const guard = createRunGuard();
      const token = guard.begin();
      guard.begin(); // cancel without assigning
      expect(guard.isStale(token)).toBe(true);
    });

    it('token 0 is not stale before any begin() — counter also starts at 0', () => {
      const guard = createRunGuard();
      // 0 === 0 — no run has begun, so nothing is stale
      expect(guard.isStale(0)).toBe(false);
    });

    it('monotonic: tokens always increase', () => {
      const guard = createRunGuard();
      const tokens: number[] = [];
      for (let i = 0; i < 100; i++) {
        tokens.push(guard.begin());
      }
      for (let i = 1; i < tokens.length; i++) {
        expect(tokens[i]).toBeGreaterThan(tokens[i - 1]);
      }
    });
  });

  describe('stale-guard pattern (simulating useSummarize)', () => {
    it('concurrent runs: second run makes first stale', () => {
      const guard = createRunGuard();

      // First run starts
      const id1 = guard.begin();
      expect(guard.isStale(id1)).toBe(false);

      // Second run starts (cancels first)
      const id2 = guard.begin();
      expect(guard.isStale(id1)).toBe(true);
      expect(guard.isStale(id2)).toBe(false);

      // Third run starts (cancels second)
      const id3 = guard.begin();
      expect(guard.isStale(id1)).toBe(true);
      expect(guard.isStale(id2)).toBe(true);
      expect(guard.isStale(id3)).toBe(false);
    });

    it('cancel + fresh run: old tokens are all stale', () => {
      const guard = createRunGuard();
      const run1 = guard.begin();
      expect(guard.isStale(run1)).toBe(false);

      // Cancel (invalidate without starting new tracked run)
      guard.begin();
      expect(guard.isStale(run1)).toBe(true);

      // Fresh run
      const run2 = guard.begin();
      expect(guard.isStale(run1)).toBe(true);
      expect(guard.isStale(run2)).toBe(false);
    });
  });
});
