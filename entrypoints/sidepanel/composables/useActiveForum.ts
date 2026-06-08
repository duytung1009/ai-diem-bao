import { ref, readonly } from 'vue';

const forumUrl = ref('');
const detected = ref(false);
const detecting = ref(false);

export function useActiveForum() {
  async function detect(): Promise<string | null> {
    detecting.value = true;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return null;

      const result = await browser.tabs.sendMessage(tab.id, { type: 'GET_PAGE_URL' }) as { url: string } | undefined;
      if (!result?.url) return null;

      const url = new URL(result.url);
      const forumMatch = url.pathname.match(/\/(?:f|forums)\/([^/]+)/);
      const detectedUrl = forumMatch
        ? `${url.origin}/f/${forumMatch[1]}/`
        : `${url.origin}/f/diem-bao.33/`;

      forumUrl.value = detectedUrl;
      detected.value = true;
      return detectedUrl;
    } catch {
      return null;
    } finally {
      detecting.value = false;
    }
  }

  function setUrl(url: string) {
    forumUrl.value = url;
  }

  return {
    forumUrl: readonly(forumUrl),
    detected: readonly(detected),
    detecting: readonly(detecting),
    detect,
    setUrl,
  };
}
