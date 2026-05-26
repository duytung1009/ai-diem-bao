/**
 * LLM Cost Estimation utilities — warn users before running expensive multi-call operations.
 */

import type { CostEstimate } from '@/lib/types';
import { estimateCost, isModelInPricingTable } from '@/lib/token-estimator';

const MS_PER_CALL_BASE = 8000;
const MS_PER_1K_OUTPUT_TOKENS = 500;

function buildCostEstimate(
  apiCalls: number,
  inputTokens: number,
  outputTokens: number,
  model: string,
): CostEstimate {
  const estimatedMs = apiCalls * MS_PER_CALL_BASE + (outputTokens / 1000) * MS_PER_1K_OUTPUT_TOKENS;
  const costUsd = isModelInPricingTable(model)
    ? estimateCost(inputTokens, outputTokens, model).total
    : null;
  return { apiCalls, inputTokens, outputTokens, estimatedMs, costUsd, model };
}

/**
 * Estimate the number of API calls for auto-summarize-all.
 * @deprecated Use estimateAutoSummarizeCost() for full CostEstimate.
 */
export function estimateAutoSummarizeCalls(
  totalPages: number,
  budgetTokens: number,
  avgTokensPerPage = 3000,
): number {
  const pagesPerSegment = Math.max(1, Math.floor(budgetTokens / avgTokensPerPage));
  const segmentCount = Math.ceil(totalPages / pagesPerSegment);
  const reduceCalls = segmentCount > 1 ? Math.ceil(Math.log2(segmentCount)) : 0;
  return segmentCount + reduceCalls;
}

/** Full cost estimate for auto-summarize-all. */
export function estimateAutoSummarizeCost(
  totalPages: number,
  budgetTokens: number,
  model: string,
  maxOutputTokens: number,
  avgTokensPerPage = 3000,
): CostEstimate {
  const apiCalls = estimateAutoSummarizeCalls(totalPages, budgetTokens, avgTokensPerPage);
  const inputTokens = apiCalls * (avgTokensPerPage > 0 ? budgetTokens : 3000);
  const outputTokens = Math.round(apiCalls * maxOutputTokens * 0.6);
  return buildCostEstimate(apiCalls, inputTokens, outputTokens, model);
}

/**
 * Estimate the number of API calls for knowledge extraction.
 * @deprecated Use estimateExtractCost() for full CostEstimate.
 */
export function estimateExtractCalls(chunkCount: number): number {
  return chunkCount + (chunkCount > 1 ? 1 : 0);
}

/** Full cost estimate for knowledge extraction. */
export function estimateExtractCost(
  chunkCount: number,
  avgChunkTokens: number,
  model: string,
  maxOutputTokens: number,
): CostEstimate {
  const apiCalls = estimateExtractCalls(chunkCount);
  const inputTokens = apiCalls * avgChunkTokens;
  const outputTokens = Math.round(apiCalls * maxOutputTokens * 0.6);
  return buildCostEstimate(apiCalls, inputTokens, outputTokens, model);
}

/**
 * Estimate the number of API calls for summarizing a single segment via map-reduce.
 * @deprecated Use estimateSegmentSummarizeCost() for full CostEstimate.
 */
export function estimateSummarizeSegmentCalls(chunksNeeded: number): number {
  return chunksNeeded + (chunksNeeded > 1 ? 1 : 0);
}

/** Full cost estimate for segment summarization. */
export function estimateSegmentSummarizeCost(
  chunksNeeded: number,
  avgChunkTokens: number,
  model: string,
  maxOutputTokens: number,
): CostEstimate {
  const apiCalls = estimateSummarizeSegmentCalls(chunksNeeded);
  const inputTokens = apiCalls * avgChunkTokens;
  const outputTokens = Math.round(apiCalls * maxOutputTokens * 0.6);
  return buildCostEstimate(apiCalls, inputTokens, outputTokens, model);
}
