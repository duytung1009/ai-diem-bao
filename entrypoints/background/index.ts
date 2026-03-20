import { STORAGE_KEYS, DEFAULT_LLM_CONFIG } from '@/lib/constants';
import { summarizeTopic, updateSummary, analyzeOpinions, researchTopic, testLLMConnection } from '@/lib/llm/summarizer';
import { getCachedTopic, saveCachedTopic, deleteCachedTopic, getCacheSize, getAllCachedTopics, normalizeUrl } from '@/lib/cache-manager';
import { dbPut, dbGet, dbGetAll, dbDelete } from '@/lib/cache-db';
import { extractArticle } from '@/lib/scrapers/article-extractor';
import type { LLMConfig, Message, ScrapedPost, CachedTopic, CustomPrompts } from '@/lib/types';

export default defineBackground(() => {
  // Open side panel when clicking the extension icon
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // One-time migration: storage.local → IndexedDB, then normalize URLs
  migrateStorageLocalToIDB()
    .then(() => migrateNormalizedUrls())
    .catch(console.error);

  browser.runtime?.onMessage.addListener(
    (message: Message, _sender, sendResponse) => {
      switch (message.type) {
        case 'GET_SETTINGS':
          getSettings().then(sendResponse);
          return true;

        case 'SAVE_SETTINGS':
          saveSettings(message.payload as LLMConfig).then(() =>
            sendResponse({ success: true }),
          );
          return true;

        case 'SUMMARIZE': {
          const posts = message.payload as ScrapedPost[];
          getSettings()
            .then(async (config) => {
              const prompts = await getCustomPrompts();
              return summarizeTopic(posts, config, undefined, prompts);
            })
            .then((summary) => sendResponse({ summary }))
            .catch((err) => sendResponse({ error: String(err) }));
          return true;
        }

        case 'SUMMARIZE_INCREMENTAL': {
          const { previousSummary, newPosts } = message.payload as {
            previousSummary: string;
            newPosts: ScrapedPost[];
          };
          getSettings()
            .then(async (config) => {
              const prompts = await getCustomPrompts();
              return updateSummary(previousSummary, newPosts, config, undefined, prompts);
            })
            .then((summary) => sendResponse({ summary }))
            .catch((err) => sendResponse({ error: String(err) }));
          return true;
        }

        case 'ANALYZE_OPINIONS': {
          const posts = message.payload as ScrapedPost[];
          getSettings()
            .then(async (config) => {
              const prompts = await getCustomPrompts();
              return analyzeOpinions(posts, config, undefined, prompts);
            })
            .then((opinions) => sendResponse({ opinions }))
            .catch((err) => sendResponse({ error: String(err) }));
          return true;
        }

        case 'RESEARCH_QUERY': {
          const { posts, question } = message.payload as { posts: ScrapedPost[]; question: string };
          getSettings()
            .then(async (config) => {
              const prompts = await getCustomPrompts();
              return researchTopic(posts, question, config, undefined, prompts);
            })
            .then((answer) => sendResponse({ answer }))
            .catch((err) => sendResponse({ error: String(err) }));
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

        // Forward progress from content script to sidepanel
        case 'SCRAPE_PROGRESS':
          browser.runtime.sendMessage(message).catch(() => {});
          return false;

        case 'CANCEL_SCRAPE':
          return false;

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
