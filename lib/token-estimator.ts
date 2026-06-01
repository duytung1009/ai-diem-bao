import type { ScrapedPost } from './types';
import { CONTEXT_USAGE_RATIO, RESPONSE_BUFFER_TOKENS } from './constants';

// Token estimation heuristic for mixed Vietnamese/English text
const TOKEN_RATIO = 3.5; // ~1 token per 3.5 chars for mixed content

interface ModelSpec {
  inputPrice: number;
  outputPrice: number;
  contextLimit: number;
  maxOutputTokens: number;
  thinkingBudget: number; // 0 = model doesn't support thinking
}

// Model pricing (per 1M tokens) in USD + output limits + thinking budget
const PRICING_TABLE: Record<string, ModelSpec> = {
  // ── OpenAI models ──────────────────────────────────────────────────────────
  // GPT-5.x flagship (as of May 2026)
  'gpt-5.5': { inputPrice: 5.00, outputPrice: 30.00, contextLimit: 1050000, maxOutputTokens: 131072, thinkingBudget: 0 },
  'gpt-5.4': { inputPrice: 2.50, outputPrice: 15.00, contextLimit: 1000000, maxOutputTokens: 131072, thinkingBudget: 0 },
  'gpt-5.4-mini': { inputPrice: 0.75, outputPrice: 4.50, contextLimit: 409600, maxOutputTokens: 131072, thinkingBudget: 0 },
  'gpt-5.4-nano': { inputPrice: 0.20, outputPrice: 1.25, contextLimit: 409600, maxOutputTokens: 131072, thinkingBudget: 0 },
  // GPT-4.1 family
  'gpt-4.1': { inputPrice: 2.00, outputPrice: 8.00, contextLimit: 1047576, maxOutputTokens: 32768, thinkingBudget: 0 },
  'gpt-4.1-mini': { inputPrice: 0.40, outputPrice: 1.60, contextLimit: 1047576, maxOutputTokens: 32768, thinkingBudget: 0 },
  'gpt-4.1-nano': { inputPrice: 0.10, outputPrice: 0.40, contextLimit: 1047576, maxOutputTokens: 32768, thinkingBudget: 0 },
  // GPT-4o family
  'gpt-4o': { inputPrice: 2.50, outputPrice: 10.00, contextLimit: 128000, maxOutputTokens: 16384, thinkingBudget: 0 },
  'gpt-4o-mini': { inputPrice: 0.15, outputPrice: 0.60, contextLimit: 128000, maxOutputTokens: 16384, thinkingBudget: 0 },
  // o-series reasoning models (thinking is internal, not a configurable budget)
  'o3': { inputPrice: 2.00, outputPrice: 8.00, contextLimit: 200000, maxOutputTokens: 100000, thinkingBudget: 0 },
  'o4-mini': { inputPrice: 1.10, outputPrice: 4.40, contextLimit: 200000, maxOutputTokens: 100000, thinkingBudget: 0 },

  // ── Anthropic Claude models ────────────────────────────────────────────────
  // Claude 4.x (context: 1M for Opus/Sonnet, 200k for Haiku)
  // Extended thinking: Opus 4.7=No (adaptive only), Sonnet 4.6=Yes, Haiku 4.5=Yes
  'claude-opus-4-7': { inputPrice: 5.00, outputPrice: 25.00, contextLimit: 1000000, maxOutputTokens: 131072, thinkingBudget: 0 },
  'claude-opus-4-6': { inputPrice: 5.00, outputPrice: 25.00, contextLimit: 1000000, maxOutputTokens: 131072, thinkingBudget: 0 },
  'claude-sonnet-4-6': { inputPrice: 3.00, outputPrice: 15.00, contextLimit: 1000000, maxOutputTokens: 65536, thinkingBudget: 32768 },
  'claude-haiku-4-5-20251001': { inputPrice: 1.00, outputPrice: 5.00, contextLimit: 200000, maxOutputTokens: 65536, thinkingBudget: 16000 },

  // ── Google Gemini models ───────────────────────────────────────────────────
  // Gemini 3.5 — most capable (as of May 2026)
  'gemini-3.5-flash': { inputPrice: 1.50, outputPrice: 9.00, contextLimit: 1048576, maxOutputTokens: 65536, thinkingBudget: 24576 },
  // Gemini 3.1 family
  'gemini-3.1-pro-preview': { inputPrice: 2.00, outputPrice: 12.00, contextLimit: 1048576, maxOutputTokens: 65536, thinkingBudget: 32768 },
  'gemini-3.1-flash-lite': { inputPrice: 0.25, outputPrice: 1.50, contextLimit: 1048576, maxOutputTokens: 65536, thinkingBudget: 0 },
  // Gemini 3.0 (preview)
  'gemini-3-flash-preview': { inputPrice: 0.50, outputPrice: 3.00, contextLimit: 1048576, maxOutputTokens: 65536, thinkingBudget: 24576 },
  // Gemini 2.5 family
  'gemini-2.5-pro': { inputPrice: 1.25, outputPrice: 10.00, contextLimit: 1048576, maxOutputTokens: 65536, thinkingBudget: 32768 },
  'gemini-2.5-flash': { inputPrice: 0.30, outputPrice: 2.50, contextLimit: 1048576, maxOutputTokens: 65536, thinkingBudget: 24576 },
  'gemini-2.5-flash-lite': { inputPrice: 0.10, outputPrice: 0.40, contextLimit: 1048576, maxOutputTokens: 65536, thinkingBudget: 0 },
  // ── DeepSeek models ────────────────────────────────────────────────
  // DeepSeek V4 family (1M context, supports thinking)
  'deepseek-v4-flash': { inputPrice: 0.14, outputPrice: 0.28, contextLimit: 1000000, maxOutputTokens: 393216, thinkingBudget: 0 },
  'deepseek-v4-pro': { inputPrice: 0.435, outputPrice: 0.87, contextLimit: 1000000, maxOutputTokens: 393216, thinkingBudget: 0 },

  // ── xAI Grok models ─────────────────────────────────────────────────
  'grok-4': { inputPrice: 2.50, outputPrice: 10.00, contextLimit: 1000000, maxOutputTokens: 131072, thinkingBudget: 0 },
  'grok-4-mini': { inputPrice: 0.50, outputPrice: 3.00, contextLimit: 1000000, maxOutputTokens: 131072, thinkingBudget: 0 },

  // Gemma models (free / open-weight via Gemini API)
  'gemma-4-26b-a4b-it': { inputPrice: 0, outputPrice: 0, contextLimit: 262144, maxOutputTokens: 8192, thinkingBudget: 0 },
  'gemma-4-31b-it': { inputPrice: 0, outputPrice: 0, contextLimit: 262144, maxOutputTokens: 8192, thinkingBudget: 0 },
  'gemma-3-27b-it': { inputPrice: 0, outputPrice: 0, contextLimit: 128000, maxOutputTokens: 8192, thinkingBudget: 0 },
  'gemma-3-12b-it': { inputPrice: 0, outputPrice: 0, contextLimit: 128000, maxOutputTokens: 8192, thinkingBudget: 0 },
  'gemma-3-4b-it': { inputPrice: 0, outputPrice: 0, contextLimit: 32768, maxOutputTokens: 8192, thinkingBudget: 0 },
  'gemma-3-1b-it': { inputPrice: 0, outputPrice: 0, contextLimit: 32768, maxOutputTokens: 8192, thinkingBudget: 0 },
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
 * Get context limit for a model.
 * If contextWindowOverride is provided (from user settings), it takes precedence.
 * Otherwise falls back to PRICING_TABLE lookup, then 128000 default.
 */
export function getContextLimit(model?: string, contextWindowOverride?: number): number {
  if (contextWindowOverride && contextWindowOverride > 0) return contextWindowOverride;
  return model ? PRICING_TABLE[model]?.contextLimit ?? 128000 : 128000;
}

/**
 * Get model's max output tokens (excluding thinking).
 * Returns from PRICING_TABLE, or 4096 default for unknown models.
 */
export function getModelMaxOutput(model?: string): number {
  return model ? PRICING_TABLE[model]?.maxOutputTokens ?? 4096 : 4096;
}

/**
 * Get model's thinking budget (0 = model doesn't support thinking).
 */
export function getModelThinkingBudget(model?: string): number {
  return model ? PRICING_TABLE[model]?.thinkingBudget ?? 0 : 0;
}

/**
 * Whether the model supports thinking (Gemini thinking models).
 */
export function modelSupportsThinking(model?: string): boolean {
  return (PRICING_TABLE[model ?? '']?.thinkingBudget ?? 0) > 0;
}

export function isModelInPricingTable(model?: string): boolean {
  return model ? model in PRICING_TABLE : false;
}

/**
 * Compute effective thinking overhead for context window calculations.
 * When thinking is enabled, thinking tokens consume both output budget and context window.
 *
 * @returns tokens to reserve for thinking (0 if thinking disabled or model doesn't support it)
 */
export function getThinkingOverhead(
  model?: string,
  thinkingEnabled?: boolean,
  thinkingBudget?: number,
): number {
  if (!model || thinkingEnabled === false) return 0;
  const modelMax = getModelThinkingBudget(model);
  if (modelMax === 0) return 0;
  if (thinkingBudget !== undefined && thinkingBudget >= 0) return Math.min(thinkingBudget, modelMax);
  return modelMax; // default to model's max thinking budget
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
  model: string | undefined = undefined,
  systemPromptLength: number = 500,
  responseBuffer: number = 2000,
  contextWindowOverride?: number,
  thinkingOverhead: number = 0,
): {
  exceeds: boolean;
  estimatedTokens: number;
  contextLimit: number;
  chunksNeeded: number;
} {
  const contextLimit = getContextLimit(model, contextWindowOverride);

  // Calculate used tokens: system + posts + response buffer + thinking overhead
  const postsText = posts
    .map((p) => `[${p.author}] (#${p.postNumber}):\n${p.content}`)
    .join('\n\n---\n\n');
  const contentTokens = estimateTokens(postsText) + systemPromptLength;
  const estimatedTokens = contentTokens + responseBuffer + thinkingOverhead;

  const usableTokensPerChunk = contextLimit - responseBuffer - systemPromptLength - thinkingOverhead;
  const chunksNeeded = Math.ceil(contentTokens / Math.max(usableTokensPerChunk, 4000));

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
 * Calculate token budget for each dynamic segment.
 * Budget = contextLimit * CONTEXT_USAGE_RATIO - systemPromptTokens - responseBuffer - thinkingOverhead
 *
 * systemPromptTokens MUST be calculated from the actual prompt text (default or custom from Settings).
 * Caller should call estimateTokens() on the prompt before passing here.
 * thinkingOverhead: tokens reserved for model thinking (0 for non-thinking models).
 */
export function calculateSegmentBudget(
  model: undefined | string = undefined,
  systemPromptTokens: number,
  responseBuffer?: number,
  contextWindowOverride?: number,
  thinkingOverhead: number = 0,
): number {
  const contextLimit = getContextLimit(model, contextWindowOverride);
  const usable = Math.floor(contextLimit * CONTEXT_USAGE_RATIO);
  const buffer = responseBuffer ?? RESPONSE_BUFFER_TOKENS;
  return Math.max(usable - systemPromptTokens - buffer - thinkingOverhead, 4000); // floor 4000 tokens
}

/**
 * Format cost for display
 * @param cost cost in USD
 * @returns formatted string like "$0.02"
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}
