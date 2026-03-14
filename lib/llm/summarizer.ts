import type { ScrapedPost, LLMConfig } from '../types';
import { createProvider } from './factory';
import {
  SUMMARY_PROMPT,
  INCREMENTAL_UPDATE_PROMPT,
  OPINION_ANALYSIS_PROMPT,
  CHUNK_SUMMARY_PROMPT,
  REDUCE_SUMMARY_PROMPT,
} from '../prompts';
import { estimateTokens, getContextLimit, willExceedContext } from '../token-estimator';

export async function summarizeTopic(
  posts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: (message: string) => void,
): Promise<string> {
  const provider = createProvider(config);

  // Check if topic will fit in context
  const contextCheck = willExceedContext(posts, config.model, estimateTokens(SUMMARY_PROMPT));
  if (contextCheck.exceeds && contextCheck.chunksNeeded > 1) {
    // Use map-reduce for large topics
    onProgress?.(`Đang tóm tắt phần 1/${contextCheck.chunksNeeded}...`);
    return summarizeWithMapReduce(posts, config, onProgress, contextCheck.chunksNeeded);
  }

  // Direct summarization for small topics
  const response = await provider.summarize(posts, SUMMARY_PROMPT);
  return response.content;
}

export async function updateSummary(
  previousSummary: string,
  newPosts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: (message: string) => void,
): Promise<string> {
  const provider = createProvider(config);
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
  const contextCheck = willExceedContext(postsWithContext, config.model, estimateTokens(INCREMENTAL_UPDATE_PROMPT));
  if (contextCheck.exceeds && contextCheck.chunksNeeded > 1) {
    onProgress?.(`Cập nhật tóm tắt (${contextCheck.chunksNeeded} phần)...`);
    return summarizeWithMapReduce(postsWithContext, config, onProgress, contextCheck.chunksNeeded);
  }

  const response = await provider.summarize(postsWithContext, INCREMENTAL_UPDATE_PROMPT);
  return response.content;
}

export async function analyzeOpinions(
  posts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: (message: string) => void,
): Promise<string> {
  const provider = createProvider(config);

  // For opinion analysis, check if we need to chunk
  const contextCheck = willExceedContext(posts, config.model, estimateTokens(OPINION_ANALYSIS_PROMPT));
  if (contextCheck.exceeds && contextCheck.chunksNeeded > 1) {
    onProgress?.(`Phân tích ý kiến (${contextCheck.chunksNeeded} phần)...`);
    // Use map-reduce to extract opinions
    const mapResult = await summaryChunks(posts, config, onProgress, contextCheck.chunksNeeded);
    // Then analyze the combined summary
    const opinionResponse = await provider.summarize(
      [{ author: 'CONTEXT', content: mapResult, timestamp: '', postNumber: 0 } as ScrapedPost],
      OPINION_ANALYSIS_PROMPT,
    );
    return opinionResponse.content;
  }

  const response = await provider.summarize(posts, OPINION_ANALYSIS_PROMPT);
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
  maxChunks?: number,
): ScrapedPost[][] {
  const contextLimit = getContextLimit(model);
  const bufferTokens = estimateTokens(CHUNK_SUMMARY_PROMPT) + 2000;
  const maxTokensPerChunk = contextLimit - bufferTokens;

  const chunks: ScrapedPost[][] = [];
  let currentChunk: ScrapedPost[] = [];
  let currentTokens = 0;

  for (const post of posts) {
    const postTokens = estimateTokens(`[${post.author}] (#${post.postNumber}):\n${post.content}`);

    // If adding this post exceeds limit and chunk is not empty, start new chunk
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

  // Respect maxChunks if specified
  if (maxChunks && chunks.length > maxChunks) {
    // Further subdivide chunks if needed
    const targetChunks: ScrapedPost[][] = [];
    const chunkSize = Math.ceil(chunks.length / maxChunks);
    for (let i = 0; i < chunks.length; i += chunkSize) {
      const merged = chunks.slice(i, i + chunkSize).flat();
      targetChunks.push(merged);
    }
    return targetChunks;
  }

  return chunks;
}

/**
 * Map phase: summarize each chunk
 */
async function summaryChunks(
  posts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: (message: string) => void,
  suggestedChunks?: number,
): Promise<string> {
  const provider = createProvider(config);
  const chunks = chunkPosts(posts, config.model, suggestedChunks);

  if (chunks.length === 1) {
    // No chunking needed
    const response = await provider.summarize(chunks[0], CHUNK_SUMMARY_PROMPT);
    return response.content;
  }

  // Map phase: summarize each chunk sequentially (to avoid rate limits)
  const partialSummaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Đang tóm tắt phần ${i + 1}/${chunks.length}...`);
    const response = await provider.summarize(chunks[i], CHUNK_SUMMARY_PROMPT);
    partialSummaries.push(response.content);

    // Small delay between requests to avoid rate limiting
    if (i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Reduce phase: combine partial summaries
  onProgress?.(`Đang gộp các tóm tắt...`);
  const combinedText = partialSummaries
    .map((summary, i) => `--- Phần ${i + 1} ---\n${summary}`)
    .join('\n\n');
  const reduceChunks: ScrapedPost[] = [
    {
      author: 'PARTIAL_SUMMARIES',
      content: combinedText,
      timestamp: '',
      postNumber: 0,
    } as ScrapedPost,
  ];

  const finalResponse = await provider.summarize(reduceChunks, REDUCE_SUMMARY_PROMPT);
  return finalResponse.content;
}

/**
 * Map-reduce summarization for large topics
 */
async function summarizeWithMapReduce(
  posts: ScrapedPost[],
  config: LLMConfig,
  onProgress?: (message: string) => void,
  suggestedChunks?: number,
): Promise<string> {
  const combined = await summaryChunks(posts, config, onProgress, suggestedChunks);
  return combined;
}
