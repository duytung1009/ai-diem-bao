import { normalizeWhitespace } from '../text-utils';

export interface ArticleContent {
  url: string;
  title: string;
  content: string;
  source: string;
}

const NOISE_SELECTORS = [
  'script', 'style', 'nav', 'header', 'footer', 'aside',
  '.sidebar', '.ads', '.advertisement', '.social-share',
  '.comments', '.related-posts', '.breadcrumb',
  '[class*="banner"]', '[class*="popup"]', '[id*="comment"]',
];

const ARTICLE_CONTENT_SELECTORS = [
  'article .content', 'article .body', '.article-content',
  '.article-body', '.post-content', '.entry-content',
  '.detail-content', '.fck_detail', '.content-detail',
  '.singular-content', '.td-post-content',
  'article', '[role="article"]', '.post-body',
  'main',
];

function stripAndParseHtml(html: string): Document {
  const safeHtml = html
    .replace(/<head\b[\s\S]*?(?=<body\b|<\/body\b)/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '');
  return new DOMParser().parseFromString(safeHtml, 'text/html');
}

/**
 * Extract main article text from pre-fetched HTML.
 * Can be called from the sidepanel (DOMParser available there).
 * Returns null if no meaningful content found.
 */
export function parseArticleHtml(html: string, maxLength = 3000): string | null {
  const doc = stripAndParseHtml(html);
  NOISE_SELECTORS.forEach(sel => doc.querySelectorAll(sel).forEach(el => el.remove()));

  let contentEl: Element | null = null;
  for (const sel of ARTICLE_CONTENT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && el.textContent!.trim().length > 200) {
      contentEl = el;
      break;
    }
  }

  if (!contentEl) {
    const candidates = doc.querySelectorAll('div, section');
    let maxLen = 0;
    for (const el of candidates) {
      const text = el.textContent?.trim() || '';
      if (text.length > maxLen && text.length > 200) {
        maxLen = text.length;
        contentEl = el;
      }
    }
  }

  if (!contentEl) return null;
  const raw = normalizeWhitespace(contentEl.textContent || '');
  return raw.length > maxLength ? raw.slice(0, maxLength) + '...' : raw;
}

/**
 * Extract main content from a news article URL.
 * Uses heuristic selectors common on Vietnamese and international news sites.
 * Called from the background service worker (has cross-origin fetch access).
 */
export async function extractArticle(url: string): Promise<ArticleContent | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        credentials: 'omit',
        headers: { Accept: 'text/html' },
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) return null;

    const html = await res.text();
    const content = parseArticleHtml(html);
    if (!content) return null;

    const doc = stripAndParseHtml(html);
    const title =
      doc.querySelector('h1')?.textContent?.trim() ||
      doc.querySelector('title')?.textContent?.trim() ||
      '';
    const source = new URL(url).hostname;

    return { url, title, content, source };
  } catch {
    return null;
  }
}
