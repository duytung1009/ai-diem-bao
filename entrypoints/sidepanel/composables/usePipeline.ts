import { ref, type Ref } from 'vue';
import { buildSummarizePipeline as buildSummaryPipelineSteps, markStepRunning, markStepDone, markNextStepRunning, markFirstStepRunning } from '@/lib/pipeline-builder';
import type { PipelineDefinition, PipelineStep } from '@/lib/types';

export function usePipeline() {
  const pipeline: Ref<PipelineDefinition | null> = ref(null);

  /** Build the summarize pipeline up-front from expected segment boundaries. */
  function buildSummarizePipeline(segments: { start: number; end: number }[]): void {
    pipeline.value = buildSummaryPipelineSteps(segments);
  }

  /**
   * Reconcile the pipeline with the actual number of segments created during
   * dynamic auto-summarize. Replaces the old progressive-append hack.
   *
   * Called each time a new segment is finalized. Inserts or adjusts segment
   * steps between the scrape steps and the "overall" step.
   */
  function reconcile(actualSegments: number): void {
    if (!pipeline.value) return;

    const overallIdx = pipeline.value.steps.findIndex(s => s.id === 'overall');
    const insertIdx = overallIdx >= 0 ? overallIdx : pipeline.value.steps.length;

    // Remove any existing segment steps (summarize_N)
    const filtered = pipeline.value.steps.filter(
      s => !s.id.startsWith('summarize_'),
    );

    // Insert segment steps for all actual segments
    const segSteps: PipelineStep[] = [];
    for (let i = 0; i < actualSegments; i++) {
      segSteps.push({
        id: `summarize_${i}`,
        label: `Tóm tắt segment ${i + 1}`,
        status: i < actualSegments - 1 ? 'done' : 'running',
      });
    }

    const before = filtered.slice(0, insertIdx);
    const after = filtered.slice(insertIdx);

    pipeline.value = {
      ...pipeline.value,
      steps: [...before, ...segSteps, ...after],
    };
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
    reconcile,
    markFirstRunning,
    markRunning,
    markDone,
    markNextRunning,
  };
}
