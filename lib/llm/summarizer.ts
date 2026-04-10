import type { ScrapedPost, LLMConfig, CustomPrompts, SummaryJSON, LLMProgressCallback } from '../types';
import { createProvider } from './factory';
import {
  SUMMARY_PROMPT,
  INCREMENTAL_UPDATE_PROMPT,
  OPINION_ANALYSIS_PROMPT,
  OPINION_CHUNK_PROMPT,
  CHUNK_SUMMARY_PROMPT,
  REDUCE_SUMMARY_PROMPT,
  RESEARCH_PROMPT,
  KNOWLEDGE_EXTRACT_PROMPT,
} from '../prompts';
import { estimateTokens, getContextLimit, willExceedContext } from '../token-estimator';
import { MAP_REDUCE_CHUNK_DELAY_MS, RESPONSE_BUFFER_TOKENS } from '../constants';

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
        // Valid escape sequence — copy both chars
        out.push(c);
        i++;
        if (i < len) { out.push(text[i]); i++; }
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
  // NBSP at structural positions (outside strings) causes JSON.parse to fail
  // since only \u0020, \t, \n, \r are valid JSON whitespace.
  text = text.replace(/\u00A0/g, ' ');
  // Sanitize invalid JSON escape sequences (e.g. \N, \T produced by LLMs)
  text = text.replace(/\\([^"\\\/bfnrtu])/g, (_, ch) => ch);

  const isValidSummaryJSON = (parsed: unknown): parsed is SummaryJSON =>
    typeof (parsed as SummaryJSON)?.summary === 'string' &&
    Array.isArray((parsed as SummaryJSON)?.opinions) &&
    typeof (parsed as SummaryJSON)?.conclusion === 'string';

  try {
    const parsed = JSON.parse(text);
    return isValidSummaryJSON(parsed) ? parsed : null;
  } catch {
    // Fallback: try repairing unescaped quotes inside string values
    try {
      const repaired = repairUnescapedQuotes(text);
      const parsed = JSON.parse(repaired);
      return isValidSummaryJSON(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export async function summarizeTopic(
  posts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  customPrompts?: CustomPrompts,
): Promise<string> {
  const provider = createProvider(config);
  const systemPrompt = customPrompts?.summary || SUMMARY_PROMPT;

  // Check if topic will fit in context
  const contextCheck = willExceedContext(posts, config.model, estimateTokens(systemPrompt), 2000, config.contextWindow);
  if (contextCheck.exceeds && contextCheck.chunksNeeded > 1) {
    // Use map-reduce for large topics
    const total = contextCheck.chunksNeeded + 1; // +1 for reduce step
    onProgress?.(`Đang tóm tắt phần 1/${contextCheck.chunksNeeded}...`, 1, total);
    const rawResult = await summarizeWithMapReduce(posts, config, onProgress, contextCheck.chunksNeeded, systemPrompt);
    const json = parseSummaryJSON(rawResult);
    return json ? JSON.stringify(json) : rawResult;
  }

  // Direct summarization for small topics
  const response = await provider.summarize(posts, systemPrompt);
  const json = parseSummaryJSON(response.content);
  return json ? JSON.stringify(json) : response.content;
}

export async function updateSummary(
  previousSummary: string,
  newPosts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  customPrompts?: CustomPrompts,
): Promise<string> {
  const provider = createProvider(config);
  const systemPrompt = INCREMENTAL_UPDATE_PROMPT;
  // Prepend the previous summary as a context post
  const postsWithContext: ScrapedPost[] = [
    {
      author: 'SYSTEM',
      content: `[BẢN TÓM TẮT CŨ]\n${previousSummary}`,
      timestamp: '',
      postNumber: 0,
    },
    ...newPosts,
  ];

  // Check if needs chunking
  const contextCheck = willExceedContext(postsWithContext, config.model, estimateTokens(systemPrompt), 2000, config.contextWindow);
  if (contextCheck.exceeds && contextCheck.chunksNeeded > 1) {
    onProgress?.(`Cập nhật tóm tắt (${contextCheck.chunksNeeded} phần)...`);
    const rawResult = await summarizeWithMapReduce(postsWithContext, config, onProgress, contextCheck.chunksNeeded, systemPrompt);
    const json = parseSummaryJSON(rawResult);
    return json ? JSON.stringify(json) : rawResult;
  }

  const response = await provider.summarize(postsWithContext, systemPrompt);
  const json = parseSummaryJSON(response.content);
  return json ? JSON.stringify(json) : response.content;
}

export async function analyzeOpinions(
  posts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  customPrompts?: CustomPrompts,
): Promise<string> {
  const provider = createProvider(config);
  const systemPrompt = customPrompts?.opinions || OPINION_ANALYSIS_PROMPT;

  // For opinion analysis, check if we need to chunk
  const contextCheck = willExceedContext(posts, config.model, estimateTokens(systemPrompt), 2000, config.contextWindow);
  if (contextCheck.exceeds && contextCheck.chunksNeeded > 1) {
    onProgress?.(`Phân tích ý kiến (${contextCheck.chunksNeeded} phần)...`);
    // Use map-reduce to extract opinions
    const mapResult = await summaryChunks(posts, config, onProgress, contextCheck.chunksNeeded, OPINION_CHUNK_PROMPT);
    // Then analyze the combined summary
    const opinionResponse = await provider.summarize(
      [{ author: 'CONTEXT', content: mapResult, timestamp: '', postNumber: 0 } as ScrapedPost],
      systemPrompt,
    );
    return opinionResponse.content;
  }

  const response = await provider.summarize(posts, systemPrompt);
  return response.content;
}

export async function researchTopic(
  posts: ScrapedPost[],
  question: string,
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  customPrompts?: CustomPrompts,
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
  const contextCheck = willExceedContext(allPosts, config.model, estimateTokens(systemPrompt), 2000, config.contextWindow);
  if (contextCheck.exceeds && contextCheck.chunksNeeded > 1) {
    onProgress?.(`Đang tra cứu (${contextCheck.chunksNeeded} phần)...`);
    // Map-reduce: summarize chunks preserving citation info, then answer at reduce
    const mapResult = await summaryChunks(posts, config, onProgress, contextCheck.chunksNeeded, CHUNK_SUMMARY_PROMPT);
    const condensedPosts: ScrapedPost[] = [
      { author: 'CONTEXT', content: mapResult, timestamp: '', postNumber: 0 },
      questionPost,
    ] as ScrapedPost[];
    const response = await provider.summarize(condensedPosts, systemPrompt);
    return response.content;
  }

  const response = await provider.summarize(allPosts, systemPrompt);
  return response.content;
}

export async function extractKnowledge(
  posts: ScrapedPost[],
  title: string,
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  customPrompts?: CustomPrompts,
): Promise<string> {
  const provider = createProvider(config);
  const systemPrompt = customPrompts?.knowledge || KNOWLEDGE_EXTRACT_PROMPT;

  // For V1: truncate posts to fit within context, keeping earlier posts
  const contextCheck = willExceedContext(posts, config.model, estimateTokens(systemPrompt), 2000, config.contextWindow);
  let postsToUse = posts;
  if (contextCheck.exceeds) {
    let tokenCount = 0;
    const contextLimit = getContextLimit(config.model, config.contextWindow);
    const budget = contextLimit - estimateTokens(systemPrompt) - 500;
    postsToUse = [];
    for (const post of posts) {
      const tokens = estimateTokens(`[${post.author}] (#${post.postNumber}):\n${post.content}`);
      if (tokenCount + tokens > budget) break;
      postsToUse.push(post);
      tokenCount += tokens;
    }
    onProgress?.(`Trích xuất kiến thức (${postsToUse.length}/${posts.length} bài viết)...`);
  } else {
    onProgress?.('Đang trích xuất kiến thức...');
  }

  const topicContextPost: ScrapedPost = {
    author: 'CONTEXT',
    content: `Topic: ${title}`,
    timestamp: '',
    postNumber: 0,
  };

  const response = await provider.summarize([topicContextPost, ...postsToUse], systemPrompt);
  return response.content;
}

export async function testLLMConnection(config: LLMConfig): Promise<boolean> {
  const provider = createProvider(config);
  return provider.testConnection();
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
): ScrapedPost[][] {
  const contextLimit = getContextLimit(model, contextWindowOverride);
  const bufferTokens = estimateTokens(mapPrompt) + RESPONSE_BUFFER_TOKENS;

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
  mapPrompt: string = CHUNK_SUMMARY_PROMPT,
  reducePrompt: string = REDUCE_SUMMARY_PROMPT,
): Promise<string> {
  const provider = createProvider(config);
  const chunks = chunkPosts(posts, config.model, mapPrompt, suggestedChunks, config.contextWindow);

  if (chunks.length === 1) {
    // No chunking needed
    const response = await provider.summarize(chunks[0], mapPrompt);
    return response.content;
  }

  const total = chunks.length + 1; // +1 for reduce step

  // Map phase: summarize each chunk sequentially (to avoid rate limits)
  const partialSummaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Đang tóm tắt phần ${i + 1}/${chunks.length}...`, i + 1, total);
    const response = await provider.summarize(chunks[i], mapPrompt);
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
  const combinedTokens = estimateTokens(combinedText) + estimateTokens(REDUCE_SUMMARY_PROMPT) + 2000;
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
    return summaryChunks(partialAsPosts, config, onProgress, undefined, reducePrompt, reducePrompt);
  }

  const reduceChunks: ScrapedPost[] = [
    {
      author: 'PARTIAL_SUMMARIES',
      content: combinedText,
      timestamp: '',
      postNumber: 0,
    } as ScrapedPost,
  ];

  const finalResponse = await provider.summarize(reduceChunks, reducePrompt);
  return finalResponse.content;
}

/**
 * Build a cross-reference table of authors appearing in ≥2 segments.
 * Returns a formatted string to prepend to the combined content, or '' if none.
 */
function buildAuthorCrossReference(segmentJsons: (SummaryJSON | null)[]): string {
  const authorMap = new Map<string, { segIdx: number; title: string; originalName: string }[]>();

  segmentJsons.forEach((json, i) => {
    if (!json?.opinions) return;
    for (const op of json.opinions) {
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
      const unique = op.supporters.filter(name => {
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
 * Merge multiple segment JSON summaries into one overall summary.
 * Uses REDUCE_SUMMARY_PROMPT which is designed to merge JSON chunks.
 */
export async function summarizeSegments(
  segmentSummaries: string[],
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
): Promise<string> {
  const provider = createProvider(config);

  // 1. Parse segment JSONs for cross-reference building
  const parsed = segmentSummaries.map(s => parseSummaryJSON(s));

  // 2. Build cross-reference (authors appearing in ≥2 segments)
  const crossRef = buildAuthorCrossReference(parsed);

  // 3. Build combined content (cross-reference prepended)
  const segmentText = segmentSummaries
    .map((s, i) => `--- Phần ${i + 1} ---\n${s}`)
    .join('\n\n');
  const combinedContent = crossRef + segmentText;

  // 4. Context check — recursive reduce if combined content exceeds context
  const inputTokens = estimateTokens(combinedContent) + estimateTokens(REDUCE_SUMMARY_PROMPT) + RESPONSE_BUFFER_TOKENS;
  const contextLimit = getContextLimit(config.model, config.contextWindow);

  let resultText: string;

  if (inputTokens > contextLimit && segmentSummaries.length > 2) {
    // Split into groups, reduce each group, then final reduce
    onProgress?.('Đang gộp tóm tắt (nhiều bước)...');
    const groupCount = Math.ceil(inputTokens / contextLimit);
    const groupSize = Math.ceil(segmentSummaries.length / groupCount);
    const groups: string[][] = [];
    for (let i = 0; i < segmentSummaries.length; i += groupSize) {
      groups.push(segmentSummaries.slice(i, i + groupSize));
    }

    const intermediateResults: string[] = [];
    for (let g = 0; g < groups.length; g++) {
      onProgress?.(`Đang gộp nhóm ${g + 1}/${groups.length}...`, g + 1, groups.length + 1);
      const groupParsed = groups[g].map(s => parseSummaryJSON(s));
      const groupCrossRef = buildAuthorCrossReference(groupParsed);
      const groupText = groups[g].map((s, i) => `--- Phần ${i + 1} ---\n${s}`).join('\n\n');
      const groupContent = groupCrossRef + groupText;

      const groupPost: ScrapedPost[] = [{ author: 'PARTIAL_SUMMARIES', content: groupContent, timestamp: '', postNumber: 0 }];
      const response = await provider.summarize(groupPost, REDUCE_SUMMARY_PROMPT);
      const json = parseSummaryJSON(response.content);
      intermediateResults.push(json ? JSON.stringify(json) : response.content);

      if (g < groups.length - 1) await new Promise(r => setTimeout(r, MAP_REDUCE_CHUNK_DELAY_MS));
    }

    // Final reduce over intermediate results
    onProgress?.('Đang tạo tóm tắt tổng quan...', groups.length + 1, groups.length + 1);
    const finalParsed = intermediateResults.map(s => parseSummaryJSON(s));
    const finalCrossRef = buildAuthorCrossReference(finalParsed);
    const finalText = intermediateResults.map((s, i) => `--- Phần ${i + 1} ---\n${s}`).join('\n\n');
    const finalContent = finalCrossRef + finalText;

    const finalPost: ScrapedPost[] = [{ author: 'PARTIAL_SUMMARIES', content: finalContent, timestamp: '', postNumber: 0 }];
    const finalResponse = await provider.summarize(finalPost, REDUCE_SUMMARY_PROMPT);
    resultText = finalResponse.content;
  } else {
    // Fits in a single LLM call
    onProgress?.('Đang tạo tóm tắt tổng quan...');
    const reducePost: ScrapedPost[] = [{ author: 'PARTIAL_SUMMARIES', content: combinedContent, timestamp: '', postNumber: 0 }];
    const response = await provider.summarize(reducePost, REDUCE_SUMMARY_PROMPT);
    resultText = response.content;
  }

  // 5. Post-process: programmatic dedup of supporters (safety net)
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
  finalPrompt?: string,
): Promise<string> {
  const combined = await summaryChunks(posts, config, onProgress, suggestedChunks, undefined, finalPrompt);
  return combined;
}
