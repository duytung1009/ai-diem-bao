import { STORAGE_KEYS, DEFAULT_LLM_CONFIG, KEEPALIVE_INTERVAL_MS } from '@/lib/constants';
import { summarizeTopic, researchTopic, extractKnowledgeChunk, reduceKnowledgeChunks, summarizeSegments, testLLMConnection, generateThreadAnalysis } from '@/lib/llm/summarizer';
import { LLMError, LLMErrorCode } from '@/lib/errors';
import { computeTrustScores } from '@/lib/trust-scorer';
import { getCachedTopic, saveCachedTopic, deleteCachedTopic, getCacheSize, getAllCachedTopics, normalizeUrl, mergePartialTopic } from '@/lib/cache-manager';
import { dbPut, dbGet, dbGetAll, dbDelete } from '@/lib/cache-db';
import { notebookGetAll, notebookGetByTopic, notebookPut, notebookDelete, notebookOrphanByTopic, notebookDeleteByTopic, notebookGetStats } from '@/lib/notebook-db';
import { extractArticle } from '@/lib/scrapers/article-extractor';
import { estimateTokens } from '@/lib/token-estimator';
import { mapExportedTopic, type ImportConflictMode, type ImportResult } from '@/lib/importer';
import type { ExportedTopic } from '@/lib/exporter';
import type { LLMConfig, Message, ScrapedPost, CachedTopic, CustomPrompts, LLMTaskRequest, ModelSpeedStats, KnowledgeEntry, KnowledgeChunk, SummaryJSON, PipelineDefinition, PipelineStep, NotebookEntry } from '@/lib/types';

export default defineBackground(() => {
  // Open side panel when clicking the extension icon (Chrome only)
  if (import.meta.env.BROWSER === 'chrome') {
    browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // One-time migration: storage.local → IndexedDB, then normalize URLs, then migrate prompts
  migrateStorageLocalToIDB()
    .then(() => migrateNormalizedUrls())
    .then(() => migrateCustomPrompts())
    .catch(console.error);

  const activeLLMTasks = new Map<string, AbortController>();

  browser.runtime?.onMessage.addListener(
    (message: Message, _sender, sendResponse) => {
      console.info('[BG] onMessage:', message.type, message.payload);
      switch (message.type) {
        case 'GET_SETTINGS':
          getSettings().then(sendResponse);
          return true;

        case 'SAVE_SETTINGS':
          saveSettings(message.payload as LLMConfig).then(() =>
            sendResponse({ success: true }),
          );
          return true;

        case 'START_LLM_TASK': {
          const { taskId, taskType, payload } = message.payload as LLMTaskRequest;

          // Respond immediately — giải phóng message channel
          sendResponse({ started: true, taskId });

          // Keepalive — prevent service worker termination during long LLM call (Chrome only)
          const keepalive = import.meta.env.BROWSER === 'chrome'
            ? setInterval(() => {
                void browser.storage.sync.get(''); // no-op ping to keep service worker alive
              }, KEEPALIVE_INTERVAL_MS)
            : null;

          const ctrl = new AbortController();
          activeLLMTasks.set(taskId, ctrl);

          processLLMTask(taskId, taskType, payload, ctrl.signal)
            .finally(() => {
              if (keepalive !== null) clearInterval(keepalive);
              activeLLMTasks.delete(taskId);
            });

          return true;
        }

        case 'CANCEL_LLM_TASK': {
          const { taskId } = message.payload as { taskId: string };
          activeLLMTasks.get(taskId)?.abort();
          sendResponse({ cancelled: true });
          return true;
        }

        case 'TEST_CONNECTION':
          getSettings()
            .then((config) => testLLMConnection(config))
            .then((ok) => sendResponse({ ok }))
            .catch((err) => sendResponse({ ok: false, error: String(err) }));
          return true;

        case 'GET_CUSTOM_PROMPTS':
          getCustomPrompts().then(sendResponse).catch(() => sendResponse({}));
          return true;

        case 'SAVE_CUSTOM_PROMPTS':
          saveCustomPrompts(message.payload as CustomPrompts)
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ error: String(err) }));
          return true;

        case 'SCRAPE_ARTICLE': {
          const { url: articleUrl } = message.payload as { url: string };
          extractArticle(articleUrl).then(sendResponse).catch(() => sendResponse(null));
          return true;
        }

        case 'FETCH_HTML': {
          const { url } = message.payload as { url: string };
          fetch(url, { credentials: 'include' })
            .then(async (res) => {
              if (!res.ok) {
                sendResponse({ ok: false, status: res.status, html: '', finalUrl: res.url });
                return;
              }
              const html = await res.text();
              sendResponse({ ok: true, status: res.status, html, finalUrl: res.url });
            })
            .catch((err) => sendResponse({ ok: false, status: 0, html: '', error: String(err) }));
          return true;
        }

        case 'IMPORT_CACHE': {
          const { topics, conflictMode } = message.payload as { topics: ExportedTopic[]; conflictMode: ImportConflictMode };

          (async () => {
            const safeTopics = Array.isArray(topics) ? topics : [];
            const result: ImportResult = {
              total: safeTopics.length,
              imported: 0,
              skipped: 0,
              failed: 0,
              errors: [],
            };

            const settled = await Promise.allSettled(
              safeTopics.map(async (topic, index) => {
                const label = topic?.url || `topic #${index + 1}`;
                if (!topic?.url || !topic?.title) {
                  return { kind: 'skipped' as const, error: `${label}: thiếu url hoặc title` };
                }

                if (conflictMode === 'skip') {
                  const existing = await dbGet(topic.url);
                  if (existing) {
                    return { kind: 'skipped' as const };
                  }
                }

                const mapped = mapExportedTopic(topic);
                await dbPut(mapped);
                return { kind: 'imported' as const };
              }),
            );

            for (let i = 0; i < settled.length; i += 1) {
              const item = settled[i];
              if (item.status === 'fulfilled') {
                if (item.value.kind === 'imported') {
                  result.imported += 1;
                } else {
                  result.skipped += 1;
                  if (item.value.error) result.errors.push(item.value.error);
                }
              } else {
                result.failed += 1;
                const label = safeTopics[i]?.url || `topic #${i + 1}`;
                result.errors.push(`${label}: ${String(item.reason)}`);
              }
            }

            sendResponse(result);
          })().catch((err) => sendResponse({
            total: 0,
            imported: 0,
            skipped: 0,
            failed: 1,
            errors: [String(err)],
          } satisfies ImportResult));

          return true;
        }

        case 'GET_CACHED_TOPIC': {
          // Caller phải luôn truyền URL trong payload — không fallback tabs.query (cần tabs permission)
          const payloadUrl = message.payload as string | undefined;
          (payloadUrl ? getCachedTopic(payloadUrl) : Promise.resolve(null))
            .then(sendResponse)
            .catch(() => sendResponse(null));
          return true;
        }

        case 'SAVE_CACHED_TOPIC': {
          // Caller phải luôn truyền url trong payload — không fallback tabs.query (cần tabs permission)
          const partial = message.payload as Partial<CachedTopic> & { url?: string };
          if (!partial.url) {
            sendResponse({ error: 'No URL in payload' });
            return true;
          }
          const url = partial.url;
          (async () => {
            const config = await getSettings();
            const existing = await getCachedTopic(url);
            const topic = mergePartialTopic(partial, existing, url, { provider: config.provider, model: config.model });
            // Compute trust scores when scrape data arrives (posts or segments updated).
            // Prefer segment posts as source because they are freshly scraped with userMeta.
            // Top-level topic.posts may be from old cache (pre-Feature 28) without userMeta.
            if (partial.posts !== undefined || partial.segments !== undefined) {
              const segPosts = (topic.segments ?? []).flatMap(seg => seg?.posts ?? []);
              const postsForScoring = segPosts.length > 0 ? segPosts : topic.posts;
              const hasMeta = postsForScoring.some(p => p.userMeta !== undefined);
              if (postsForScoring.length > 0) {
                try {
                  topic.userTrustScores = hasMeta ? computeTrustScores(postsForScoring) : undefined;
                } catch (e) {
                  console.warn('[BG] Trust scorer failed (non-fatal):', e);
                }
              }
            }
            await saveCachedTopic(topic);
            sendResponse({ success: true });
          })().catch((err) => sendResponse({ error: String(err) }));
          return true;
        }

        case 'DELETE_CACHED_TOPIC': {
          const url = message.payload as string;
          deleteCachedTopic(url)
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ error: String(err) }));
          return true;
        }

        case 'GET_CACHE_SIZE':
          getCacheSize()
            .then((bytes) => sendResponse({ bytes }))
            .catch(() => sendResponse({ bytes: 0 }));
          return true;

        case 'GET_ALL_CACHED_TOPICS':
          getAllCachedTopics()
            .then(sendResponse)
            .catch(() => sendResponse([]));
          return true;

        case 'GET_NOTEBOOK_ENTRIES': {
          const filters = message.payload as { topicUrl?: string; category?: string; tag?: string; search?: string; orphanOnly?: boolean } | undefined;
          const promise = filters?.topicUrl
            ? notebookGetByTopic(filters.topicUrl)
            : notebookGetAll();
          promise.then(async entries => {
            // Lazy orphan: group by sourceTopicUrl, check in parallel
            const urlToEntries = new Map<string, typeof entries>();
            entries.forEach(e => {
              if (e.orphaned) return;
              const existing = urlToEntries.get(e.sourceTopicUrl);
              if (existing) existing.push(e);
              else urlToEntries.set(e.sourceTopicUrl, [e]);
            });
            if (urlToEntries.size > 0) {
              const results = await Promise.all(
                [...urlToEntries.keys()].map(url =>
                  dbGet(url).then(exists => ({ url, exists })).catch(() => ({ url, exists: null as unknown }))
                )
              );
              for (const { url, exists } of results) {
                if (!exists) await notebookOrphanByTopic(url).catch(() => {});
              }
            }
            let filtered = entries;
            if (filters?.category) filtered = filtered.filter(e => e.category === filters.category);
            if (filters?.tag) filtered = filtered.filter(e => e.tags.includes(filters.tag!));
            if (filters?.orphanOnly) filtered = filtered.filter(e => e.orphaned);
            if (filters?.search) {
              const q = filters.search.toLowerCase();
              filtered = filtered.filter(e => e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
            }
            sendResponse(filtered);
          }).catch(() => sendResponse([]));
          return true;
        }

        case 'GET_NOTEBOOK_STATS':
          notebookGetStats().then(sendResponse).catch(() => sendResponse({ totalEntries: 0, topicCount: 0, orphanCount: 0, categories: [] }));
          return true;

        case 'UPSERT_NOTEBOOK_ENTRY':
          notebookPut(message.payload as NotebookEntry).then(() => sendResponse({ success: true })).catch((err) => sendResponse({ success: false, error: String(err) }));
          return true;

        case 'DELETE_NOTEBOOK_ENTRY': {
          const { id } = message.payload as { id: string };
          notebookDelete(id).then(() => sendResponse({ success: true })).catch((err) => sendResponse({ success: false, error: String(err) }));
          return true;
        }

        case 'ORPHAN_NOTEBOOK_BY_TOPIC': {
          const { topicUrl } = message.payload as { topicUrl: string };
          notebookOrphanByTopic(topicUrl).then(() => sendResponse({ success: true })).catch((err) => sendResponse({ success: false, error: String(err) }));
          return true;
        }

        case 'DELETE_NOTEBOOK_BY_TOPIC': {
          const { topicUrl } = message.payload as { topicUrl: string };
          notebookDeleteByTopic(topicUrl).then(() => sendResponse({ success: true })).catch((err) => sendResponse({ success: false, error: String(err) }));
          return true;
        }

        default:
          return false;
      }
    },
  );
});

async function getSettings(): Promise<LLMConfig> {
  const result = await browser.storage.sync.get(STORAGE_KEYS.SETTINGS);
  return (result[STORAGE_KEYS.SETTINGS] as LLMConfig) || { ...DEFAULT_LLM_CONFIG };
}

async function saveSettings(config: LLMConfig): Promise<void> {
  await browser.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: config });
}

async function getCustomPrompts(): Promise<CustomPrompts> {
  const result = await browser.storage.sync.get(STORAGE_KEYS.CUSTOM_PROMPTS);
  return (result[STORAGE_KEYS.CUSTOM_PROMPTS] as CustomPrompts) || {};
}

async function saveCustomPrompts(prompts: CustomPrompts): Promise<void> {
  await browser.storage.sync.set({ [STORAGE_KEYS.CUSTOM_PROMPTS]: prompts });
}

async function migrateStorageLocalToIDB(): Promise<void> {
  const flag = await browser.storage.local.get('idb-migration-done');
  if (flag['idb-migration-done']) return;

  const all = await browser.storage.local.get(null);
  const cacheKeys: string[] = [];

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(STORAGE_KEYS.CACHE_PREFIX)) continue;
    if (!value || typeof value !== 'object' || !('url' in value)) continue;

    const topic = value as CachedTopic;
    const normalizedUrl = normalizeUrl(topic.url);

    const existing = await dbGet(normalizedUrl);
    if (existing && existing.cachedAt > topic.cachedAt) {
      cacheKeys.push(key);
      continue;
    }

    await dbPut({ ...topic, url: normalizedUrl });
    cacheKeys.push(key);
  }

  if (cacheKeys.length > 0) await browser.storage.local.remove(cacheKeys);
  await browser.storage.local.set({ 'idb-migration-done': true });
}

async function migrateNormalizedUrls(): Promise<void> {
  const topics = await dbGetAll();

  for (const topic of topics) {
    const normalizedUrl = normalizeUrl(topic.url);
    if (normalizedUrl === topic.url) continue;

    await dbDelete(topic.url);

    const existing = await dbGet(normalizedUrl);
    if (existing && existing.cachedAt > topic.cachedAt) continue;

    await dbPut({ ...topic, url: normalizedUrl });
  }
}

async function migrateCustomPrompts(): Promise<void> {
  const flagKey = 'promptsMigratedV2';
  const flag = await browser.storage.sync.get(flagKey);
  if (flag[flagKey]) return;

  const result = await browser.storage.sync.get(STORAGE_KEYS.CUSTOM_PROMPTS);
  const oldPrompts = result[STORAGE_KEYS.CUSTOM_PROMPTS] as Record<string, string> | undefined;
  if (!oldPrompts) {
    await browser.storage.sync.set({ [flagKey]: true });
    return;
  }

  const newPrompts: CustomPrompts = {};
  for (const key of ['summary', 'opinions', 'research', 'knowledge', 'threadAnalysis'] as const) {
    if (oldPrompts[key]) newPrompts[key] = oldPrompts[key];
  }

  const hasOldKeys = ('chunkSummaryPrompt' in oldPrompts) || ('reduceSummaryPrompt' in oldPrompts);
  if (hasOldKeys) {
    const parts: string[] = [];
    if (oldPrompts.chunkSummaryPrompt && oldPrompts.chunkSummaryPrompt !== oldPrompts.summary) {
      parts.push(`[Prompt cũ - Tóm tắt phần]:\n${oldPrompts.chunkSummaryPrompt}`);
    }
    if (oldPrompts.reduceSummaryPrompt && oldPrompts.reduceSummaryPrompt !== oldPrompts.summary) {
      parts.push(`[Prompt cũ - Gộp tóm tắt]:\n${oldPrompts.reduceSummaryPrompt}`);
    }
    if (parts.length > 0) {
      newPrompts.summary = (newPrompts.summary || '') + '\n\n---\n\n' + parts.join('\n\n');
    }
  }

  await browser.storage.sync.set({ [STORAGE_KEYS.CUSTOM_PROMPTS]: newPrompts, [flagKey]: true });
}

function buildPipeline(taskType: string): PipelineDefinition | null {
  const pendingStep = (id: string, label: string): PipelineStep => ({ id, label, status: 'pending' });
  switch (taskType) {
    case 'summarize':
    case 'summarize_segments':
      // Caller (useSummarize) đã build detailed pipeline → không cần generic
      return null;
    case 'extract_knowledge_chunk':
    case 'reduce_knowledge_chunks':
      // Caller (useKnowledge) đã build detailed pipeline → không cần generic
      return null;
    case 'research':
      return { workflow: 'research', steps: [pendingStep('research', 'Tra cứu và phân tích')] };
    case 'thread_analysis':
      return { workflow: 'knowledge', steps: [pendingStep('analyze', 'Phân tích thớt')] };
    default:
      return null;
  }
}

async function processLLMTask(taskId: string, taskType: string, payload: unknown, signal?: AbortSignal): Promise<void> {
  const startTime = Date.now();
  const config = await getSettings();
  const prompts = await getCustomPrompts();
  let inputTokens = 0;
  let stepCount = 0;
  let totalSteps = 1;
  let pipelineSent = false;

  // Build pipeline definition for this task type
  const pipeline = buildPipeline(taskType);

  const onProgress = (msg: string, step?: number, total?: number) => {
    if (total !== undefined) totalSteps = total;
    stepCount++;
    const elapsedMs = Date.now() - startTime;
    const pl: { taskId: string; step: number; totalSteps: number; message: string; elapsedMs: number; pipeline?: PipelineDefinition } = {
      taskId, step: step ?? stepCount, totalSteps, message: msg, elapsedMs,
    };
    // Send pipeline only on first progress message
    if (!pipelineSent && pipeline) {
      pl.pipeline = pipeline;
      pipelineSent = true;
    }
    browser.runtime.sendMessage({ type: 'LLM_PROGRESS', payload: pl }).catch(() => {});
  };

  try {
    let result: unknown;

    switch (taskType) {
      case 'summarize': {
        const posts = payload as ScrapedPost[];
        inputTokens = estimateTokens(posts.map(p => p.content).join(''));
        result = { summary: await summarizeTopic(posts, config, onProgress, prompts, signal) };
        break;
      }

      case 'research': {
        const { posts, question } = payload as { posts: ScrapedPost[]; question: string };
        inputTokens = estimateTokens(posts.map(p => p.content).join('') + question);
        result = { answer: await researchTopic(posts, question, config, onProgress, prompts, signal) };
        break;
      }
      case 'extract_knowledge_chunk': {
        const { posts, title, mode } = payload as { posts: ScrapedPost[]; title: string; mode?: 'extract' | 'chunk' };
        inputTokens = estimateTokens(posts.map(p => p.content).join(''));
        try {
          const raw = await extractKnowledgeChunk(posts, title, config, onProgress, prompts, signal, mode ?? 'chunk');
          result = { entries: parseKnowledgeEntries(raw) };
        } catch (extractErr) {
          if (
            extractErr instanceof LLMError &&
            extractErr.code === LLMErrorCode.INCOMPLETE_RESPONSE &&
            extractErr.partialText
          ) {
            let salvaged: KnowledgeEntry[] = [];
            try {
              salvaged = parseKnowledgeEntries(extractErr.partialText);
            } catch { /* parse failed — salvaged stays [] */ }
            result = { entries: salvaged, truncated: true };
          } else {
            throw extractErr;
          }
        }
        break;
      }
      case 'reduce_knowledge_chunks': {
        const { partialEntries, entryCap } = payload as { partialEntries: KnowledgeEntry[][]; entryCap?: number };
        inputTokens = estimateTokens(JSON.stringify(partialEntries));
        const raw = await reduceKnowledgeChunks(partialEntries, config, onProgress, signal, prompts, entryCap);
        result = { entries: parseKnowledgeEntries(raw) };
        break;
      }
      case 'summarize_segments': {
        const summaries = payload as string[];
        inputTokens = estimateTokens(summaries.join(''));
        result = { summary: await summarizeSegments(summaries, config, onProgress, signal) };
        break;
      }
      case 'thread_analysis': {
        const { summaryJson, meta } = payload as { summaryJson: SummaryJSON; meta: { title: string; totalPages: number; totalPosts: number } };
        inputTokens = estimateTokens(JSON.stringify(summaryJson));
        result = { analysis: await generateThreadAnalysis(summaryJson, meta, config, onProgress, prompts, signal) };
        break;
      }
      default:
        throw new Error(`Unknown taskType: ${taskType}`);
    }

    const elapsedMs = Date.now() - startTime;
    const outputTokens = estimateTokens(JSON.stringify(result));

    browser.runtime.sendMessage({
      type: 'LLM_RESULT',
      payload: {
        taskId, taskType, success: true, data: result,
        stats: { elapsedMs, inputTokens, outputTokens, mapReduceSteps: stepCount || 1 },
      },
    }).catch(() => {});

    await updateModelSpeedStats(config.model, inputTokens + outputTokens, elapsedMs);
  } catch (err) {
    browser.runtime.sendMessage({
      type: 'LLM_RESULT',
      payload: {
        taskId, taskType, success: false, error: String(err),
        stats: { elapsedMs: Date.now() - startTime, inputTokens, outputTokens: 0, mapReduceSteps: stepCount || 1 },
      },
    }).catch(() => {});
  }
}

async function updateModelSpeedStats(model: string, totalTokens: number, elapsedMs: number): Promise<void> {
  try {
    const key = STORAGE_KEYS.MODEL_SPEED_STATS;
    const stored = await browser.storage.sync.get(key);
    const allStats: Record<string, ModelSpeedStats> = (stored[key] as Record<string, ModelSpeedStats>) || {};

    const current = allStats[model] || { model, tokensPerSecond: 0, samples: 0, lastUpdated: 0 };
    const newTps = totalTokens / (elapsedMs / 1000);

    current.tokensPerSecond = current.samples > 0
      ? (current.tokensPerSecond * 0.7 + newTps * 0.3)
      : newTps;
    current.samples++;
    current.lastUpdated = Date.now();

    allStats[model] = current;
    await browser.storage.sync.set({ [key]: allStats });
  } catch { /* non-critical */ }
}

/** Salvage partial entries from a truncated JSON array.
 * Finds the first '[', scans backward from the end to find the last complete '}',
 * appends ']' and tries JSON.parse. Returns raw array on success, [] on failure.
 */
function tryRescuePartialArray(text: string): unknown[] {
  const startIdx = text.indexOf('[');
  if (startIdx === -1) return [];
  // Scan backward from end to find the last '}' that closes a complete object
  for (let i = text.length - 1; i > startIdx; i--) {
    if (text[i] === '}') {
      const candidate = text.slice(startIdx, i + 1) + ']';
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* continue scanning */ }
    }
  }
  return [];
}

function parseKnowledgeEntries(raw: string): KnowledgeEntry[] {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  let text = (fenceMatch ? fenceMatch[1] : raw).trim();
  if (text.length < 10) {
    throw new Error('LLM trả về dữ liệu quá ngắn, không thể parse kiến thức. Thử tăng "Max tokens" trong Cài đặt hoặc giảm số bài trong 1 lần trích xuất.');
  }
  // Fix broken \u sequences (same as parseSummaryJSON)
  text = text.replace(/\\u(?![0-9a-fA-F]{4})/g, 'u');

  function mapEntries(parsed: unknown[]): KnowledgeEntry[] {
    const flat = parsed.flat();
    const now = Date.now();
    return flat
      .filter((e: unknown): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && typeof (e as Record<string, unknown>).title === 'string'
      )
      .map((e) => ({
        id: crypto.randomUUID(),
        title: String(e.title ?? ''),
        content: String(e.content ?? ''),
        tags: Array.isArray(e.tags) ? (e.tags as unknown[]).map(String) : [],
        category: typeof (e as Record<string, unknown>).category === 'string'
          ? String((e as Record<string, unknown>).category)
          : undefined,
        source: {
          author: String((e.source as Record<string, unknown>)?.author ?? ''),
          postNumber: Number((e.source as Record<string, unknown>)?.postNumber ?? 0),
        },
        extractedAt: now,
      }));
  }

  try {
    const rawParsed: unknown = JSON.parse(text);
    // Handle wrapped format { entries: [...] } from OpenAI Structured Outputs
    // (root-level arrays are not supported by the API, so we wrap in an object).
    let parsed: unknown[];
    if (
      rawParsed !== null &&
      typeof rawParsed === 'object' &&
      !Array.isArray(rawParsed) &&
      Array.isArray((rawParsed as Record<string, unknown>).entries)
    ) {
      parsed = (rawParsed as Record<string, unknown>).entries as unknown[];
    } else if (Array.isArray(rawParsed)) {
      parsed = rawParsed;
    } else {
      return [];
    }
    return mapEntries(parsed);
  } catch {
    // Fallback: salvage partial entries from truncated JSON
    if (text.length > 50) {
      const rescued = tryRescuePartialArray(text);
      if (rescued.length > 0) {
        return mapEntries(rescued);
      }
      throw new Error('LLM trả về JSON không hợp lệ, không thể parse kiến thức. Dữ liệu có thể bị lỗi — thử lại hoặc tăng "Max tokens" trong Cài đặt.');
    }
    return [];
  }
}
