import { STORAGE_KEYS, DEFAULT_LLM_CONFIG } from '@/lib/constants';
import { summarizeTopic, updateSummary, analyzeOpinions, researchTopic, testLLMConnection } from '@/lib/llm/summarizer';
import { getCachedTopic, saveCachedTopic, deleteCachedTopic, getCacheSize, getAllCachedTopics, normalizeUrl } from '@/lib/cache-manager';
import type { LLMConfig, Message, ScrapedPost, CachedTopic, CustomPrompts } from '@/lib/types';

export default defineBackground(() => {
  // Open side panel when clicking the extension icon
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // One-time migration: normalize all existing cache keys and url fields
  migrateNormalizedUrls().catch(console.error);

  browser.runtime.onMessage.addListener(
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

async function migrateNormalizedUrls(): Promise<void> {
  const all = await browser.storage.local.get(null);
  const toDelete: string[] = [];
  const toSave: Record<string, CachedTopic> = {};

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(STORAGE_KEYS.CACHE_PREFIX)) continue;
    if (!value || typeof value !== 'object' || !('url' in value)) continue;

    const topic = value as CachedTopic;
    const normalizedKey = `${STORAGE_KEYS.CACHE_PREFIX}${normalizeUrl(topic.url)}`;

    if (normalizedKey !== key) {
      toDelete.push(key);
      const existing = toSave[normalizedKey] || (all[normalizedKey] as CachedTopic | undefined);
      if (existing && existing.cachedAt > topic.cachedAt) {
        // Keep newer entry, just delete old key
      } else {
        toSave[normalizedKey] = { ...topic, url: normalizeUrl(topic.url) };
      }
    } else if (topic.url !== normalizeUrl(topic.url)) {
      toSave[key] = { ...topic, url: normalizeUrl(topic.url) };
    }
  }

  if (toDelete.length > 0) await browser.storage.local.remove(toDelete);
  if (Object.keys(toSave).length > 0) await browser.storage.local.set(toSave);
}
