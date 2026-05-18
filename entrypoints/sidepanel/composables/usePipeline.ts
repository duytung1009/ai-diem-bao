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
   *
   * In dynamic mode, each segment gets a scrape step + summarize step
   * (like the fixed-mode multi-segment pipeline), so the StepTimeline shows
   * both scraping and summarizing for every dynamically-created segment.
   */
  function reconcile(
    actualSegments: number,
    pageRanges?: { start: number; end: number }[],
  ): void {
    if (!pipeline.value) return;

    const existingSegSteps = pipeline.value.steps.filter(s => s.id.startsWith('summarize_'));
    const hasDynamicSegments = existingSegSteps.length > 0;

    // If fixed-mode multi-segment already has the right number of segments, no-op
    if (hasDynamicSegments && existingSegSteps.length === actualSegments) return;

    // Remove existing segment steps (summarize_N and scrape_N) and the placeholder
    // 'summarize' / 'scrape' when rebuilding dynamic segments.
    // For the first dynamic call (no existing summarize_N), also remove the initial
    // monolithic 'scrape' step since we replace it with per-segment scrape_N.
    // For fixed-mode multi-segment, keep existing steps.
    const filtered = pipeline.value.steps.filter(s => {
      if (hasDynamicSegments) {
        return !s.id.startsWith('summarize_') && !s.id.startsWith('scrape_')
          && s.id !== 'summarize' && s.id !== 'scrape';
      }
      return s.id !== 'summarize' && s.id !== 'scrape';
    });

    // Find where to insert (before 'overall' step)
    const overallIdx = filtered.findIndex(s => s.id === 'overall');
    const insertIdx = overallIdx >= 0 ? overallIdx : filtered.length;

    // Insert scrape + summarize steps for all segments completed so far.
    // In dynamic mode there is a single monolithic 'scrape' step initially;
    // we replace it with per-segment scrape_N + summarize_N pairs.
    // All inserted steps are 'done' since reconcile is called after LLM completes.
    const segSteps: PipelineStep[] = [];
    for (let i = 0; i < actualSegments; i++) {
      const range = pageRanges?.[i] ?? { start: i + 1, end: i + 1 };
      const scrapeLabel = range.start === range.end
        ? `Scrape trang ${range.start}`
        : `Scrape trang ${range.start}–${range.end}`;
      segSteps.push({
        id: `scrape_${i}`,
        label: scrapeLabel,
        status: 'done',
      });
      segSteps.push({
        id: `summarize_${i}`,
        label: `Tóm tắt Segment ${i + 1}`,
        status: 'done',
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
