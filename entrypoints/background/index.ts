import { STORAGE_KEYS, DEFAULT_LLM_CONFIG, KEEPALIVE_INTERVAL_MS } from '@/lib/constants';
import { summarizeTopic, updateSummary, researchTopic, extractKnowledge, extractKnowledgeChunk, reduceKnowledgeChunks, summarizeSegments, testLLMConnection, generateThreadAnalysis } from '@/lib/llm/summarizer';
import { getCachedTopic, saveCachedTopic, deleteCachedTopic, getCacheSize, getAllCachedTopics, normalizeUrl, mergePartialTopic } from '@/lib/cache-manager';
import { dbPut, dbGet, dbGetAll, dbDelete } from '@/lib/cache-db';
import { extractArticle } from '@/lib/scrapers/article-extractor';
import { estimateTokens } from '@/lib/token-estimator';
import type { LLMConfig, Message, ScrapedPost, CachedTopic, CustomPrompts, LLMTaskRequest, ModelSpeedStats, KnowledgeEntry, KnowledgeChunk, SummaryJSON, PipelineDefinition, PipelineStep } from '@/lib/types';

export default defineBackground(() => {
  // Open side panel when clicking the extension icon
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

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

        case 'FETCH_HTML': {
          const { url } = message.payload as { url: string };
          fetch(url, { credentials: 'include' })
            .then(async (res) => {
              if (!res.ok) {
                sendResponse({ ok: false, status: res.status, html: '' });
                return;
              }
              const html = await res.text();
              sendResponse({ ok: true, status: res.status, html, finalUrl: res.url });
            })
            .catch((err) => sendResponse({ ok: false, status: 0, html: '', error: String(err) }));
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
              const existing = await getCachedTopic(url);
              const topic = mergePartialTopic(partial, existing, url, { provider: config.provider, model: config.model });
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
    case 'summarize_incremental':
      return { workflow: 'summarize', steps: [pendingStep('summarize', 'Cập nhật Segment tóm tắt')] };
    case 'research':
      return { workflow: 'research', steps: [pendingStep('research', 'Tra cứu và phân tích')] };
    case 'extract_knowledge':
      return { workflow: 'knowledge', steps: [pendingStep('extract', 'Trích xuất kiến thức')] };
    case 'extract_knowledge_chunk':
      return { workflow: 'knowledge', steps: [pendingStep('extract', 'Tổng hợp Segment kiến thức')] };
    case 'reduce_knowledge_chunks':
      return { workflow: 'knowledge', steps: [pendingStep('reduce', 'Tổng hợp kiến thức')] };
    case 'thread_analysis':
      return { workflow: 'knowledge', steps: [pendingStep('analyze', 'Phân tích chủ đề')] };
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
      case 'summarize_incremental': {
        const { previousSummary, newPosts } = payload as { previousSummary: string; newPosts: ScrapedPost[] };
        inputTokens = estimateTokens(previousSummary + newPosts.map(p => p.content).join(''));
        result = { summary: await updateSummary(previousSummary, newPosts, config, onProgress, prompts, signal) };
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
  } catch {
    return [];
  }
}
