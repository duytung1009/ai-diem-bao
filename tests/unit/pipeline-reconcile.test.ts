import { describe, it, expect, beforeEach } from 'vitest';
import { usePipeline } from '@/entrypoints/sidepanel/composables/usePipeline';

describe('pipeline reconcile with scrape + summarize steps', () => {
  let pipeline: ReturnType<typeof usePipeline>;

  beforeEach(() => {
    pipeline = usePipeline();
  });

  describe('reconcile with dynamic segments (first call, no hasDynamicSegments)', () => {
    it('creates scrape_0 + summarize_0 for 1 segment, removes placeholder summarize+scrape', () => {
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      expect(pipeline.pipeline.value?.steps.map(s => s.id)).toEqual(['scrape', 'summarize', 'overall']);

      pipeline.reconcile(1, [{ start: 1, end: 9 }]);

      const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
      expect(stepIds).toEqual(['scrape_0', 'summarize_0', 'overall']);
      expect(stepIds).not.toContain('summarize');
      expect(stepIds).not.toContain('scrape');
    });

    it('creates scrape_0..1 + summarize_0..1 for 2 segments', () => {
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      pipeline.reconcile(2, [{ start: 1, end: 9 }, { start: 10, end: 16 }]);

      const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
      expect(stepIds).toEqual([
        'scrape_0', 'summarize_0',
        'scrape_1', 'summarize_1', 'overall',
      ]);
      expect(stepIds).not.toContain('summarize');
    });
  });

  describe('reconcile with dynamic segments (subsequent calls, hasDynamicSegments)', () => {
    it('rebuilds all scrape + summarize steps on second call', () => {
      // First call: replaces scrape+summarize → scrape_0, summarize_0, overall
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      pipeline.reconcile(1, [{ start: 1, end: 9 }]);

      // Second call rebuilds with all 2 segments
      pipeline.reconcile(2, [{ start: 1, end: 9 }, { start: 10, end: 16 }]);

      const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
      expect(stepIds).toEqual([
        'scrape_0', 'summarize_0',
        'scrape_1', 'summarize_1', 'overall',
      ]);
      expect(stepIds).not.toContain('scrape');
      expect(stepIds).not.toContain('summarize');
    });

    it('rebuilds 3 segments with scrape + summarize each', () => {
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      pipeline.reconcile(3, [
        { start: 1, end: 9 },
        { start: 10, end: 16 },
        { start: 17, end: 20 },
      ]);

      const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
      expect(stepIds).toEqual([
        'scrape_0', 'summarize_0',
        'scrape_1', 'summarize_1',
        'scrape_2', 'summarize_2', 'overall',
      ]);
    });
  });

  describe('reconcile with fixed-mode multi-segment', () => {
    it('keeps existing steps unchanged (no-op)', () => {
      pipeline.buildSummarizePipeline([
        { start: 1, end: 20 },
        { start: 21, end: 40 },
      ]);

      const beforeIds = pipeline.pipeline.value?.steps.map(s => s.id);
      expect(beforeIds).toEqual(['scrape_0', 'summarize_0', 'scrape_1', 'summarize_1', 'overall']);

      pipeline.reconcile(2);
      const afterIds = pipeline.pipeline.value?.steps.map(s => s.id);
      expect(afterIds).toEqual(beforeIds);
    });
  });

  describe('reconcile edge cases', () => {
    it('does nothing when pipeline is null', () => {
      pipeline.reconcile(3);
      expect(pipeline.pipeline.value).toBeNull();
    });

    it('handles 0 segments (removes both placeholder steps)', () => {
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      pipeline.reconcile(0);

      const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
      expect(stepIds).toEqual(['overall']);
    });

    it('all inserted steps are done (none running)', () => {
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      pipeline.reconcile(3, [
        { start: 1, end: 9 },
        { start: 10, end: 16 },
        { start: 17, end: 20 },
      ]);

      const steps = pipeline.pipeline.value?.steps;
      const segSteps = steps?.filter(s => s.id.startsWith('scrape_') || s.id.startsWith('summarize_'));
      expect(segSteps?.length).toBe(6);
      segSteps?.forEach(s => expect(s.status).toBe('done'));
    });

    it('scrape labels use page ranges when provided', () => {
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      pipeline.reconcile(2, [{ start: 1, end: 9 }, { start: 10, end: 16 }]);

      const steps = pipeline.pipeline.value?.steps;
      expect(steps?.find(s => s.id === 'scrape_0')?.label).toBe('Scrape trang 1–9');
      expect(steps?.find(s => s.id === 'scrape_1')?.label).toBe('Scrape trang 10–16');
    });

    it('single-page scrape label shows single page number', () => {
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      pipeline.reconcile(1, [{ start: 5, end: 5 }]);

      const step = pipeline.pipeline.value?.steps.find(s => s.id === 'scrape_0');
      expect(step?.label).toBe('Scrape trang 5');
    });
  });
});
