import { STORAGE_KEYS, DEFAULT_LLM_CONFIG } from '@/lib/constants';
import { summarizeTopic, testLLMConnection } from '@/lib/llm/summarizer';
import type { LLMConfig, Message, ScrapedPost } from '@/lib/types';

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

        case 'TEST_CONNECTION':
          getSettings()
            .then((config) => testLLMConnection(config))
            .then((ok) => sendResponse({ ok }))
            .catch((err) => sendResponse({ ok: false, error: String(err) }));
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
