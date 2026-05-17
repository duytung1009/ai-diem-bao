import { describe, it, expect, beforeEach } from 'vitest';
import { usePipeline } from '@/entrypoints/sidepanel/composables/usePipeline';

describe('C4 part 1: filter out placeholder summarize step in reconcile', () => {
  let pipeline: ReturnType<typeof usePipeline>;

  beforeEach(() => {
    pipeline = usePipeline();
  });

  describe('reconcile with dynamic segments', () => {
    it('removes placeholder summarize when dynamic segments exist (1 segment)', () => {
      // Simulate fixed-mode pipeline: [scrape, summarize, overall]
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      expect(pipeline.pipeline.value?.steps.map(s => s.id)).toEqual(['scrape', 'summarize', 'overall']);

      // Reconcile with 1 dynamic segment
      pipeline.reconcile(1);

      const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
      expect(stepIds).toEqual(['scrape', 'summarize_0', 'overall']);
      expect(stepIds).not.toContain('summarize');
    });

    it('removes placeholder summarize when dynamic segments exist (2 segments)', () => {
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      pipeline.reconcile(2);

      const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
      expect(stepIds).toEqual(['scrape', 'summarize_0', 'summarize_1', 'overall']);
      expect(stepIds).not.toContain('summarize');
    });

    it('removes placeholder summarize when dynamic segments exist (3 segments)', () => {
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      pipeline.reconcile(3);

      const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
      expect(stepIds).toEqual(['scrape', 'summarize_0', 'summarize_1', 'summarize_2', 'overall']);
      expect(stepIds).not.toContain('summarize');
    });
  });

  describe('reconcile with fixed-mode multi-segment', () => {
    it('keeps summarize_N steps, no placeholder to remove', () => {
      // Fixed-mode multi-segment: [scrape_0, summarize_0, scrape_1, summarize_1, overall]
      pipeline.buildSummarizePipeline([
        { start: 1, end: 20 },
        { start: 21, end: 40 },
      ]);

      const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
      expect(stepIds).toEqual(['scrape_0', 'summarize_0', 'scrape_1', 'summarize_1', 'overall']);
      expect(stepIds).not.toContain('summarize');

      // Reconcile should not change anything
      pipeline.reconcile(2);
      const afterIds = pipeline.pipeline.value?.steps.map(s => s.id);
      expect(afterIds).toEqual(['scrape_0', 'summarize_0', 'scrape_1', 'summarize_1', 'overall']);
    });
  });

  describe('reconcile edge cases', () => {
    it('does nothing when pipeline is null', () => {
      pipeline.reconcile(3);
      expect(pipeline.pipeline.value).toBeNull();
    });

    it('handles reconcile with 0 segments', () => {
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      pipeline.reconcile(0);

      const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
      // Only scrape and overall remain, no summarize steps
      expect(stepIds).toEqual(['scrape', 'overall']);
    });

    it('marks last segment as running, others as done', () => {
      pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
      pipeline.reconcile(3);

      const steps = pipeline.pipeline.value?.steps;
      const segSteps = steps?.filter(s => s.id.startsWith('summarize_'));
      expect(segSteps?.[0].status).toBe('done');
      expect(segSteps?.[1].status).toBe('done');
      expect(segSteps?.[2].status).toBe('running');
    });
  });
});
