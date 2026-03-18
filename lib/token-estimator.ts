import type { ScrapedPost } from './types';

// Token estimation heuristic for mixed Vietnamese/English text
const TOKEN_RATIO = 3.5; // ~1 token per 3.5 chars for mixed content

// Model pricing (per 1M tokens) in USD
const PRICING_TABLE: Record<
  string,
  { inputPrice: number; outputPrice: number; contextLimit: number }
> = {
  // OpenAI models
  'gpt-4o': { inputPrice: 2.5, outputPrice: 10, contextLimit: 128000 },
  'gpt-4o-mini': { inputPrice: 0.15, outputPrice: 0.6, contextLimit: 128000 },
  'gpt-4-turbo': { inputPrice: 10, outputPrice: 30, contextLimit: 128000 },
  'gpt-3.5-turbo': { inputPrice: 0.5, outputPrice: 1.5, contextLimit: 16000 },
  // Claude models
  'claude-opus-4-6': { inputPrice: 15, outputPrice: 75, contextLimit: 200000 },
  'claude-sonnet-4-6': { inputPrice: 3, outputPrice: 15, contextLimit: 200000 },
  'claude-haiku-4-5-20251001': { inputPrice: 0.8, outputPrice: 4, contextLimit: 200000 },
};

/**
 * Estimate tokens for text using heuristic
 * @param text The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_RATIO);
}

/**
 * Get context limit for a model
 * @param model Model name
 * @returns Context limit in tokens, or default 128000 if unknown
 */
export function getContextLimit(model: string): number {
  return PRICING_TABLE[model]?.contextLimit ?? 128000;
}

/**
 * Estimate cost for a given token count
 * @param inputTokens Estimated input tokens
 * @param outputTokens Estimated output tokens
 * @param model Model name
 * @returns Cost estimates { input, output, total } in USD
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
): { input: number; output: number; total: number } {
  const pricing = PRICING_TABLE[model];
  if (!pricing) {
    // Default estimate for unknown models
    return {
      input: (inputTokens * 5) / 1000000, // assume $5 per 1M input tokens
      output: (outputTokens * 15) / 1000000,
      total: ((inputTokens * 5 + outputTokens * 15) / 1000000),
    };
  }

  const inputCost = (inputTokens * pricing.inputPrice) / 1000000;
  const outputCost = (outputTokens * pricing.outputPrice) / 1000000;

  return {
    input: inputCost,
    output: outputCost,
    total: inputCost + outputCost,
  };
}

/**
 * Check if posts will exceed context limit and calculate chunking needs
 * @param posts posts to analyze
 * @param model model name
 * @param systemPromptLength length of system prompt
 * @param responseBuffer buffer for response (default 2000 tokens)
 * @returns { exceeds, estimatedTokens, contextLimit, chunksNeeded }
 */
export function willExceedContext(
  posts: ScrapedPost[],
  model: string,
  systemPromptLength: number = 500,
  responseBuffer: number = 2000,
): {
  exceeds: boolean;
  estimatedTokens: number;
  contextLimit: number;
  chunksNeeded: number;
} {
  const contextLimit = getContextLimit(model);

  // Calculate used tokens: system + posts + response buffer
  const postsText = posts
    .map((p) => `[${p.author}] (#${p.postNumber}):\n${p.content}`)
    .join('\n\n---\n\n');
  const contentTokens = estimateTokens(postsText) + systemPromptLength;
  const estimatedTokens = contentTokens + responseBuffer;

  const usableTokensPerChunk = contextLimit - responseBuffer - systemPromptLength;
  const chunksNeeded = Math.ceil(contentTokens / usableTokensPerChunk);

  return {
    exceeds: estimatedTokens > contextLimit,
    estimatedTokens,
    contextLimit,
    chunksNeeded,
  };
}

/**
 * Format token count for display
 * @param tokens token count
 * @returns formatted string like "15,000 tokens"
 */
export function formatTokenCount(tokens: number): string {
  return `${tokens.toLocaleString()} tokens`;
}

/**
 * Format cost for display
 * @param cost cost in USD
 * @returns formatted string like "$0.02"
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}
