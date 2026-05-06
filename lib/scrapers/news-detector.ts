import type { ScrapedPost } from '../types';

export interface NewsDetection {
  isNews: boolean;
  articleUrls: string[];
}

/**
 * Extract root domain (last 2 labels, stripping leading "www.") for comparison.
 * Example: "www.voz.vn" → "voz.vn",  "sub.forum.example.com" → "example.com"
 */
function rootDomain(hostname: string): string {
  const clean = hostname.replace(/^www\./, '');
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;
  return parts.slice(-2).join('.');
}

/**
 * Analyze the first post to detect if this is a news discussion thread.
 * Heuristic: OP has external URLs + content is relatively short (< 800 words).
 */
export function detectNewsThread(posts: ScrapedPost[], forumDomain: string): NewsDetection {
  if (posts.length === 0) return { isNews: false, articleUrls: [] };

  // Get first post (lowest positive postNumber)
  const firstPost = posts.reduce((min, p) =>
    (p.postNumber > 0 && (min.postNumber === 0 || p.postNumber < min.postNumber)) ? p : min,
    posts[0],
  );

  const forumRoot = rootDomain(forumDomain);

  // Extract URLs from first post content
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
  const urls = (firstPost.content.match(urlRegex) || []).filter(url => {
    try {
      const hostname = new URL(url).hostname;
      if (rootDomain(hostname) === forumRoot) return false;
      if (/\.(jpg|jpeg|png|gif|webp|svg|mp4|mp3)$/i.test(url)) return false;
      if (/facebook\.com\/sharer|twitter\.com\/intent/i.test(url)) return false;
      return true;
    } catch {
      return false;
    }
  });

  if (urls.length === 0) return { isNews: false, articleUrls: [] };

  // Likely news thread: has external URLs
  const isLikelyNews = urls.length >= 1;

  return {
    isNews: isLikelyNews,
    articleUrls: urls.slice(0, 3),
  };
}
