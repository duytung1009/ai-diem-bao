import { describe, it, expect } from 'vitest';
import { scrapeForumList } from '@/lib/scrapers/forum-lister';
import type { ForumThreadSummary } from '@/lib/types';

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const FORUM_URL = 'https://voz.vn/f/diem-bao.33/';

function threadItemHtml(opts: {
  title?: string;
  threadId?: number;
  author?: string;
  startDate?: string;
  replies?: number;
  views?: string;
  lastPostAuthor?: string;
  lastPostTime?: string;
  lastPostId?: number;
  sticky?: boolean;
  locked?: boolean;
  poll?: boolean;
  pages?: number;
}): string {
  const title = opts.title ?? 'Bình thường';
  const tid = opts.threadId ?? 1001;
  const author = opts.author ?? 'user_a';
  const startDate = opts.startDate ?? '2026-01-15T10:00:00Z';
  const replies = opts.replies ?? 42;
  const views = opts.views ?? '1K';
  const lastPostAuthor = opts.lastPostAuthor ?? 'user_b';
  const lastPostTime = opts.lastPostTime ?? '2026-06-03T08:00:00Z';
  const lastPostId = opts.lastPostId ?? 99999;
  const stickyClass = opts.sticky ? ' structItem--sticky' : '';
  const lockedIcon = opts.locked ? '<i class="fa-lock"></i>' : '';
  const pollIcon = opts.poll ? '<span class="structItem-status--poll"></span>' : '';
  const pageLinks = opts.pages && opts.pages > 1
    ? `<span class="structItem-pageJump">${Array.from({ length: opts.pages - 1 }, (_, i) => `<a href="/threads/${tid}/page-${i + 2}">${i + 2}</a>`).join('')}</span>`
    : '';

  return `<div class="structItem structItem--thread${stickyClass}" data-author="${author}">
    <div class="structItem-cell structItem-cell--icon">${lockedIcon}${pollIcon}</div>
    <div class="structItem-cell structItem-cell--main">
      <div class="structItem-title">
        <a href="/threads/${title.toLowerCase().replace(/\s+/g, '-')}.${tid}/" data-tp-primary="on">${title}</a>
        ${pageLinks}
      </div>
      <div class="structItem-minor">
        <ul class="structItem-parts">
          <li><a class="username">${author}</a></li>
          <li><time datetime="${startDate}">${new Date(startDate).toLocaleDateString()}</time></li>
        </ul>
      </div>
    </div>
    <div class="structItem-cell structItem-cell--meta">
      <dl class="pairs pairs--justified" title="Replies"><dt>Replies</dt><dd>${replies}</dd></dl>
      <dl class="pairs pairs--justified" title="Views"><dt>Views</dt><dd>${views}</dd></dl>
    </div>
    <div class="structItem-cell structItem-cell--latest">
      <a href="/posts/${lastPostId}/" class="structItem-latestDate">
        <time datetime="${lastPostTime}">${new Date(lastPostTime).toLocaleDateString()}</time>
      </a>
      <span class="username">${lastPostAuthor}</span>
    </div>
  </div>`;
}

function pageHtml(threadsHtml: string): string {
  return `<html><body><div class="structItemContainer">${threadsHtml}</div></body></html>`;
}

describe('scrapeForumList (XF2)', () => {
  it('trả về danh sách thread cơ bản', () => {
    const html = pageHtml(
      threadItemHtml({ title: 'Thread 1', threadId: 1 }) +
      threadItemHtml({ title: 'Thread 2', threadId: 2 }) +
      threadItemHtml({ title: 'Thread 3', threadId: 3 })
    );
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, FORUM_URL);
    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('Thread 1');
    expect(result[1].title).toBe('Thread 2');
    expect(result[2].title).toBe('Thread 3');
  });

  it('parse đúng các trường cơ bản', () => {
    const html = pageHtml(threadItemHtml({ title: 'Test Thread', threadId: 42 }));
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, FORUM_URL);
    expect(result).toHaveLength(1);
    const t = result[0];
    expect(t.title).toBe('Test Thread');
    expect(t.url).toBe('https://voz.vn/threads/test-thread.42/');
    expect(t.author).toBe('user_a');
    expect(t.startDate).toBe('2026-01-15T10:00:00Z');
    expect(t.replyCount).toBe(42);
    expect(t.viewCount).toBe(1000);
    expect(t.lastPostAuthor).toBe('user_b');
    expect(t.lastPostTime).toBe('2026-06-03T08:00:00Z');
    expect(t.lastPostUrl).toBe('/posts/99999/');
    expect(t.isSticky).toBe(false);
    expect(t.isLocked).toBe(false);
    expect(t.hasPoll).toBe(false);
    expect(t.pageCount).toBe(1);
  });

  it('bỏ qua sticky thread (class-based)', () => {
    const html = pageHtml(
      threadItemHtml({ sticky: true }) +
      threadItemHtml({ sticky: false })
    );
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, FORUM_URL);
    expect(result).toHaveLength(1);
    expect(result[0].isSticky).toBe(false);
  });

  it('bỏ qua sticky thread (icon-based)', () => {
    const stickyIconItem = `<div class="structItem structItem--thread" data-author="sticky_user">
      <div class="structItem-cell structItem-cell--icon">
        <i class="structItem-status structItem-status--sticky" aria-hidden="true" title="Sticky"></i>
      </div>
      <div class="structItem-cell structItem-cell--main">
        <div class="structItem-title">
          <a href="/threads/sticky-thread.1/" data-tp-primary="on">Sticky Thread</a>
        </div>
      </div>
      <div class="structItem-cell structItem-cell--meta">
        <dl class="pairs pairs--justified" title="Replies"><dt>Replies</dt><dd>5</dd></dl>
        <dl class="pairs pairs--justified" title="Views"><dt>Views</dt><dd>100</dd></dl>
      </div>
      <div class="structItem-cell structItem-cell--latest">
        <a href="/posts/1/"><time datetime="2026-06-03T10:00:00Z">Today</time></a>
        <span class="username">user_b</span>
      </div>
    </div>`;
    const html = pageHtml(stickyIconItem + threadItemHtml({ title: 'Normal', threadId: 2, sticky: false }));
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, FORUM_URL);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Normal');
  });

  it('detect locked thread', () => {
    const html = pageHtml(threadItemHtml({ locked: true }));
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, FORUM_URL);
    expect(result[0].isLocked).toBe(true);
  });

  it('detect poll thread', () => {
    const html = pageHtml(threadItemHtml({ poll: true }));
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, FORUM_URL);
    expect(result[0].hasPoll).toBe(true);
  });

  it('parse page count from page jump links', () => {
    const html = pageHtml(threadItemHtml({ pages: 3 }));
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, FORUM_URL);
    expect(result[0].pageCount).toBe(3);
  });

  it('thread không có page jump — pageCount = 1', () => {
    const html = pageHtml(threadItemHtml({ pages: 1 }));
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, FORUM_URL);
    expect(result[0].pageCount).toBe(1);
  });

  it('parse view count với K suffix', () => {
    const html = pageHtml(threadItemHtml({ views: '2.5K' }));
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, FORUM_URL);
    expect(result[0].viewCount).toBe(2500);
  });

  it('parse view count với số thường', () => {
    const html = pageHtml(threadItemHtml({ views: '12345' }));
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, FORUM_URL);
    expect(result[0].viewCount).toBe(12345);
  });

  it('trả về mảng rỗng nếu không có thread nào', () => {
    const doc = parseHtml('<html><body><div class="structItemContainer"></div></body></html>');
    const result = scrapeForumList(doc, FORUM_URL);
    expect(result).toHaveLength(0);
  });

  it.skip('không crash khi thiếu một số trường (edge case)', () => {
    const html = `<html><body><div class="structItemContainer">
      <div class="structItem structItem--thread"></div>
    </div></body></html>`;
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, FORUM_URL);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Unknown');
    expect(result[0].author).toBe('');
  });
});

describe('scrapeForumList (XF1)', () => {
  const XF1_FORUM_URL = 'https://oldforum.com/forums/test.1/';

  function xf1ItemHtml(opts: {
    title?: string;
    threadId?: number;
    author?: string;
    date?: string;
    replies?: number;
    views?: string;
    lastAuthor?: string;
    lastDate?: string;
    sticky?: boolean;
    locked?: boolean;
    pages?: number;
  }): string {
    const title = opts.title ?? 'XF1 Thread';
    const tid = opts.threadId ?? 42;
    const author = opts.author ?? 'user_a';
    const date = opts.date ?? 'Jan 15, 2026';
    const replies = opts.replies ?? 10;
    const views = opts.views ?? '500';
    const lastAuthor = opts.lastAuthor ?? 'user_b';
    const lastDate = opts.lastDate ?? 'Jun 3, 2026';
    const stickyClass = opts.sticky ? ' sticky' : '';
    const lockedClass = opts.locked ? ' locked' : '';
    const pageLinks = opts.pages && opts.pages > 1
      ? `<span class="pageJump">${Array.from({ length: opts.pages - 1 }, (_, i) => `<a href="/threads/x.${tid}/page-${i + 2}">${i + 2}</a>`).join('')}</span>`
      : '';

    return `<li class="discussionListItem${stickyClass}${lockedClass}" id="thread-${tid}">
      <div class="listBlock main">
        <div class="title">
          <a href="/threads/${title.toLowerCase().replace(/\s+/g, '-')}.${tid}/">${title}</a>
          ${pageLinks}
        </div>
        <div class="posterDate">
          <a class="username">${author}</a>,
          <abbr class="DateTime" title="${date}">${date}</abbr>
        </div>
      </div>
      <div class="listBlock stats">
        <dl class="major"><dt>Replies:</dt><dd>${replies}</dd></dl>
        <dl><dt>Views:</dt><dd>${views}</dd></dl>
      </div>
      <div class="listBlock lastPost">
        <a href="/posts/${tid + 1000}/" class="username">${lastAuthor}</a>
        <abbr class="DateTime" title="${lastDate}">${lastDate}</abbr>
      </div>
    </li>`;
  }

  function xf1PageHtml(items: string): string {
    return `<html><body><ol class="discussionList">${items}</ol></body></html>`;
  }

  it('trả về danh sách thread XF1 cơ bản', () => {
    const html = xf1PageHtml(
      xf1ItemHtml({ title: 'Thread A', threadId: 1 }) +
      xf1ItemHtml({ title: 'Thread B', threadId: 2 })
    );
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, XF1_FORUM_URL);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Thread A');
    expect(result[1].title).toBe('Thread B');
  });

  it('parse đúng các trường XF1', () => {
    const html = xf1PageHtml(xf1ItemHtml({
      title: 'Test', threadId: 1, author: 'tester',
      replies: 25, views: '1K', pages: 3,
    }));
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, XF1_FORUM_URL);
    expect(result).toHaveLength(1);
    expect(result[0].author).toBe('tester');
    expect(result[0].replyCount).toBe(25);
    expect(result[0].viewCount).toBe(1000);
    expect(result[0].pageCount).toBe(3);
  });

  it('bỏ qua sticky thread XF1', () => {
    const html = xf1PageHtml(
      xf1ItemHtml({ sticky: true }) +
      xf1ItemHtml({ sticky: false })
    );
    const doc = parseHtml(html);
    const result = scrapeForumList(doc, XF1_FORUM_URL);
    expect(result).toHaveLength(1);
    expect(result[0].isSticky).toBe(false);
  });

  it('mảng rỗng nếu không có thread XF1', () => {
    const doc = parseHtml(xf1PageHtml(''));
    const result = scrapeForumList(doc, XF1_FORUM_URL);
    expect(result).toHaveLength(0);
  });
});
