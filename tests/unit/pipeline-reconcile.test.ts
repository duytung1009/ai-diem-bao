import { describe, it, expect, beforeEach } from 'vitest';
import { usePipeline } from '@/entrypoints/sidepanel/composables/usePipeline';

describe('pipeline rebuildWithSegments', () => {
  let pipeline: ReturnType<typeof usePipeline>;

  beforeEach(() => {
    pipeline = usePipeline();
  });

  it('0 boundaries → scrape, plan, overall (no summarize)', () => {
    pipeline.buildSummarizePipeline([{ start: 1, end: 1 }]);
    pipeline.rebuildWithSegments([]);

    const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
    expect(stepIds).toEqual(['scrape', 'plan', 'overall']);
  });

  it('1 boundary → scrape, plan, summarize, overall', () => {
    pipeline.rebuildWithSegments([{ start: 1, end: 5 }]);

    const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
    expect(stepIds).toEqual(['scrape', 'plan', 'summarize', 'overall']);
  });

  it('2 boundaries → scrape, plan, summarize_0, summarize_1, overall', () => {
    pipeline.rebuildWithSegments([{ start: 1, end: 5 }, { start: 6, end: 10 }]);

    const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
    expect(stepIds).toEqual(['scrape', 'plan', 'summarize_0', 'summarize_1', 'overall']);
  });

  it('3 boundaries with labels showing N/total', () => {
    pipeline.rebuildWithSegments([
      { start: 1, end: 3 },
      { start: 4, end: 6 },
      { start: 7, end: 10 },
    ]);

    const steps = pipeline.pipeline.value?.steps;
    expect(steps?.find(s => s.id === 'summarize_0')?.label).toBe('Tóm tắt Segment 1/3');
    expect(steps?.find(s => s.id === 'summarize_1')?.label).toBe('Tóm tắt Segment 2/3');
    expect(steps?.find(s => s.id === 'summarize_2')?.label).toBe('Tóm tắt Segment 3/3');
  });

  it('scrape and plan steps are done, summarize steps are pending, overall is pending', () => {
    pipeline.rebuildWithSegments([{ start: 1, end: 5 }, { start: 6, end: 10 }]);

    const steps = pipeline.pipeline.value!.steps;
    expect(steps.find(s => s.id === 'scrape')?.status).toBe('done');
    expect(steps.find(s => s.id === 'plan')?.status).toBe('done');
    expect(steps.find(s => s.id === 'summarize_0')?.status).toBe('pending');
    expect(steps.find(s => s.id === 'summarize_1')?.status).toBe('pending');
    expect(steps.find(s => s.id === 'overall')?.status).toBe('pending');
  });

  it('workflow is "summarize"', () => {
    pipeline.rebuildWithSegments([{ start: 1, end: 10 }]);
    expect(pipeline.pipeline.value?.workflow).toBe('summarize');
  });

  it('replaces existing pipeline completely', () => {
    pipeline.buildSummarizePipeline([{ start: 1, end: 20 }]);
    pipeline.rebuildWithSegments([{ start: 1, end: 5 }, { start: 6, end: 10 }]);

    const stepIds = pipeline.pipeline.value?.steps.map(s => s.id);
    expect(stepIds).toEqual(['scrape', 'plan', 'summarize_0', 'summarize_1', 'overall']);
  });
});
