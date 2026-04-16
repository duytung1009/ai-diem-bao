/**
 * LLM Cost Estimation utilities — warn users before running expensive multi-call operations.
 */

/**
 * Estimate the number of API calls for auto-summarize-all.
 * @param totalPages - total topic pages
 * @param budgetTokens - token budget per segment (from calculateSegmentBudget)
 * @param avgTokensPerPage - estimated tokens per page (default 3000, conservative)
 */
export function estimateAutoSummarizeCalls(
  totalPages: number,
  budgetTokens: number,
  avgTokensPerPage = 3000,
): number {
  const pagesPerSegment = Math.max(1, Math.floor(budgetTokens / avgTokensPerPage));
  const segmentCount = Math.ceil(totalPages / pagesPerSegment);
  // Tree-reduce: ceil(log2(segmentCount)) levels
  const reduceCalls = segmentCount > 1 ? Math.ceil(Math.log2(segmentCount)) : 0;
  return segmentCount + reduceCalls;
}

/**
 * Estimate the number of API calls for knowledge extraction.
 * @param chunkCount - number of chunks (from planKnowledgeChunks().length)
 */
export function estimateExtractCalls(chunkCount: number): number {
  return chunkCount + (chunkCount > 1 ? 1 : 0); // chunks + 1 reduce
}

/**
 * Estimate the number of API calls for summarizing a single segment via map-reduce.
 * @param chunksNeeded - number of chunks (from willExceedContext().chunksNeeded)
 */
export function estimateSummarizeSegmentCalls(chunksNeeded: number): number {
  return chunksNeeded + (chunksNeeded > 1 ? 1 : 0); // chunks + 1 reduce
}
