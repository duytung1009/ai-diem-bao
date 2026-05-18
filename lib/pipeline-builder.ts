import type { PipelineDefinition, PipelineStep, PipelineWorkflow } from './types';

function pending(label: string, id?: string): PipelineStep {
  return { id: id ?? label, label, status: 'pending' };
}

/** Mark the first step of a pipeline as running */
export function markFirstStepRunning(pipeline: PipelineDefinition): void {
  if (pipeline.steps.length > 0 && pipeline.steps[0].status === 'pending') {
    pipeline.steps[0].status = 'running';
  }
}

/**
 * Build pipeline for dynamic summarize flow.
 * Before segments are known: shows scrape + plan phases upfront.
 * After plan completes, rebuildWithSegments (usePipeline.ts) replaces the
 * placeholder `overall` step with the real summarize_0..N + overall steps.
 */
export function buildDynamicScrapePipeline(totalPages: number): PipelineDefinition {
  const label = totalPages === 1 ? 'Scraping trang 1' : `Scraping trang 1–${totalPages}`;
  return {
    workflow: 'summarize',
    steps: [
      pending(label, 'scrape'),
      pending('Tạo segment động', 'plan'),
      pending('Tóm tắt tổng quan', 'overall'),
    ],
  };
}

/**
 * Build pipeline for summarize workflow.
 * - Single segment: [scrape, summarize]
 * - Multi-segment (N): [scrape_0, summarize_0, ..., overall]
 */
export function buildSummarizePipeline(segments: { start: number; end: number }[]): PipelineDefinition {
  const steps: PipelineStep[] = [];

  if (segments.length <= 1) {
    if (segments.length === 1) {
      const s = segments[0];
      const label = s.start === s.end ? `Scrape trang ${s.start}` : `Scrape trang ${s.start}–${s.end}`;
      steps.push(pending(label, 'scrape'));
    }
    steps.push(pending('Tóm tắt segment', 'summarize'));
    steps.push(pending('Tóm tắt tổng quan', 'overall'));
  } else {
    segments.forEach((seg, i) => {
      const label = seg.start === seg.end ? `Scrape trang ${seg.start}` : `Scrape trang ${seg.start}–${seg.end}`;
      steps.push(pending(label, `scrape_${i}`));
      steps.push(pending(`Tóm tắt Segment ${i + 1}/${segments.length}`, `summarize_${i}`));
    });
    steps.push(pending('Tóm tắt tổng quan', 'overall'));
  }

  return { workflow: 'summarize', steps };
}

/**
 * Build pipeline for knowledge extraction workflow.
 * - M chunks: [extract_0, extract_1, ..., reduce]
 */
export function buildKnowledgePipeline(chunkCount: number): PipelineDefinition {
  const steps: PipelineStep[] = [];

  for (let i = 0; i < chunkCount; i++) {
    steps.push(pending(`Trích xuất Segment ${i + 1}/${chunkCount}`, `extract_${i}`));
  }
  steps.push(pending('Gộp kiến thức', 'reduce'));

  return { workflow: 'knowledge', steps };
}

/**
 * Build pipeline for research workflow.
 */
export function buildResearchPipeline(): PipelineDefinition {
  return {
    workflow: 'research',
    steps: [pending('Tra cứu và phân tích', 'research')],
  };
}

/** Mark a step as done by its id */
export function markStepDone(pipeline: PipelineDefinition, stepId: string): void {
  pipeline.steps.forEach(s => {
    if (s.id === stepId) {
      s.status = 'done';
    }
  });
}

/** Mark a step as running by its id (and set others to pending) */
export function markStepRunning(pipeline: PipelineDefinition, stepId: string, etaMs?: number): void {
  pipeline.steps.forEach(s => {
    if (s.id === stepId) {
      s.status = 'running';
      s.etaMs = etaMs;
    }
  });
}

/** Mark a step as errored */
export function markStepError(pipeline: PipelineDefinition, stepId: string, errorMsg?: string): void {
  pipeline.steps.forEach(s => {
    if (s.id === stepId) {
      s.status = 'error';
      s.error = errorMsg;
    }
  });
}

export function markNextStepRunning(pipeline: PipelineDefinition, stepId: string, etaMs?: number): PipelineDefinition {
  markStepDone(pipeline, stepId);
  const currentIndex = pipeline.steps.findIndex(s => s.id === stepId);
  if (currentIndex !== -1 && currentIndex < pipeline.steps.length - 1) {
    const nextStep = pipeline.steps[currentIndex + 1];
    markStepRunning(pipeline, nextStep.id, etaMs);
  }
  return pipeline;
}
