import type { ScrapedPost, LLMConfig, CustomPrompts, SummaryJSON } from '../types';
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

/**
 * Try to parse LLM output as SummaryJSON.
 * Handles: plain JSON, triple-backtick fences (```json...```), single-backtick wrapping (`...`).
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
  try {
    const parsed = JSON.parse(text);
    if (
      typeof parsed.summary === 'string' &&
      Array.isArray(parsed.opinions) &&
      typeof parsed.conclusion === 'string'
    ) {
      return parsed as SummaryJSON;
    }
    return null;
  } catch {
    return null;
  }
}

export async function summarizeTopic(
  posts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: (message: string, step?: number, totalSteps?: number) => void,
  customPrompts?: CustomPrompts,
): Promise<string> {
  const provider = createProvider(config);
  const systemPrompt = customPrompts?.summary || SUMMARY_PROMPT;

  // Check if topic will fit in context
  const contextCheck = willExceedContext(posts, config.model, estimateTokens(systemPrompt));
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
  onProgress?: (message: string, step?: number, totalSteps?: number) => void,
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
  const contextCheck = willExceedContext(postsWithContext, config.model, estimateTokens(systemPrompt));
  if (contextCheck.exceeds && contextCheck.chunksNeeded > 1) {
    onProgress?.(`Cập nhật tóm tắt (${contextCheck.chunksNeeded} phần)...`);
    return summarizeWithMapReduce(postsWithContext, config, onProgress, contextCheck.chunksNeeded);
  }

  const response = await provider.summarize(postsWithContext, systemPrompt);
  return response.content;
}

export async function analyzeOpinions(
  posts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: (message: string, step?: number, totalSteps?: number) => void,
  customPrompts?: CustomPrompts,
): Promise<string> {
  const provider = createProvider(config);
  const systemPrompt = customPrompts?.opinions || OPINION_ANALYSIS_PROMPT;

  // For opinion analysis, check if we need to chunk
  const contextCheck = willExceedContext(posts, config.model, estimateTokens(systemPrompt));
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
  onProgress?: (message: string, step?: number, totalSteps?: number) => void,
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
  const contextCheck = willExceedContext(allPosts, config.model, estimateTokens(systemPrompt));
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
  onProgress?: (message: string, step?: number, totalSteps?: number) => void,
  customPrompts?: CustomPrompts,
): Promise<string> {
  const provider = createProvider(config);
  const systemPrompt = customPrompts?.knowledge || KNOWLEDGE_EXTRACT_PROMPT;

  // For V1: truncate posts to fit within context, keeping earlier posts
  const contextCheck = willExceedContext(posts, config.model, estimateTokens(systemPrompt));
  let postsToUse = posts;
  if (contextCheck.exceeds) {
    let tokenCount = 0;
    const contextLimit = getContextLimit(config.model);
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
): ScrapedPost[][] {
  const contextLimit = getContextLimit(model);
  const bufferTokens = estimateTokens(mapPrompt) + 2000;

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
  onProgress?: (message: string, step?: number, totalSteps?: number) => void,
  suggestedChunks?: number,
  mapPrompt: string = CHUNK_SUMMARY_PROMPT,
  reducePrompt: string = REDUCE_SUMMARY_PROMPT,
): Promise<string> {
  const provider = createProvider(config);
  const chunks = chunkPosts(posts, config.model, mapPrompt, suggestedChunks);

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
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Reduce phase: combine partial summaries
  onProgress?.(`Đang gộp các tóm tắt...`, chunks.length + 1, total);
  const combinedText = partialSummaries
    .map((summary, i) => `--- Phần ${i + 1} ---\n${summary}`)
    .join('\n\n');

  // Recursive reduce: if combinedText itself would exceed context, reduce in stages
  const combinedTokens = estimateTokens(combinedText) + estimateTokens(REDUCE_SUMMARY_PROMPT) + 2000;
  const contextLimit = getContextLimit(config.model);
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
