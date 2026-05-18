import { ref, type Ref } from 'vue';
import { buildSummarizePipeline as buildSummaryPipelineSteps, buildDynamicScrapePipeline as buildDynamicScrapeSteps, markStepRunning, markStepDone, markNextStepRunning, markFirstStepRunning } from '@/lib/pipeline-builder';
import type { PipelineDefinition, PipelineStep } from '@/lib/types';

export function usePipeline() {
  const pipeline: Ref<PipelineDefinition | null> = ref(null);

  /** Build the summarize pipeline up-front from expected segment boundaries. */
  function buildSummarizePipeline(segments: { start: number; end: number }[]): void {
    pipeline.value = buildSummaryPipelineSteps(segments);
  }

  /** Build the initial pipeline for dynamic mode: scrape + plan phases visible upfront. */
  function buildDynamicScrapePipeline(totalPages: number): void {
    pipeline.value = buildDynamicScrapeSteps(totalPages);
  }

  /**
   * Rebuild the pipeline after dynamic segment planning.
   * Called once after planDynamicSegments determines the boundaries.
   *
   * Replaces the entire pipeline with a deterministic set of steps:
   *   scrape (done) → plan (done) → summarize_0 (pending) → ... → overall (pending)
   *
   * Single-segment case: steps = scrape, plan, summarize, overall
   * Multi-segment case:  steps = scrape, plan, summarize_0..N, overall
   */
  function rebuildWithSegments(boundaries: { start: number; end: number }[]): void {
    const steps: PipelineStep[] = [
      { id: 'scrape', label: 'Scrape tất cả trang', status: 'done' },
      { id: 'plan', label: 'Tạo segment động', status: 'done' },
    ];

    if (boundaries.length === 0) {
      // No segments — no summarize step needed
    } else if (boundaries.length === 1) {
      steps.push({ id: 'summarize', label: 'Tóm tắt segment', status: 'pending' });
    } else {
      for (let i = 0; i < boundaries.length; i++) {
        steps.push({
          id: `summarize_${i}`,
          label: `Tóm tắt Segment ${i + 1}/${boundaries.length}`,
          status: 'pending',
        });
      }
    }

    steps.push({ id: 'overall', label: 'Tóm tắt tổng quan', status: 'pending' });

    pipeline.value = { workflow: 'summarize', steps };
  }

  function markFirstRunning(): void {
    if (pipeline.value) markFirstStepRunning(pipeline.value);
  }

  function markRunning(id: string): void {
    if (pipeline.value) markStepRunning(pipeline.value, id);
  }

  function markDone(id: string): void {
    if (pipeline.value) markStepDone(pipeline.value, id);
  }

  function markNextRunning(stepId: string): PipelineDefinition | null {
    if (!pipeline.value) return null;
    pipeline.value = markNextStepRunning(pipeline.value, stepId);
    return pipeline.value;
  }

  return {
    pipeline,
    buildSummarizePipeline,
    buildDynamicScrapePipeline,
    rebuildWithSegments,
    markFirstRunning,
    markRunning,
    markDone,
    markNextRunning,
  };
}
