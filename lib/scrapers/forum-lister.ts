import type { ForumThreadSummary } from '../types';

function parseViewCount(text: string): number {
  const clean = text.replace(/,/g, '').trim().toLowerCase();
  if (clean.endsWith('k')) {
    const n = parseFloat(clean.slice(0, -1));
    return isNaN(n) ? 0 : Math.round(n * 1000);
  }
  if (clean.endsWith('m')) {
    const n = parseFloat(clean.slice(0, -1));
    return isNaN(n) ? 0 : Math.round(n * 1000000);
  }
  const n = parseInt(clean.replace(/\./g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// ── XF2 helpers ──

function xf2ExtractPageCount(item: Element): number {
  const pageJump = item.querySelector<HTMLElement>('.structItem-pageJump');
  if (!pageJump) return 1;
  const links = pageJump.querySelectorAll('a');
  if (links.length === 0) return 1;
  let maxPage = 1;
  links.forEach((a) => {
    const n = parseInt(a.textContent?.trim() || '', 10);
    if (!isNaN(n) && n > maxPage) maxPage = n;
  });
  return maxPage;
}

function xf2ExtractReplyCount(item: Element): number {
  const dds = item.querySelectorAll<HTMLElement>('.structItem-cell--meta dd');
  if (dds.length >= 1) {
    const n = parseInt(dds[0].textContent?.trim().replace(/[,.]/g, '') || '', 10);
    if (!isNaN(n)) return n;
  }
  return 0;
}

function xf2ExtractViewCount(item: Element): number {
  const dds = item.querySelectorAll<HTMLElement>('.structItem-cell--meta dd');
  if (dds.length >= 2) {
    return parseViewCount(dds[1].textContent?.trim() || '');
  }
  return 0;
}

function xf2ExtractLastPost(item: Element): { author: string; time: string; url?: string } {
  const latest = item.querySelector<HTMLElement>('.structItem-cell--latest');
  if (!latest) return { author: '', time: '' };

  const authorEl = latest.querySelector<HTMLElement>('.username');
  const author = authorEl?.textContent?.trim() || '';

  const timeEl = latest.querySelector<HTMLTimeElement>('time');
  const time = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';

  const postLink = latest.querySelector<HTMLAnchorElement>('a[href*="/posts/"], a[href*="/post-"]');
  const url = postLink?.getAttribute('href') || undefined;

  return { author, time, url };
}

function xf2ExtractTitleAndUrl(item: Element, forumUrl: string): { title: string; url: string } {
  const titleLink = item.querySelector<HTMLAnchorElement>(
    '.structItem-title a[data-tp-primary="on"]',
  ) || item.querySelector<HTMLAnchorElement>(
    '.structItem-title a:not(.labelLink)',
  );
  if (!titleLink) return { title: 'Unknown', url: forumUrl };

  const title = titleLink.textContent?.trim() || 'Unknown';
  const href = titleLink.getAttribute('href') || '';
  const url = href.startsWith('http') ? href : new URL(href, forumUrl).toString();

  return { title, url };
}

function xf2ExtractAuthorAndDate(item: Element, baseUrl: string): { author: string; authorUrl?: string; startDate: string } {
  const attr = item.getAttribute('data-author');
  if (attr) {
    const minor = item.querySelector<HTMLElement>('.structItem-minor .structItem-parts');
    const timeEl = minor?.querySelector<HTMLTimeElement>('time[datetime]');
    const date = timeEl?.getAttribute('datetime') || '';
    return { author: attr.trim(), authorUrl: undefined, startDate: date };
  }

  const parts = item.querySelector<HTMLElement>('.structItem-minor .structItem-parts');
  if (!parts) return { author: '', startDate: '' };

  const authorLi = parts.querySelector('li:first-child');
  const authorEl = authorLi?.querySelector<HTMLAnchorElement>('a');
  const author = authorEl?.textContent?.trim() || '';
  const authorHref = authorEl?.getAttribute('href') || undefined;
  const authorUrl = authorHref
    ? (authorHref.startsWith('http') ? authorHref : new URL(authorHref, baseUrl).toString())
    : undefined;

  const dateLi = parts.querySelector('li:last-child');
  const timeEl = dateLi?.querySelector<HTMLTimeElement>('time[datetime]');
  const startDate = timeEl?.getAttribute('datetime') || '';

  return { author, authorUrl, startDate };
}

function scrapeXf2(doc: Document, forumUrl: string): ForumThreadSummary[] {
  const items = doc.querySelectorAll<HTMLElement>('.structItem--thread');
  const threads: ForumThreadSummary[] = [];

  items.forEach((item) => {
    try {
      const isSticky =
        item.classList.contains('structItem--sticky') ||
        !!item.querySelector('.structItem-status--sticky');
      if (isSticky) return;

      const { title, url } = xf2ExtractTitleAndUrl(item, forumUrl);
      const { author, authorUrl, startDate } = xf2ExtractAuthorAndDate(item, forumUrl);

      const replyCount = xf2ExtractReplyCount(item);
      const viewCount = xf2ExtractViewCount(item);
      const { author: lastPostAuthor, time: lastPostTime, url: lastPostUrl } = xf2ExtractLastPost(item);
      const pageCount = xf2ExtractPageCount(item);

      const isLocked = !!item.querySelector('.fa-lock, .structItem-status--locked');
      const hasPoll = !!item.querySelector('.structItem-status--poll');

      threads.push({
        title, url, author,
        authorUrl: authorUrl || undefined,
        startDate, replyCount, viewCount,
        lastPostAuthor, lastPostTime, lastPostUrl,
        isSticky: false, isLocked, pageCount, hasPoll,
        version: 'xf2',
      });
    } catch (err) {
      console.warn('[scrapeXf2] Failed to parse thread item:', err);
    }
  });

  return threads;
}

// ── XF1 helpers ──

function xf1ExtractTitleAndUrl(item: Element, forumUrl: string): { title: string; url: string } {
  const titleLink = item.querySelector<HTMLAnchorElement>('.title a');
  if (!titleLink) return { title: 'Unknown', url: forumUrl };

  const title = titleLink.textContent?.trim() || 'Unknown';
  const href = titleLink.getAttribute('href') || '';
  const url = href.startsWith('http') ? href : new URL(href, forumUrl).toString();

  return { title, url };
}

function xf1ExtractAuthorAndDate(item: Element): { author: string; startDate: string } {
  const posterDate = item.querySelector<HTMLElement>('.posterDate, .startDate');
  if (!posterDate) return { author: '', startDate: '' };

  const authorEl = posterDate.querySelector<HTMLAnchorElement>('a.username, a');
  const author = authorEl?.textContent?.trim() || '';

  const dateAbbr = posterDate.querySelector<HTMLElement>('abbr.DateTime, .DateTime');
  const startDate = dateAbbr?.getAttribute('title') || dateAbbr?.getAttribute('data-time') || dateAbbr?.textContent?.trim() || '';

  return { author, startDate };
}

function xf1ExtractReplyCount(item: Element): number {
  const stats = item.querySelector<HTMLElement>('.stats, .discussionListItem--stats');
  if (!stats) return 0;

  const dd = stats.querySelector('dl.major dd, dl dd:first-of-type');
  if (dd) {
    const n = parseInt(dd.textContent?.trim().replace(/[,.]/g, '') || '', 10);
    if (!isNaN(n)) return n;
  }
  return 0;
}

function xf1ExtractViewCount(item: Element): number {
  const stats = item.querySelector<HTMLElement>('.stats, .discussionListItem--stats');
  if (!stats) return 0;

  const dds = stats.querySelectorAll('dl dd');
  if (dds.length >= 2) {
    return parseViewCount(dds[1].textContent?.trim() || '');
  }
  return 0;
}

function xf1ExtractLastPost(item: Element): { author: string; time: string } {
  const lastPost = item.querySelector<HTMLElement>('.lastPostInfo, .discussionListItem--lastPost');
  if (!lastPost) return { author: '', time: '' };

  const authorEl = lastPost.querySelector<HTMLAnchorElement>('a.username');
  const author = authorEl?.textContent?.trim() || '';

  const dateAbbr = lastPost.querySelector<HTMLElement>('abbr.DateTime, abbr');
  const time = dateAbbr?.getAttribute('title') || dateAbbr?.getAttribute('data-time') || dateAbbr?.textContent?.trim() || '';

  return { author, time };
}

function xf1ExtractPageCount(item: Element): number {
  const pageJump = item.querySelector<HTMLElement>('.pageJump, .PageJump');
  if (!pageJump) return 1;
  let maxPage = 1;
  pageJump.querySelectorAll('a').forEach((a) => {
    const n = parseInt(a.textContent?.trim() || '', 10);
    if (!isNaN(n) && n > maxPage) maxPage = n;
  });
  return maxPage;
}

function scrapeXf1(doc: Document, forumUrl: string): ForumThreadSummary[] {
  const items = doc.querySelectorAll<HTMLElement>('.discussionListItem');
  const threads: ForumThreadSummary[] = [];

  items.forEach((item) => {
    try {
      const isSticky = item.classList.contains('sticky') || item.classList.contains('discussionListItem--sticky');
      if (isSticky) return;

      const { title, url } = xf1ExtractTitleAndUrl(item, forumUrl);
      const { author, startDate } = xf1ExtractAuthorAndDate(item);

      const replyCount = xf1ExtractReplyCount(item);
      const viewCount = xf1ExtractViewCount(item);
      const { author: lastPostAuthor, time: lastPostTime } = xf1ExtractLastPost(item);
      const pageCount = xf1ExtractPageCount(item);

      const isLocked = item.classList.contains('locked') || !!item.querySelector('.fa-lock');

      threads.push({
        title, url, author, startDate, replyCount, viewCount,
        lastPostAuthor, lastPostTime,
        isSticky: false, isLocked, pageCount,
        version: 'xf1',
      });
    } catch (err) {
      console.warn('[scrapeXf1] Failed to parse thread item:', err);
    }
  });

  return threads;
}

// ── Main export ──

export function scrapeForumList(doc: Document, forumUrl: string): ForumThreadSummary[] {
  if (doc.querySelector('.structItem--thread')) {
    return scrapeXf2(doc, forumUrl);
  }
  if (doc.querySelector('.discussionListItem')) {
    return scrapeXf1(doc, forumUrl);
  }
  return [];
}

export function scrapeForumListXF1(doc: Document, forumUrl: string): ForumThreadSummary[] {
  return scrapeXf1(doc, forumUrl);
}
