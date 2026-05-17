import { vi } from 'vitest';
import type { ScrapedPost, XenForoVersion, PipelineDefinition, PipelineStep, PipelineWorkflow } from '@/lib/types';
import type { ScrapeProgress } from '@/entrypoints/sidepanel/composables/useTopicScraper';

// ── Scraper Module Mock ───────────────────────────────────────────────────────

export interface ScraperMockState {
  defaultPosts: ScrapedPost[];
  defaultErrors: string[];
  defaultThreadDeleted: boolean;
  defaultThreadLocked: boolean;
  progressUpdates: { current: number; total: number; postsScraped: number }[];
}

export function createScraperMockState(overrides: Partial<ScraperMockState> = {}): ScraperMockState {
  return {
    defaultPosts: overrides.defaultPosts ?? [],
    defaultErrors: overrides.defaultErrors ?? [],
    defaultThreadDeleted: overrides.defaultThreadDeleted ?? false,
    defaultThreadLocked: overrides.defaultThreadLocked ?? false,
    progressUpdates: [],
  };
}

/**
 * Mock for '@/lib/scrapers/page-loader' module.
 * Use with vi.mock('@/lib/scrapers/page-loader', () => createPageLoaderMock(state)).
 */
export function createPageLoaderMock(state: ScraperMockState) {
  return {
    scrapePageRange: vi.fn<
      (version: XenForoVersion, url: string, startPage: number, endPage: number, onProgress?: (...args: unknown[]) => void, signal?: AbortSignal, delayMs?: number) => Promise<{ posts: ScrapedPost[]; errors: string[]; threadDeleted?: boolean; threadLocked?: boolean }>
    >(async (_version, _url, startPage, endPage, onProgress, _signal, _delayMs) => {
      const pagesScraped = endPage - startPage + 1;
      state.progressUpdates.push({
        current: pagesScraped,
        total: pagesScraped,
        postsScraped: state.defaultPosts.length,
      });
      onProgress?.(pagesScraped, pagesScraped, state.defaultPosts.length);
      return {
        posts: state.defaultPosts,
        errors: state.defaultErrors,
        threadDeleted: state.defaultThreadDeleted,
        threadLocked: state.defaultThreadLocked,
      };
    }),
  };
}

/**
 * Mock for '@/entrypoints/sidepanel/composables/useTopicScraper' module.
 */
export function createTopicScraperMock(state: ScraperMockState) {
  const isScraping = { value: false };
  const scrapeProgress = { value: null as ScrapeProgress | null };
  const scrapingWarnings = { value: [] as string[] };
  const scrapingInfo = { value: [] as string[] };

  return {
    useTopicScraper: vi.fn(() => ({
      isScraping,
      scrapeProgress,
      scrapingWarnings,
      scrapingInfo,
      scrapeRange: vi.fn(async () => ({
        posts: state.defaultPosts,
        errors: state.defaultErrors,
        threadDeleted: state.defaultThreadDeleted,
        threadLocked: state.defaultThreadLocked,
      })),
      abortScrape: vi.fn(() => {}),
      getAbortSignal: vi.fn(() => undefined),
      countRealPosts: vi.fn((posts: ScrapedPost[]) => posts.filter(p => p.postNumber >= 0).length),
      enrichWithNewsArticles: vi.fn(async (posts: ScrapedPost[]) => posts),
    })),
  };
}

// ── Pipeline Module Mock ──────────────────────────────────────────────────────

export interface PipelineMockState {
  defaultSteps: PipelineStep[];
  defaultWorkflow: PipelineWorkflow;
}

export function createPipelineMockState(overrides: Partial<PipelineMockState> = {}): PipelineMockState {
  return {
    defaultSteps: overrides.defaultSteps ?? [],
    defaultWorkflow: overrides.defaultWorkflow ?? 'summarize',
  };
}

/**
 * Mock for '@/lib/pipeline-builder' module.
 */
export function createPipelineBuilderMock(state: PipelineMockState) {
  return {
    buildSummarizePipeline: vi.fn((_segments: { start: number; end: number }[]) => ({
      workflow: state.defaultWorkflow,
      steps: state.defaultSteps.length > 0
        ? state.defaultSteps.map(s => ({ ...s }))
        : [
            { id: 'scrape', label: 'Scrape', status: 'pending' as const },
            { id: 'summarize', label: 'Summarize', status: 'pending' as const },
            { id: 'overall', label: 'Overall', status: 'pending' as const },
          ],
    })),
    buildKnowledgePipeline: vi.fn((_chunkCount: number) => ({
      workflow: 'knowledge' as PipelineWorkflow,
      steps: [],
    })),
    buildResearchPipeline: vi.fn(() => ({
      workflow: 'research' as PipelineWorkflow,
      steps: [{ id: 'research', label: 'Research', status: 'pending' as const }],
    })),
    markFirstStepRunning: vi.fn((pipeline: PipelineDefinition) => {
      if (pipeline.steps.length > 0) pipeline.steps[0].status = 'running';
    }),
    markStepDone: vi.fn((pipeline: PipelineDefinition, stepId: string) => {
      pipeline.steps.forEach(s => { if (s.id === stepId) s.status = 'done'; });
    }),
    markStepRunning: vi.fn((pipeline: PipelineDefinition, stepId: string) => {
      pipeline.steps.forEach(s => { if (s.id === stepId) s.status = 'running'; });
    }),
    markStepError: vi.fn((pipeline: PipelineDefinition, stepId: string, error?: string) => {
      pipeline.steps.forEach(s => { if (s.id === stepId) { s.status = 'error'; s.error = error; } });
    }),
    markNextStepRunning: vi.fn((pipeline: PipelineDefinition, stepId: string) => {
      const idx = pipeline.steps.findIndex(s => s.id === stepId);
      if (idx >= 0) pipeline.steps[idx].status = 'done';
      if (idx >= 0 && idx < pipeline.steps.length - 1) pipeline.steps[idx + 1].status = 'running';
      return pipeline;
    }),
  };
}

/**
 * Mock for '@/entrypoints/sidepanel/composables/usePipeline' module.
 */
export function createUsePipelineMock(state: PipelineMockState) {
  const pipeline = { value: null as PipelineDefinition | null };

  return {
    usePipeline: vi.fn(() => ({
      pipeline,
      buildSummarizePipeline: vi.fn((_segments: { start: number; end: number }[]) => {
        pipeline.value = {
          workflow: state.defaultWorkflow,
          steps: state.defaultSteps.length > 0
            ? state.defaultSteps.map(s => ({ ...s }))
            : [
                { id: 'scrape', label: 'Scrape', status: 'pending' as const },
                { id: 'summarize', label: 'Summarize', status: 'pending' as const },
                { id: 'overall', label: 'Overall', status: 'pending' as const },
              ],
        };
      }),
      reconcile: vi.fn((_actualSegments: number) => {}),
      markFirstRunning: vi.fn(() => {}),
      markRunning: vi.fn((_id: string) => {}),
      markDone: vi.fn((_id: string) => {}),
      markNextRunning: vi.fn((_stepId: string) => null),
    })),
  };
}

// ── Convenience: Setup All Mocks ──────────────────────────────────────────────

/**
 * Setup all scraper and pipeline mocks at once.
 * Call this in a test file before importing the modules under test.
 */
export function setupScraperAndPipelineMocks(
  scraperState: Partial<ScraperMockState> = {},
  pipelineState: Partial<PipelineMockState> = {},
) {
  const sState = createScraperMockState(scraperState);
  const pState = createPipelineMockState(pipelineState);

  vi.mock('@/lib/scrapers/page-loader', () => createPageLoaderMock(sState));
  vi.mock('@/entrypoints/sidepanel/composables/useTopicScraper', () => createTopicScraperMock(sState));
  vi.mock('@/lib/pipeline-builder', () => createPipelineBuilderMock(pState));
  vi.mock('@/entrypoints/sidepanel/composables/usePipeline', () => createUsePipelineMock(pState));
}
