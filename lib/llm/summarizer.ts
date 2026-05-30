import type { ScrapedPost, LLMConfig, CustomPrompts, SummaryJSON, LLMProgressCallback, KnowledgeEntry, ThreadAnalysisJSON, KnowledgePromptParts, SummaryPromptParts } from '../types';
import { createProvider } from './factory';
import {
  RESEARCH_PROMPT,
  buildSummaryPrompt,
  buildKnowledgePrompt,
  THREAD_ANALYSIS_PROMPT,
} from '../prompts';
import { estimateTokens, getContextLimit, willExceedContext, calculateSegmentBudget, getThinkingOverhead } from '../token-estimator';
import { MAP_REDUCE_CHUNK_DELAY_MS, RESPONSE_BUFFER_TOKENS, CONTEXT_USAGE_RATIO, KNOWLEDGE_MAX_CHUNK_BUDGET } from '../constants';
import { LLMError, LLMErrorCode } from '../errors';

// Pre-computed prompt token count (module-level, computed once)
export const KNOWLEDGE_CHUNK_PROMPT_TOKENS = estimateTokens(buildKnowledgePrompt('chunk', {}, 20));

/**
 * Conservative token estimate per knowledge entry in JSON output.
 * Includes title + content + tags + category + source (author, postNumber, timestamp) + structural overhead.
 * Empirically ~400-600 tokens per entry in practice; 500 as a safe mid-point.
 * Must match the divisor used in computeKnowledgeEntryCap.
 */
const TOKENS_PER_KNOWLEDGE_ENTRY_JSON = 500;

/** Resolve custom knowledge parts for a specific mode from CustomPrompts.
 * Handles both legacy string (ignored) and new KnowledgePromptSections object.
 */
function resolveKnowledgeParts(
  customPrompts: CustomPrompts | undefined,
  mode: 'extract' | 'chunk' | 'reduce',
): KnowledgePromptParts | undefined {
  const kp = customPrompts?.knowledge;
  if (!kp || typeof kp === 'string') return undefined;
  return kp[mode];
}

/** Resolve custom summary parts for a specific mode from CustomPrompts.
 * Handles both legacy string (used as-is for backward compat) and new SummaryPromptSections object.
 */
function resolveSummaryParts(
  customPrompts: CustomPrompts | undefined,
  mode: 'direct' | 'map' | 'reduce',
): { isLegacy: boolean; parts?: SummaryPromptParts; legacyString?: string } {
  const sp = customPrompts?.summary;
  if (!sp) return { isLegacy: false };
  if (typeof sp === 'string') return { isLegacy: true, legacyString: sp };
  return { isLegacy: false, parts: sp[mode] };
}

/** Compute word cap for reduce summary prompt based on maxTokens.
 * Vietnamese JSON output ≈ 1.4 tokens/word (text + JSON structure overhead).
 * Clamped to [100, 500].
 */
function computeReduceWordCap(maxTokens: number | undefined): number {
  return Math.max(100, Math.min(500, Math.floor((maxTokens ?? 2000) / 1.4)));
}

/** Compute entry cap for knowledge extract/chunk prompts based on maxTokens.
 *  Each knowledge entry ≈ 500 tokens in JSON (title + content + tags + source + overhead).
 *  Applies 0.6 safety margin to avoid hitting max_tokens ceiling (JSON overhead + verbose entries + thinking tokens).
 *  Clamped to [5, 50].
 */
function computeKnowledgeEntryCap(maxTokens: number | undefined): number {
  const effectiveTokens = Math.floor((maxTokens ?? 2000) * 0.6);
  return Math.max(5, Math.min(50, Math.floor(effectiveTokens / TOKENS_PER_KNOWLEDGE_ENTRY_JSON)));
}

/**
 * Repair common LLM JSON string value errors:
 * 1. Unescaped double quotes: "description": "mục đích "cắm" tài sản"
 * 2. Raw control characters inside string values (newline, carriage return) instead
 *    of their JSON escape sequences (\n, \r). LLMs often output multi-paragraph text
 *    with literal newlines, which JSON.parse rejects as "Bad control character".
 *
 * State-machine approach: track whether we are inside a JSON string, then:
 * - Escape raw \n/\r to \\n/\\r
 * - A " is treated as closing only if followed by , } ] : or whitespace+EOF
 */
function repairUnescapedQuotes(text: string): string {
  const out: string[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (ch !== '"') {
      out.push(ch);
      i++;
      continue;
    }

    // Opening quote of a JSON string value or key
    out.push('"');
    i++;

    // Scan inside the string until we find the closing quote
    while (i < len) {
      const c = text[i];

      if (c === '\\') {
        i++;
        if (i < len) {
          const next = text[i];
          if ('"\\/bfnrtu'.includes(next)) {
            out.push('\\', next);
          } else {
            out.push('\\\\', next);
          }
          i++;
        } else {
          out.push('\\\\');
        }
        continue;
      }

      if (c === '"') {
        // Peek ahead (skip all JSON whitespace: space, tab, newline, CR)
        // to decide if this closes the string
        let j = i + 1;
        while (j < len && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n' || text[j] === '\r')) j++;
        const next = text[j] ?? '';
        if (next === ',' || next === '}' || next === ']' || next === ':' || next === '') {
          // Closing quote
          out.push('"');
          i++;
          break;
        } else {
          // Unescaped quote inside the string — escape it
          out.push('\\"');
          i++;
          continue;
        }
      }

      // Raw control characters inside string values — must be escaped for valid JSON
      if (c === '\n') { out.push('\\n'); i++; continue; }
      if (c === '\r') { out.push('\\r'); i++; continue; }
      if (c === '\t') { out.push('\\t'); i++; continue; }

      out.push(c);
      i++;
    }
  }

  return out.join('');
}

/**
 * Try to parse LLM output as SummaryJSON.
 * Handles: plain JSON, triple-backtick fences (```json...```), single-backtick wrapping (`...`).
 * Fallback: repairs unescaped quotes inside string values (common LLM mistake).
 * Returns null if output is not valid JSON or missing required fields.
 */
export function parseSummaryJSON(raw: string): SummaryJSON | null {
  let text = raw.trim();
  // Strip triple-backtick code fences: ```json\n{...}\n```
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/s);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  } else {
    // Strip single-backtick wrapping: `{...}`
    const singleBacktickMatch = text.match(/^`([\s\S]*?)`$/s);
    if (singleBacktickMatch) text = singleBacktickMatch[1].trim();
  }
  // Normalize non-standard whitespace (e.g. NBSP \u00A0) to regular space.
  text = text.replace(/\u00A0/g, ' ');
  // Fix broken Unicode escape sequences where \u is not followed by 4 hex digits
  // (e.g. \usage, \update, \user in forum text — JSON.parse treats \u as escape prefix)
  text = text.replace(/\\u(?![0-9a-fA-F]{4})/g, 'u');
  // Sanitize other invalid JSON escape sequences (e.g. \N, \T, \o produced by LLMs)
  // Escape the backslash instead of dropping it, to preserve literal backslashes in data
  text = text.replace(/\\([^"\\\/bfnrtu0-9])/g, '\\\\$1');

  const isValidSummaryJSON = (parsed: unknown): parsed is SummaryJSON => {
    const obj = parsed as SummaryJSON;
    return (
      typeof obj?.summary === 'string' &&
      Array.isArray(obj?.opinions) &&
      obj.opinions.every(
        op => typeof op?.title === 'string' && Array.isArray(op?.supporters) && Array.isArray(op?.quotes),
      ) &&
      typeof obj?.conclusion === 'string'
    );
  };

  try {
    const parsed = JSON.parse(text);
    return isValidSummaryJSON(parsed) ? parsed : null;
  } catch (firstErr) {
    // Fallback: try repairing unescaped quotes inside string values
    try {
      const repaired = repairUnescapedQuotes(text);
      const parsed = JSON.parse(repaired);
      return isValidSummaryJSON(parsed) ? parsed : null;
    } catch (secondErr) {
      console.warn('[parseSummaryJSON] Parse failed:', {
        firstError: (firstErr as Error).message,
        secondError: (secondErr as Error).message,
        textLen: text.length,
        textStart: text.slice(0, 120),
        textEnd: text.slice(-120),
      });
      return null;
    }
  }
}

export async function summarizeTopic(
  posts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  customPrompts?: CustomPrompts,
  signal?: AbortSignal,
): Promise<string> {
  const provider = createProvider(config);

  // Resolve system prompt: legacy string → use as-is; new sections → build
  const directResolve = resolveSummaryParts(customPrompts, 'direct');
  const systemPrompt = directResolve.isLegacy
    ? directResolve.legacyString!
    : buildSummaryPrompt('direct', directResolve.parts, 500);

  // Check if topic will fit in context
  const responseBuffer = Math.max(2000, config.maxTokens ?? 0);
  const thinkingOverhead = getThinkingOverhead(config.model, config.thinkingEnabled, config.thinkingBudget);
  const contextCheck = willExceedContext(posts, config.model, estimateTokens(systemPrompt), responseBuffer, config.contextWindow, thinkingOverhead);
  if (contextCheck.exceeds && contextCheck.chunksNeeded > 1) {
    // Use map-reduce for large topics
    const total = contextCheck.chunksNeeded + 1; // +1 for reduce step
    onProgress?.(`Đang tóm tắt phần 1/${contextCheck.chunksNeeded}...`, 1, total);

    const mapResolve = resolveSummaryParts(customPrompts, 'map');
    const mapPrompt = mapResolve.isLegacy
      ? mapResolve.legacyString!
      : buildSummaryPrompt('map', mapResolve.parts, 300);
    const reduceResolve = resolveSummaryParts(customPrompts, 'reduce');
    const reducePrompt = reduceResolve.isLegacy
      ? reduceResolve.legacyString!
      : buildSummaryPrompt('reduce', reduceResolve.parts, 500);

    const rawResult = await summarizeWithMapReduce(
      posts,
      config,
      onProgress,
      contextCheck.chunksNeeded,
      mapPrompt,
      reducePrompt,
      signal,
    );
    const json = parseSummaryJSON(rawResult);
    return json ? JSON.stringify(json) : rawResult;
  }

  // Direct summarization for small topics
  const response = await provider.summarize(posts, systemPrompt, signal, { schemaName: 'summary' });
  const json = parseSummaryJSON(response.content);
  return json ? JSON.stringify(json) : response.content;
}

export async function researchTopic(
  posts: ScrapedPost[],
  question: string,
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  customPrompts?: CustomPrompts,
  signal?: AbortSignal,
): Promise<string> {
  const provider = createProvider(config);
  const systemPrompt = customPrompts?.research || RESEARCH_PROMPT;

  // Inject the question at the end of the user turn
  const questionPost: ScrapedPost = {
    author: 'USER_QUESTION',
    content: `\n---\n**Câu hỏi:** ${question}`,
    timestamp: '',
    postNumber: 0,
  };

  const allPosts = [...posts, questionPost];

  // Check if needs chunking
  const responseBuffer = Math.max(2000, config.maxTokens ?? 0);
  const thinkingOverhead = getThinkingOverhead(config.model, config.thinkingEnabled, config.thinkingBudget);
  const contextCheck = willExceedContext(allPosts, config.model, estimateTokens(systemPrompt), responseBuffer, config.contextWindow, thinkingOverhead);
  if (contextCheck.exceeds && contextCheck.chunksNeeded > 1) {
    onProgress?.(`Đang tra cứu (${contextCheck.chunksNeeded} phần)...`);
    // Map-reduce: summarize chunks preserving citation info, then answer at reduce
    const mapResult = await summaryChunks(posts, config, onProgress, contextCheck.chunksNeeded, undefined, undefined, signal);
    const condensedPosts: ScrapedPost[] = [
      { author: 'CONTEXT', content: mapResult, timestamp: '', postNumber: 0 },
      questionPost,
    ] as ScrapedPost[];
    const response = await provider.summarize(condensedPosts, systemPrompt, signal, { jsonMode: false });
    return response.content;
  }

  const response = await provider.summarize(allPosts, systemPrompt, signal, { jsonMode: false });
  return response.content;
}

/**
 * Knowledge extraction from posts. When mode='extract' uses the full-thread prompt;
 * when mode='chunk' uses the chunk-specific prompt (be extra detailed, this is a segment).
 * Chunking + reduce is handled at the composable/orchestration layer.
 */
export async function extractKnowledgeChunk(
  chunkPosts: ScrapedPost[],
  title: string,
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  customPrompts?: CustomPrompts,
  signal?: AbortSignal,
  mode: 'extract' | 'chunk' = 'chunk',
): Promise<string> {
  const effectiveConfig = { ...config, maxTokens: config.knowledgeMaxTokens ?? config.maxTokens };
  const provider = createProvider(effectiveConfig);
  const entryCap = computeKnowledgeEntryCap(effectiveConfig.maxTokens);
  const parts = resolveKnowledgeParts(customPrompts, mode);
  const systemPrompt = buildKnowledgePrompt(mode, parts, entryCap);

  const topicContextPost: ScrapedPost = {
    author: 'CONTEXT',
    content: `Topic: ${title}`,
    timestamp: '',
    postNumber: 0,
  };

  onProgress?.('Đang trích xuất kiến thức...');
  const response = await provider.summarize([topicContextPost, ...chunkPosts], systemPrompt, signal, { schemaName: 'knowledge' });
  return response.content;
}

/**
 * Reduce phase: merge multiple sets of partial knowledge entries into a final list.
 * partialEntries[i] = parsed entries from chunk i.
 */
export async function reduceKnowledgeChunks(
  partialEntries: KnowledgeEntry[][],
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  signal?: AbortSignal,
  customPrompts?: CustomPrompts,
  entryCap?: number,
): Promise<string> {
  onProgress?.('Đang gộp kiến thức...');

  const cap = entryCap ?? 20;
  const parts = resolveKnowledgeParts(customPrompts, 'reduce');
  const systemPrompt = buildKnowledgePrompt('reduce', parts, cap);

  const combinedText = partialEntries
    .map((entries, i) => `--- Phần ${i + 1} ---\n${JSON.stringify(entries)}`)
    .join('\n\n');

  // Clamp max_tokens so prompt_tokens + max_tokens <= context_window.
  // Use chars/3 as a deliberate upper-bound for prompt token count (overestimates),
  // so the clamp is always conservative — no overflow, may just cap output slightly.
  const requestedMaxTokens = config.knowledgeMaxTokens ?? config.maxTokens ?? 4096;
  const contextLimit = getContextLimit(config.model, config.contextWindow);
  const promptTokensUpperBound = Math.ceil((systemPrompt.length + combinedText.length) / 3) + RESPONSE_BUFFER_TOKENS;

  // Estimate tokens required for the output entries (cap * 700 tokens per entry),
  // using the user-configured knowledgeMaxTokens as the upper ceiling.
  // Don't clamp to getModelMaxOutput() — that returns 4096 for unknown models,
  // which would override the user's explicit knowledgeMaxTokens setting.
  const expectedOutputTokens = Math.max(requestedMaxTokens, cap * 700);

  const safeMaxTokens = Math.max(512, Math.min(expectedOutputTokens, contextLimit - promptTokensUpperBound));
  const effectiveConfig = { ...config, maxTokens: safeMaxTokens };
  const provider = createProvider(effectiveConfig);

  const combinedPost: ScrapedPost = {
    author: 'PARTIAL_ENTRIES',
    content: combinedText,
    timestamp: '',
    postNumber: 0,
  };

  const response = await provider.summarize([combinedPost], systemPrompt, signal, { schemaName: 'knowledge' });
  return response.content;
}

/**
 * Plan knowledge chunk boundaries for a set of posts.
 * Returns array of { startIndex, endIndex } (indices into posts array).
 * Uses KNOWLEDGE_CHUNK_PROMPT token budget to determine chunk sizes.
 */
export function planKnowledgeChunks(
  posts: ScrapedPost[],
  model?: string,
  contextWindowOverride?: number,
  maxTokens?: number,
  thinkingEnabled?: boolean,
  thinkingBudget?: number,
): { startIndex: number; endIndex: number }[] {
  const estimatedResponse = computeKnowledgeEntryCap(maxTokens) * TOKENS_PER_KNOWLEDGE_ENTRY_JSON;
  const responseBuffer = Math.max(RESPONSE_BUFFER_TOKENS, estimatedResponse);
  const thinkingOverhead = getThinkingOverhead(model, thinkingEnabled, thinkingBudget);
  let budget = calculateSegmentBudget(model, KNOWLEDGE_CHUNK_PROMPT_TOKENS, responseBuffer, contextWindowOverride, thinkingOverhead);
  budget = Math.min(budget, KNOWLEDGE_MAX_CHUNK_BUDGET);

  const chunks: { startIndex: number; endIndex: number }[] = [];
  let chunkStart = 0;
  let chunkTokens = 0;

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const postTokens = estimateTokens(`[${post.author}] (#${post.postNumber}):\n${post.content}`);

    if (chunkTokens + postTokens > budget && chunkTokens > 0) {
      // Current post would exceed budget — close current chunk and start new one
      chunks.push({ startIndex: chunkStart, endIndex: i - 1 });
      chunkStart = i;
      chunkTokens = postTokens;
    } else {
      // Single post > budget: force it into its own chunk (edge case)
      if (postTokens > budget && chunkTokens === 0) {
        console.warn(`[planKnowledgeChunks] Post #${post.postNumber} exceeds budget (${postTokens} > ${budget} tokens)`);
      }
      chunkTokens += postTokens;
    }
  }

  // Last chunk
  if (posts.length > 0) {
    chunks.push({ startIndex: chunkStart, endIndex: posts.length - 1 });
  }

  return chunks;
}

export async function testLLMConnection(config: LLMConfig): Promise<{ ok: boolean; error?: string }> {
  const provider = createProvider(config);
  return provider.testConnection();
}

export function parseThreadAnalysisJSON(raw: string): ThreadAnalysisJSON | null {
  let text = raw.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/s);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  } else {
    const singleBacktickMatch = text.match(/^`([\s\S]*?)`$/s);
    if (singleBacktickMatch) text = singleBacktickMatch[1].trim();
  }
  text = text.replace(/\u00A0/g, ' ');
  text = text.replace(/\\([^"\\\/bfnrtu0-9])/g, '\\\\$1');

  const isValid = (parsed: unknown): parsed is ThreadAnalysisJSON => {
    const p = parsed as ThreadAnalysisJSON;
    return (
      p !== null &&
      typeof p === 'object' &&
      typeof p.overview?.coreConflict === 'string' &&
      Array.isArray(p.userProfiles) &&
      Array.isArray(p.debateStreams) &&
      Array.isArray(p.combats) &&
      Array.isArray(p.timeline) &&
      Array.isArray(p.notableComments) &&
      typeof p.conclusion?.finalNote === 'string' &&
      typeof p.wuxia === 'string'
    );
  };

  try {
    const parsed = JSON.parse(text);
    return isValid(parsed) ? parsed : null;
  } catch {
    try {
      const repaired = repairUnescapedQuotes(text);
      const parsed = JSON.parse(repaired);
      return isValid(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export async function generateThreadAnalysis(
  summaryJson: SummaryJSON,
  meta: { title: string; totalPages: number; totalPosts: number },
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  customPrompts?: CustomPrompts,
  signal?: AbortSignal,
): Promise<ThreadAnalysisJSON> {
  const provider = createProvider(config);
  const systemPrompt = customPrompts?.threadAnalysis || THREAD_ANALYSIS_PROMPT;

  onProgress?.('Đang phân tích thread...');

  const inputPost: ScrapedPost = {
    author: 'INPUT',
    content: `Tiêu đề thread: ${meta.title}\nSố trang: ${meta.totalPages}\nSố bài viết: ${meta.totalPosts}\n\nBản tóm tắt JSON:\n${JSON.stringify(summaryJson)}`,
    timestamp: '',
    postNumber: 0,
  };

  const response = await provider.summarize([inputPost], systemPrompt, signal, { schemaName: 'analysis' });
  const result = parseThreadAnalysisJSON(response.content);
  if (!result) {
    throw new Error('Không thể parse kết quả phân tích thread. LLM trả về dữ liệu không hợp lệ.');
  }
  return result;
}

/**
 * Split posts into chunks that fit within context limit
 */
function chunkPosts(
  posts: ScrapedPost[],
  model: string,
  mapPrompt: string,
  suggestedChunks?: number,
  contextWindowOverride?: number,
  maxTokensReserve?: number,
  thinkingOverhead: number = 0,
): ScrapedPost[][] {
  const contextLimit = getContextLimit(model, contextWindowOverride);
  const bufferTokens = estimateTokens(mapPrompt) + Math.max(RESPONSE_BUFFER_TOKENS, maxTokensReserve ?? 0) + thinkingOverhead;

  // If suggestedChunks is provided, size chunks to fill ~N buckets rather than
  // greedily filling and then merging (which can produce oversized chunks).
  let maxTokensPerChunk: number;
  if (suggestedChunks && suggestedChunks > 0) {
    const totalPostTokens = posts.reduce(
      (sum, p) => sum + estimateTokens(`[${p.author}] (#${p.postNumber}):\n${p.content}`),
      0,
    );
    const targetPerChunk = Math.ceil(totalPostTokens / suggestedChunks);
    // Clamp to usable context so we never produce a chunk larger than context
    maxTokensPerChunk = Math.min(targetPerChunk, contextLimit - bufferTokens);
  } else {
    maxTokensPerChunk = contextLimit - bufferTokens;
  }

  const chunks: ScrapedPost[][] = [];
  let currentChunk: ScrapedPost[] = [];
  let currentTokens = 0;

  for (const post of posts) {
    const postTokens = estimateTokens(`[${post.author}] (#${post.postNumber}):\n${post.content}`);

    // If adding this post would exceed limit and chunk is not empty, start a new chunk
    if (currentTokens + postTokens > maxTokensPerChunk && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [post];
      currentTokens = postTokens;
    } else {
      currentChunk.push(post);
      currentTokens += postTokens;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Map phase: summarize each chunk
 */
async function summaryChunks(
  posts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  suggestedChunks?: number,
  mapPrompt?: string,
  reducePrompt?: string,
  signal?: AbortSignal,
): Promise<string> {
  const provider = createProvider(config);
  const wordCap = Math.max(100, Math.min(300, Math.floor((config.maxTokens ?? 2000) / 1.4)));
  const resolvedMapPrompt = mapPrompt ?? buildSummaryPrompt('map', {}, wordCap);
  const resolvedReducePrompt = reducePrompt ?? buildSummaryPrompt('reduce', {}, computeReduceWordCap(config.maxTokens));
  const thinkingOverhead = getThinkingOverhead(config.model, config.thinkingEnabled, config.thinkingBudget);
  const chunks = chunkPosts(posts, config.model, resolvedMapPrompt, suggestedChunks, config.contextWindow, config.maxTokens, thinkingOverhead);

  if (chunks.length === 1) {
    // No chunking needed
    const response = await provider.summarize(chunks[0], resolvedMapPrompt, signal, { schemaName: 'summary' });
    return response.content;
  }

  const total = chunks.length + 1; // +1 for reduce step

  // Map phase: summarize each chunk sequentially (to avoid rate limits)
  const partialSummaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Đang tóm tắt phần ${i + 1}/${chunks.length}...`, i + 1, total);
    const response = await provider.summarize(chunks[i], resolvedMapPrompt, signal, { schemaName: 'summary' });
    partialSummaries.push(response.content);

    // Small delay between requests to avoid rate limiting
    if (i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, MAP_REDUCE_CHUNK_DELAY_MS));
    }
  }

  // Reduce phase: combine partial summaries
  onProgress?.(`Đang gộp các tóm tắt...`, chunks.length + 1, total);
  const combinedText = partialSummaries
    .map((summary, i) => `--- Phần ${i + 1} ---\n${summary}`)
    .join('\n\n');

  // Recursive reduce: if combinedText itself would exceed context, reduce in stages
  const responseBuffer = Math.max(2000, config.maxTokens ?? 0);
  const combinedTokens = estimateTokens(combinedText) + estimateTokens(resolvedReducePrompt) + responseBuffer + thinkingOverhead;
  const contextLimit = getContextLimit(config.model, config.contextWindow);
  if (combinedTokens > contextLimit && partialSummaries.length > 2) {
    // Convert partials to fake posts and recurse
    const partialAsPosts: ScrapedPost[] = partialSummaries.map((s, i) => ({
      author: `PARTIAL_${i + 1}`,
      content: s,
      timestamp: '',
      postNumber: i + 1,
    } as ScrapedPost));
    onProgress?.(`Gộp đệ quy (${partialSummaries.length} phần)...`);
    return summaryChunks(partialAsPosts, config, onProgress, undefined, resolvedReducePrompt, resolvedReducePrompt, signal);
  }

  const reduceChunks: ScrapedPost[] = [
    {
      author: 'PARTIAL_SUMMARIES',
      content: combinedText,
      timestamp: '',
      postNumber: 0,
    } as ScrapedPost,
  ];

  const finalResponse = await provider.summarize(reduceChunks, resolvedReducePrompt, signal, { schemaName: 'summary' });
  return finalResponse.content;
}


/**
 * Build a cross-reference table of authors appearing in >=2 segments.
 * Returns a formatted string to prepend to the combined content, or '' if none.
 */
function buildAuthorCrossReference(segmentJsons: (SummaryJSON | null)[]): string {
  const authorMap = new Map<string, { segIdx: number; title: string; originalName: string }[]>();

  segmentJsons.forEach((json, i) => {
    if (!json?.opinions) return;
    for (const op of json.opinions) {
      if (!Array.isArray(op.supporters)) continue;
      for (const name of op.supporters) {
        const key = name.toLowerCase();
        if (!authorMap.has(key)) authorMap.set(key, []);
        authorMap.get(key)!.push({ segIdx: i + 1, title: op.title, originalName: name });
      }
    }
  });

  const crossSegmentAuthors = [...authorMap.entries()].filter(([, entries]) => {
    const segments = new Set(entries.map(e => e.segIdx));
    return segments.size >= 2;
  });

  if (crossSegmentAuthors.length === 0) return '';

  const lines = crossSegmentAuthors.map(([, entries]) => {
    const name = entries[0].originalName;
    const bySegment = entries.map(e => `Phần ${e.segIdx} ('${e.title}')`);
    return `- ${name}: ${bySegment.join(', ')}`;
  });

  return `=== TÁC GIẢ XUẤT HIỆN Ở NHIỀU PHẦN (cùng 1 người — chỉ đếm 1 lần) ===\n${lines.join('\n')}\n=== KẾT THÚC ===\n\n`;
}

/**
 * Post-process a SummaryJSON to remove duplicate supporters within each opinion (case-insensitive).
 * First occurrence wins (preserves original casing).
 */
export function deduplicateSupporters(json: SummaryJSON): SummaryJSON {
  return {
    ...json,
    opinions: json.opinions.map(op => {
      const seen = new Set<string>();
      const supporters = Array.isArray(op.supporters) ? op.supporters : [];
      const unique = supporters.filter(name => {
        const key = name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { ...op, supporters: unique };
    }),
  };
}

/**
 * Reduce a list of segment summary strings into one combined summary,
 * recursing as many times as needed until the combined input fits in context.
 *
 * Each recursion level reduces the number of summaries by factor `groupCount`;
 * total LLM calls ≈ O(N/k), total levels ≈ O(log_k N).
 *
 * **Note:** cross-reference authors are built local to each reduce call — with
 * tree-reduce across multiple levels, authors spanning different groups at the
 * same level may not be fully de-duplicated until the final merge call.
 */
async function reduceSegmentSummaries(
  summaries: string[],
  provider: ReturnType<typeof createProvider>,
  contextLimit: number,
  onProgress?: LLMProgressCallback,
  depth: number = 0,
  signal?: AbortSignal,
  maxTokens?: number,
  thinkingOverhead: number = 0,
): Promise<string> {
  // Fast path: nothing to reduce
  if (summaries.length === 1) return summaries[0];

  const reduceSummaryPrompt = buildSummaryPrompt('reduce', {}, computeReduceWordCap(maxTokens));

  // Helper: build combined content with cross-reference header for an LLM call
  function buildReduceContent(group: string[]): string {
    const parsed = group.map(s => parseSummaryJSON(s));
    const crossRef = buildAuthorCrossReference(parsed);
    const groupText = group.map((s, i) => `--- Phần ${i + 1} ---\n${s}`).join('\n\n');
    return crossRef + groupText;
  }

  // Usable content tokens per reduce call (prompt overhead + response buffer + safety margin).
  // Note: cross-reference header adds ~100-300 tokens per call but is covered by the 25% safety margin.
  const promptOverhead = estimateTokens(reduceSummaryPrompt) + Math.max(RESPONSE_BUFFER_TOKENS, maxTokens ?? 0) + thinkingOverhead;
  const usablePerGroup = Math.floor(contextLimit * CONTEXT_USAGE_RATIO) - promptOverhead;

  if (usablePerGroup < 1000) {
    throw new LLMError(
      LLMErrorCode.BAD_REQUEST,
      'Context window quá nhỏ để gộp tóm tắt. Cần ít nhất ~4000 tokens context window.',
    );
  }

  // Guard: individual summary larger than usable window — cannot reduce, fail early
  for (const s of summaries) {
    if (estimateTokens(s) > usablePerGroup) {
      throw new LLMError(
        LLMErrorCode.BAD_REQUEST,
        'Một phần tóm tắt segment quá lớn để xử lý. Hãy giảm kích thước segment hoặc tăng context window.',
      );
    }
  }

  // Cheap token estimate: sum of individual summaries (avoids building full content when splitting)
  const contentTokenSum = summaries.reduce((sum, s) => sum + estimateTokens(s), 0);

  if (contentTokenSum <= usablePerGroup) {
    // Fits in one call — base case
    const content = buildReduceContent(summaries);
    const label = depth === 0 ? 'Đang tạo tóm tắt tổng quan...' : `Đang gộp tóm tắt (lớp ${depth + 1})...`;
    onProgress?.(label);
    const post: ScrapedPost[] = [{ author: 'PARTIAL_SUMMARIES', content, timestamp: '', postNumber: 0 }];
    const response = await provider.summarize(post, reduceSummaryPrompt, signal, { schemaName: 'summary' });
    return response.content;
  }

  // Exceeds context — split into groups and recurse
  // groupCount based on content-only tokens vs usable window (overhead already subtracted)
  const groupCount = Math.max(2, Math.ceil(contentTokenSum / usablePerGroup));
  const groupSize = Math.ceil(summaries.length / groupCount);
  const groups: string[][] = [];
  for (let i = 0; i < summaries.length; i += groupSize) {
    groups.push(summaries.slice(i, i + groupSize));
  }

  const intermediates: string[] = [];
  for (let g = 0; g < groups.length; g++) {
    onProgress?.(`Đang gộp nhóm ${g + 1}/${groups.length} (lớp ${depth + 1})...`, g + 1, groups.length);
    const groupContent = buildReduceContent(groups[g]);
    const groupPost: ScrapedPost[] = [{ author: 'PARTIAL_SUMMARIES', content: groupContent, timestamp: '', postNumber: 0 }];
    const response = await provider.summarize(groupPost, reduceSummaryPrompt, signal, { schemaName: 'summary' });
    const json = parseSummaryJSON(response.content);
    intermediates.push(json ? JSON.stringify(json) : response.content);

    if (g < groups.length - 1) await new Promise(r => setTimeout(r, MAP_REDUCE_CHUNK_DELAY_MS));
  }

  return reduceSegmentSummaries(intermediates, provider, contextLimit, onProgress, depth + 1, signal, maxTokens, thinkingOverhead);
}

export async function summarizeSegments(
  segmentSummaries: string[],
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  signal?: AbortSignal,
): Promise<string> {
  const provider = createProvider(config);
  const contextLimit = getContextLimit(config.model, config.contextWindow);
  const thinkingOverhead = getThinkingOverhead(config.model, config.thinkingEnabled, config.thinkingBudget);

  const resultText = await reduceSegmentSummaries(
    segmentSummaries, provider, contextLimit, onProgress, 0, signal, config.maxTokens, thinkingOverhead,
  );

  // Post-process: programmatic dedup of supporters (safety net)
  const json = parseSummaryJSON(resultText);
  if (json) {
    const deduped = deduplicateSupporters(json);
    return JSON.stringify(deduped);
  }
  return resultText;
}

/**
 * Map-reduce summarization for large topics
 */
async function summarizeWithMapReduce(
  posts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: (message: string, step?: number, totalSteps?: number) => void,
  suggestedChunks?: number,
  mapPrompt?: string,
  finalPrompt?: string,
  signal?: AbortSignal,
): Promise<string> {
  const combined = await summaryChunks(posts, config, onProgress, suggestedChunks, mapPrompt, finalPrompt, signal);
  return combined;
}
