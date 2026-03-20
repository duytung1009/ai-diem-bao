export interface ArticleContent {
  url: string;
  title: string;
  content: string;
  source: string;
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
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove noise elements
    const removeSelectors = [
      'script', 'style', 'nav', 'header', 'footer', 'aside',
      '.sidebar', '.ads', '.advertisement', '.social-share',
      '.comments', '.related-posts', '.breadcrumb',
      '[class*="banner"]', '[class*="popup"]', '[id*="comment"]',
    ];
    removeSelectors.forEach(sel =>
      doc.querySelectorAll(sel).forEach(el => el.remove()),
    );

    // Try common article content selectors (including Vietnamese news sites)
    const articleSelectors = [
      'article .content', 'article .body', '.article-content',
      '.article-body', '.post-content', '.entry-content',
      '.detail-content', '.fck_detail', '.content-detail',
      '.singular-content', '.td-post-content',
      'article', '[role="article"]', '.post-body',
      'main',
    ];

    let contentEl: Element | null = null;
    for (const sel of articleSelectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent!.trim().length > 200) {
        contentEl = el;
        break;
      }
    }

    // Fallback: find the largest text block
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

    const title =
      doc.querySelector('h1')?.textContent?.trim() ||
      doc.querySelector('title')?.textContent?.trim() ||
      '';

    const rawContent = contentEl.textContent?.trim() || '';
    const content = rawContent.length > 3000 ? rawContent.slice(0, 3000) + '...' : rawContent;

    const source = new URL(url).hostname;

    return { url, title, content, source };
  } catch {
    return null;
  }
}
