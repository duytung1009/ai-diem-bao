import { STORAGE_KEYS, DEFAULT_LLM_CONFIG } from '@/lib/constants';
import { summarizeTopic, updateSummary, testLLMConnection } from '@/lib/llm/summarizer';
import { getCachedTopic, saveCachedTopic, deleteCachedTopic } from '@/lib/cache-manager';
import type { LLMConfig, Message, ScrapedPost, CachedTopic } from '@/lib/types';

export default defineBackground(() => {
  // Open side panel when clicking the extension icon
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

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
            .then((config) => summarizeTopic(posts, config))
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
            .then((config) => updateSummary(previousSummary, newPosts, config))
            .then((summary) => sendResponse({ summary }))
            .catch((err) => sendResponse({ error: String(err) }));
          return true;
        }

        case 'TEST_CONNECTION':
          getSettings()
            .then((config) => testLLMConnection(config))
            .then((ok) => sendResponse({ ok }))
            .catch((err) => sendResponse({ ok: false, error: String(err) }));
          return true;

        case 'GET_CACHED_TOPIC': {
          getActiveTabUrl()
            .then((url) => (url ? getCachedTopic(url) : null))
            .then(sendResponse)
            .catch(() => sendResponse(null));
          return true;
        }

        case 'SAVE_CACHED_TOPIC': {
          const partial = message.payload as Partial<CachedTopic>;
          getActiveTabUrl()
            .then(async (url) => {
              if (!url) throw new Error('No active tab');
              const config = await getSettings();
              const topic: CachedTopic = {
                url,
                title: partial.title || '',
                version: partial.version || 'unknown',
                posts: partial.posts || [],
                summary: partial.summary || '',
                llmConfig: { provider: config.provider, model: config.model },
                cachedAt: Date.now(),
                lastPostNumber: partial.lastPostNumber || 0,
                totalPosts: partial.totalPosts || 0,
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

async function getActiveTabUrl(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.url || null;
}
