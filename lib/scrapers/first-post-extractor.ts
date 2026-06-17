import { normalizeWhitespace } from '../text-utils';

/**
 * Normalize a XenForo thread URL to its page-1 form.
 *
 * Thread links in a forum listing may point at the last page or an unread/latest
 * anchor (e.g. `/t/slug.123/page-5#post-999`, `/t/slug.123/unread`,
 * `/t/slug.123/post-999`). Fetching those returns the *last* page, whose first
 * <article> is a reply — not the OP. Truncating the path at the thread id
 * (`/t/slug.123` or `/threads/slug.123`) reliably yields page 1.
 */
export function toThreadFirstPageUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const m = u.pathname.match(/^(.*?\/(?:t|threads)\/[^/]+\.\d+)/i);
    if (m) {
      u.pathname = m[1];
    } else {
      // Generic fallback for non-standard slugs
      u.pathname = u.pathname.replace(/\/(?:page-\d+|unread|latest|post-\d+)\/?$/i, '');
    }
    u.hash = '';
    u.search = '';
    return u.toString();
  } catch {
    return rawUrl.replace(/#.*$/, '').replace(/\/(?:page-\d+|unread|latest|post-\d+)\/?$/i, '');
  }
}

/**
 * Extract the best "description source" text from the first post (OP) of a thread,
 * given the raw page-1 HTML.
 *
 * For news threads on XenForo, the OP almost always contains a blockquote with the
 * article's own summary (title + lead paragraph) that the poster prepared. This is
 * the most accurate source for a one-line thread description — far better than the
 * OP's short personal comment or an unrelated reply.
 *
 * Distinguishing an *article-summary* quote from a *reply* quote:
 *   - reply quote  → data-source="post: 42516165"  (references another post)
 *   - article quote → data-source="" / absent       (no post reference)
 *
 * Falls back to the OP's own commentary text (quotes stripped) when no article
 * quote is present (non-news threads). Returns null if nothing usable is found.
 */
export function extractFirstPostDescriptionSource(html: string, maxLength = 3000): string | null {
  const safeHtml = html
    .replace(/<head\b[\s\S]*?(?=<body\b|<\/body\b)/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
  const doc = new DOMParser().parseFromString(safeHtml, 'text/html');

  // First real post = first <article> (ad blocks use <div class="message">, skipped)
  const firstArticle =
    doc.querySelector('article.message--post') ||
    doc.querySelector('article.message');
  if (!firstArticle) return null;

  const body = firstArticle.querySelector(
    '.message-body .bbWrapper, .messageContent .messageText, .messageText',
  );
  if (!body) return null;

  const clone = body.cloneNode(true) as HTMLElement;
  // Strip noise that pollutes textContent
  clone.querySelectorAll(
    '.bbCodeBlock--unfurl, .bbImageWrapper, .bbMediaWrapper, .smilie, ' +
    '.bbCodeSpoiler, .bbCodeBlock-expandLink, .message-signature, img, noscript',
  ).forEach(el => el.remove());

  const quotes = Array.from(clone.querySelectorAll('blockquote.bbCodeBlock--quote, blockquote.bbCodeQuote'));

  // Prefer the article-summary quote (no "post:" source reference)
  const articleQuote = quotes.find(q => !/post:/i.test(q.getAttribute('data-source') || ''));
  if (articleQuote) {
    const contentEl =
      articleQuote.querySelector('.bbCodeBlock-expandContent') ||
      articleQuote.querySelector('.bbCodeBlock-content') ||
      articleQuote;
    const text = normalizeWhitespace(contentEl.textContent || '');
    if (text.length >= 30) return text.length > maxLength ? text.slice(0, maxLength) : text;
  }

  // Fallback: OP's own text with all quotes removed
  quotes.forEach(q => q.remove());
  const opText = normalizeWhitespace(clone.textContent || '');
  if (opText.length === 0) return null;
  return opText.length > maxLength ? opText.slice(0, maxLength) : opText;
}
