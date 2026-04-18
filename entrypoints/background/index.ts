import { STORAGE_KEYS, DEFAULT_LLM_CONFIG, KEEPALIVE_INTERVAL_MS } from '@/lib/constants';
import { summarizeTopic, updateSummary, analyzeOpinions, researchTopic, extractKnowledge, extractKnowledgeChunk, reduceKnowledgeChunks, summarizeSegments, testLLMConnection, generateThreadAnalysis } from '@/lib/llm/summarizer';
import { getCachedTopic, saveCachedTopic, deleteCachedTopic, getCacheSize, getAllCachedTopics, normalizeUrl } from '@/lib/cache-manager';
import { dbPut, dbGet, dbGetAll, dbDelete } from '@/lib/cache-db';
import { extractArticle } from '@/lib/scrapers/article-extractor';
import { estimateTokens } from '@/lib/token-estimator';
import type { LLMConfig, Message, ScrapedPost, CachedTopic, CustomPrompts, LLMTaskRequest, ModelSpeedStats, KnowledgeEntry, KnowledgeChunk, SummaryJSON } from '@/lib/types';

export default defineBackground(() => {
  // Open side panel when clicking the extension icon
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // One-time migration: storage.local → IndexedDB, then normalize URLs
  migrateStorageLocalToIDB()
    .then(() => migrateNormalizedUrls())
    .catch(console.error);

  const activeLLMTasks = new Map<string, AbortController>();

  browser.runtime?.onMessage.addListener(
    (message: Message, _sender, sendResponse) => {
      console.log('[BG] onMessage:', message.type, message.payload);
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

          // Keepalive — prevent service worker termination during long LLM call
          const keepalive = setInterval(() => {
            void browser.storage.sync.get(''); // no-op ping to keep service worker alive
          }, KEEPALIVE_INTERVAL_MS);

          const ctrl = new AbortController();
          activeLLMTasks.set(taskId, ctrl);

          processLLMTask(taskId, taskType, payload, ctrl.signal)
            .finally(() => {
              clearInterval(keepalive);
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

        case 'GET_CACHED_TOPIC': {
          const payloadUrl = message.payload as string | undefined;
          const urlPromise = payloadUrl ? Promise.resolve(payloadUrl) : getActiveTabUrl();
          urlPromise
            .then((url) => (url ? getCachedTopic(url) : null))
            .then(sendResponse)
            .catch(() => sendResponse(null));
          return true;
        }

        case 'SAVE_CACHED_TOPIC': {
          const partial = message.payload as Partial<CachedTopic> & { url?: string };
          const urlPromise = partial.url ? Promise.resolve(partial.url) : getActiveTabUrl();
          urlPromise
            .then(async (url) => {
              if (!url) throw new Error('No URL');
              const config = await getSettings();
              // Load existing so a partial update (e.g. opinions only) doesn't wipe other fields
              const existing = await getCachedTopic(url);
              const topic: CachedTopic = {
                url: normalizeUrl(url),
                title: partial.title ?? existing?.title ?? '',
                version: partial.version ?? existing?.version ?? 'unknown',
                posts: partial.posts ?? existing?.posts ?? [],
                summary: partial.summary ?? existing?.summary ?? '',
                opinions: partial.opinions ?? existing?.opinions,
                researchHistory: partial.researchHistory ?? existing?.researchHistory,
                llmConfig: { provider: config.provider, model: config.model },
                cachedAt: Date.now(),
                lastPostNumber: partial.lastPostNumber ?? existing?.lastPostNumber ?? 0,
                totalPosts: partial.totalPosts ?? existing?.totalPosts ?? 0,
                summarizedPostCount: partial.summarizedPostCount ?? existing?.summarizedPostCount ?? partial.totalPosts ?? existing?.totalPosts ?? 0,
                totalPages: partial.totalPages ?? existing?.totalPages ?? 1,
                topicType: partial.topicType ?? existing?.topicType,
                segments: partial.segments ?? existing?.segments,
                overallSummary: partial.overallSummary ?? existing?.overallSummary,
                summaryJson: partial.summaryJson ?? existing?.summaryJson,
                bookmarked: partial.bookmarked ?? existing?.bookmarked,
                knowledgeEntries: partial.knowledgeEntries ?? existing?.knowledgeEntries,
                knowledgeChunks: partial.knowledgeChunks !== undefined
                  ? partial.knowledgeChunks
                  : existing?.knowledgeChunks,
                lastKnowledgePostNumber: partial.lastKnowledgePostNumber !== undefined
                  ? partial.lastKnowledgePostNumber
                  : existing?.lastKnowledgePostNumber,
                excludedKnowledgePostNumbers: partial.excludedKnowledgePostNumbers !== undefined
                  ? partial.excludedKnowledgePostNumbers
                  : existing?.excludedKnowledgePostNumbers,
                threadAnalysis: partial.threadAnalysis !== undefined
                  ? partial.threadAnalysis
                  : existing?.threadAnalysis,
              };
              await saveCachedTopic(topic);
              sendResponse({ success: true });
            })
            .catch((err) => sendResponse({ error: String(err) }));
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

async function getActiveTabUrl(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.url || null;
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

async function processLLMTask(taskId: string, taskType: string, payload: unknown, signal?: AbortSignal): Promise<void> {
  const startTime = Date.now();
  const config = await getSettings();
  const prompts = await getCustomPrompts();
  let inputTokens = 0;
  let stepCount = 0;
  let totalSteps = 1;

  const onProgress = (msg: string, step?: number, total?: number) => {
    if (total !== undefined) totalSteps = total;
    stepCount++;
    browser.runtime.sendMessage({
      type: 'LLM_PROGRESS',
      payload: { taskId, step: step ?? stepCount, totalSteps, message: msg, elapsedMs: Date.now() - startTime },
    }).catch(() => {}); // sidepanel có thể đã đóng
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
      case 'summarize_incremental': {
        const { previousSummary, newPosts } = payload as { previousSummary: string; newPosts: ScrapedPost[] };
        inputTokens = estimateTokens(previousSummary + newPosts.map(p => p.content).join(''));
        result = { summary: await updateSummary(previousSummary, newPosts, config, onProgress, prompts, signal) };
        break;
      }
      case 'analyze_opinions': {
        const posts = payload as ScrapedPost[];
        inputTokens = estimateTokens(posts.map(p => p.content).join(''));
        result = { opinions: await analyzeOpinions(posts, config, onProgress, prompts, signal) };
        break;
      }
      case 'research': {
        const { posts, question } = payload as { posts: ScrapedPost[]; question: string };
        inputTokens = estimateTokens(posts.map(p => p.content).join('') + question);
        result = { answer: await researchTopic(posts, question, config, onProgress, prompts, signal) };
        break;
      }
      case 'extract_knowledge': {
        const { posts, title } = payload as { posts: ScrapedPost[]; title: string };
        inputTokens = estimateTokens(posts.map(p => p.content).join(''));
        const raw = await extractKnowledge(posts, title, config, onProgress, prompts, signal);
        result = { entries: parseKnowledgeEntries(raw) };
        break;
      }
      case 'extract_knowledge_chunk': {
        const { posts, title } = payload as { posts: ScrapedPost[]; title: string };
        inputTokens = estimateTokens(posts.map(p => p.content).join(''));
        const raw = await extractKnowledgeChunk(posts, title, config, onProgress, signal);
        result = { entries: parseKnowledgeEntries(raw) };
        break;
      }
      case 'reduce_knowledge_chunks': {
        const { partialEntries, entryCap } = payload as { partialEntries: KnowledgeEntry[][]; entryCap?: number };
        inputTokens = estimateTokens(JSON.stringify(partialEntries));
        const raw = await reduceKnowledgeChunks(partialEntries, config, onProgress, signal, entryCap);
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

function parseKnowledgeEntries(raw: string): KnowledgeEntry[] {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = (fenceMatch ? fenceMatch[1] : raw).trim();
  try {
    let parsed: unknown[] = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    parsed = parsed.flat();
    const now = Date.now();
    return parsed
      .filter((e: unknown): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && typeof (e as Record<string, unknown>).title === 'string'
      )
      .slice(0, 20)
      .map((e) => ({
        id: crypto.randomUUID(),
        title: String(e.title ?? ''),
        content: String(e.content ?? ''),
        tags: Array.isArray(e.tags) ? (e.tags as unknown[]).map(String) : [],
        source: {
          author: String((e.source as Record<string, unknown>)?.author ?? ''),
          postNumber: Number((e.source as Record<string, unknown>)?.postNumber ?? 0),
        },
        extractedAt: now,
      }));
  } catch {
    return [];
  }
}
