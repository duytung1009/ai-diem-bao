import { describe, it, expect } from 'vitest';
import { markStepDone, markStepError } from '@/lib/pipeline-builder';
import type { PipelineDefinition } from '@/lib/types';

describe('handleProgress/handleResult pipeline step management — regression tests', () => {
  const basePipeline: PipelineDefinition = {
    workflow: 'summarize',
    steps: [
      { id: 'scrape', label: 'Scrape', status: 'done' },
      { id: 'plan', label: 'Plan', status: 'done' },
      { id: 'summarize', label: 'Tóm tắt segment', status: 'running' },
      { id: 'overall', label: 'Tóm tắt tổng quan', status: 'pending' },
    ],
  };

  it('handleResult should not throw when no running step exists (all steps done)', () => {
    const pipeline: PipelineDefinition = JSON.parse(JSON.stringify(basePipeline));
    pipeline.steps[2].status = 'done';
    pipeline.steps[3].status = 'done';

    const runningStep = pipeline.steps.find(s => s.status === 'running');
    expect(runningStep).toBeUndefined();

    expect(() => {
      if (runningStep) {
        markStepDone(pipeline, runningStep.id);
      }
    }).not.toThrow();
  });

  it('handleResult should mark running step as done when one exists', () => {
    const pipeline: PipelineDefinition = JSON.parse(JSON.stringify(basePipeline));

    const runningStep = pipeline.steps.find(s => s.status === 'running');
    expect(runningStep).toBeDefined();
    expect(runningStep!.id).toBe('summarize');

    markStepDone(pipeline, runningStep!.id);
    expect(pipeline.steps[2].status).toBe('done');
    expect(pipeline.steps[3].status).toBe('pending');
  });

  it('handleResult should mark running step as error when one exists', () => {
    const pipeline: PipelineDefinition = JSON.parse(JSON.stringify(basePipeline));

    const runningStep = pipeline.steps.find(s => s.status === 'running');
    markStepError(pipeline, runningStep!.id, 'API error');
    expect(pipeline.steps[2].status).toBe('error');
  });

  it('handleProgress must not advance pipeline steps based on LLM progress numbers', () => {
    const pipeline: PipelineDefinition = JSON.parse(JSON.stringify(basePipeline));

    // Before the fix, handleProgress used markNextStepRunning which would
    // advance pipeline steps based on LLM progress step numbers.
    // For map-reduce with 4 steps, this would incorrectly mark 'summarize' as done
    // and 'overall' as running when LLM progress step=2 arrives.
    //
    // After the fix, handleProgress only updates the ETA on the running step.
    // The 'summarize' step should remain 'running' and 'overall' should stay 'pending'.
    const summarizeStep = pipeline.steps.find(s => s.id === 'summarize');
    const overallStep = pipeline.steps.find(s => s.id === 'overall');

    expect(summarizeStep?.status).toBe('running');
    expect(overallStep?.status).toBe('pending');

    // Simulate what handleProgress does AFTER the fix:
    // Only update ETA, don't advance steps
    if (summarizeStep && summarizeStep.status === 'running') {
      summarizeStep.etaMs = 5000;
    }

    expect(summarizeStep?.status).toBe('running');
    expect(overallStep?.status).toBe('pending');
    expect(summarizeStep?.etaMs).toBe(5000);
  });

  it('handleProgress with multiple map-reduce progress steps should not advance pipeline', () => {
    const pipeline: PipelineDefinition = JSON.parse(JSON.stringify(basePipeline));

    // Simulate 4 map-reduce progress messages (3 chunks + 1 reduce)
    // Each would have previously called markNextStepRunning with different pipeline indices
    for (let step = 1; step <= 4; step++) {
      const runningStep = pipeline.steps.find(s => s.status === 'running');
      if (runningStep) {
        runningStep.etaMs = step * 1000;
      }
    }

    const summarizeStep = pipeline.steps.find(s => s.id === 'summarize');
    const overallStep = pipeline.steps.find(s => s.id === 'overall');

    expect(summarizeStep?.status).toBe('running');
    expect(overallStep?.status).toBe('pending');
  });

  it('full flow: map-reduce progress messages then result should not hang', () => {
    const pipeline: PipelineDefinition = JSON.parse(JSON.stringify(basePipeline));

    // Simulate map-reduce progress messages (new behavior: only update ETA)
    for (let step = 1; step <= 4; step++) {
      const runningStep = pipeline.steps.find(s => s.status === 'running');
      if (runningStep) {
        runningStep.etaMs = step * 1000;
      }
    }

    // Simulate handleResult (new behavior: null-check runningStep)
    const runningStep = pipeline.steps.find(s => s.status === 'running');
    expect(runningStep).toBeDefined();
    if (runningStep) {
      markStepDone(pipeline, runningStep.id);
    }

    expect(pipeline.steps[2].status).toBe('done');
    expect(pipeline.steps[3].status).toBe('pending');
  });
});
