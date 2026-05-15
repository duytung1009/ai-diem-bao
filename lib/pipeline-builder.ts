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
    steps.push(pending('Tạo tóm tắt tổng quan', 'summarize'));
  } else {
    segments.forEach((seg, i) => {
      const label = seg.start === seg.end ? `Scrape trang ${seg.start}` : `Scrape trang ${seg.start}–${seg.end}`;
      steps.push(pending(label, `scrape_${i}`));
      steps.push(pending(`Tạo tóm tắt Segment ${i + 1}/${segments.length}`, `summarize_${i}`));
    });
    steps.push(pending('Tạo tóm tắt tổng quan', 'overall'));
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
  const step = pipeline.steps.find(s => s.id === stepId);
  if (step) step.status = 'done';
}

/** Mark a step as running by its id (and set others to pending) */
export function markStepRunning(pipeline: PipelineDefinition, stepId: string, etaMs?: number): void {
  for (const s of pipeline.steps) {
    if (s.id === stepId) {
      s.status = 'running';
      s.etaMs = etaMs;
    } else if (s.status === 'running') {
      s.status = 'done';
    }
  }
}

/** Mark a step as errored */
export function markStepError(pipeline: PipelineDefinition, stepId: string, errorMsg?: string): void {
  const step = pipeline.steps.find(s => s.id === stepId);
  if (step) {
    step.status = 'error';
    step.error = errorMsg;
  }
}
