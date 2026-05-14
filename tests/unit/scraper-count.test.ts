import { describe, it, expect } from 'vitest';
import { XF2Scraper } from '@/lib/scrapers/xf2-scraper';
import { XF1Scraper } from '@/lib/scrapers/xf1-scraper';
import { deduplicateAndSort } from '@/lib/scrapers/page-loader';
import type { ScrapedPost } from '@/lib/types';

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

// ── XF2 fixtures ──

function xf2PostHtml(author: string, postNum: number, contentHtml: string, timestamp?: string): string {
  const ts = timestamp ?? '2024-01-15T10:00:00Z';
  return `<article class="message" data-content="post-${postNum}">
    <div class="message-name"><a>${author}</a></div>
    <div class="message-body"><div class="bbWrapper">${contentHtml}</div></div>
    <div class="message-attribution-opposite"><a href="/t/topic.123/#post-${postNum}">#${postNum}</a></div>
    <time datetime="${ts}">${ts}</time>
  </article>`;
}

function xf2PageHtml(postsHtml: string): string {
  return `<html><body>${postsHtml}</body></html>`;
}

// ── XF1 fixtures ──

function xf1PostHtml(author: string, postNum: number, contentHtml: string, timestamp?: string): string {
  const ts = timestamp ?? 'Jan 15, 2024';
  return `<li class="message" id="post-${postNum}" data-author="${author}">
    <div class="messageContent"><div class="messageText">${contentHtml}</div></div>
    <a class="postNumber">#${postNum}</a>
    <abbr class="DateTime" title="${ts}">${ts}</abbr>
  </li>`;
}

function xf1PageHtml(postsHtml: string): string {
  return `<html><body>${postsHtml}</body></html>`;
}

// ── Content variants ──

const TEXT_ONLY = 'Bài viết bình thường với nội dung text.';
const IMAGE_ONLY = '<img src="https://example.com/image.jpg" alt="photo" />';
const EMOJI_ONLY = '🎉🔥💯';
const EMBED_MEDIA_ONLY = '<div class="bbMediaWrapper"><div class="bbMediaWrapper-inner"><a href="https://youtube.com/watch?v=xxx">YouTube</a></div></div>';
const QUOTE_ONLY = '<div class="bbCodeBlock--quote"><div class="bbCodeBlock-title">Quote</div><blockquote>Nội dung quote</blockquote></div>';
const SIGNATURE_ONLY = '<div class="message-signature">Signature text</div>';
const MIXED = '<p>Some text</p><div class="bbMediaWrapper">...</div><p>More text</p>';

describe('XF2Scraper: scrapePosts trả về đúng tổng số posts', () => {
  const scraper = new XF2Scraper();

  it('posts text bình thường — không mất post nào', () => {
    const html = xf2PageHtml(
      xf2PostHtml('user_a', 1, TEXT_ONLY) +
      xf2PostHtml('user_b', 2, TEXT_ONLY) +
      xf2PostHtml('user_c', 3, TEXT_ONLY)
    );
    const doc = parseHtml(html);
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(3);
    expect(posts[0].postNumber).toBe(1);
    expect(posts[1].postNumber).toBe(2);
    expect(posts[2].postNumber).toBe(3);
  });

  it('post chỉ có image — không bị filter content.trim() loại bỏ', () => {
    const html = xf2PageHtml(
      xf2PostHtml('user_a', 1, TEXT_ONLY) +
      xf2PostHtml('image_post', 2, IMAGE_ONLY) +
      xf2PostHtml('user_b', 3, TEXT_ONLY)
    );
    const doc = parseHtml(html);
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(3);
    expect(posts[0].postNumber).toBe(1);
    expect(posts[1].postNumber).toBe(2);
    expect(posts[1].author).toBe('image_post');
    expect(posts[2].postNumber).toBe(3);
  });

  it('post chỉ có emoji — không bị filter content.trim() loại bỏ', () => {
    const html = xf2PageHtml(
      xf2PostHtml('user_a', 1, TEXT_ONLY) +
      xf2PostHtml('emoji_guy', 2, EMOJI_ONLY)
    );
    const doc = parseHtml(html);
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(2);
    expect(posts[1].content).toBe(EMOJI_ONLY);
  });

  it('post chỉ có embed media — không bị filter content.trim() loại bỏ dù nội dung bị strip', () => {
    const html = xf2PageHtml(
      xf2PostHtml('user_a', 1, TEXT_ONLY) +
      xf2PostHtml('media_guy', 2, EMBED_MEDIA_ONLY) +
      xf2PostHtml('user_b', 3, TEXT_ONLY)
    );
    const doc = parseHtml(html);
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(3);
  });

  it('post chỉ có quote — không bị filter content.trim() loại bỏ dù quote bị strip', () => {
    const html = xf2PageHtml(
      xf2PostHtml('user_a', 1, TEXT_ONLY) +
      xf2PostHtml('quote_guy', 2, QUOTE_ONLY) +
      xf2PostHtml('user_b', 3, TEXT_ONLY)
    );
    const doc = parseHtml(html);
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(3);
  });

  it('post chỉ có signature — không bị filter dù signature bị strip', () => {
    const html = xf2PageHtml(
      xf2PostHtml('user_a', 1, TEXT_ONLY) +
      xf2PostHtml('sig_guy', 2, SIGNATURE_ONLY)
    );
    const doc = parseHtml(html);
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(2);
  });

  it('50 posts text bình thường — giữ đúng số lượng', () => {
    let postsHtml = '';
    for (let i = 1; i <= 50; i++) {
      postsHtml += xf2PostHtml(`user_${i}`, i, TEXT_ONLY);
    }
    const doc = parseHtml(xf2PageHtml(postsHtml));
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(50);
  });

  it('50 posts hỗn hợp (text, image, emoji, media) — giữ đúng số lượng', () => {
    const contents = [TEXT_ONLY, IMAGE_ONLY, EMOJI_ONLY, EMBED_MEDIA_ONLY, QUOTE_ONLY];
    let postsHtml = '';
    for (let i = 1; i <= 50; i++) {
      postsHtml += xf2PostHtml(`user_${i}`, i, contents[i % contents.length]);
    }
    const doc = parseHtml(xf2PageHtml(postsHtml));
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(50);
  });
});

describe('XF1Scraper: scrapePosts trả về đúng tổng số posts', () => {
  const scraper = new XF1Scraper();

  it('posts text bình thường — không mất post nào', () => {
    const html = xf1PageHtml(
      xf1PostHtml('user_a', 1, TEXT_ONLY) +
      xf1PostHtml('user_b', 2, TEXT_ONLY)
    );
    const doc = parseHtml(html);
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(2);
  });

  it('post chỉ có image — không bị filter content.trim() loại bỏ', () => {
    const html = xf1PageHtml(
      xf1PostHtml('user_a', 1, TEXT_ONLY) +
      xf1PostHtml('image_post', 2, IMAGE_ONLY) +
      xf1PostHtml('user_b', 3, TEXT_ONLY)
    );
    const doc = parseHtml(html);
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(3);
  });

  it('post chỉ có quote — không bị filter dù quote bị strip', () => {
    const html = xf1PageHtml(
      xf1PostHtml('user_a', 1, TEXT_ONLY) +
      xf1PostHtml('quote_guy', 2, QUOTE_ONLY.replace(/bbCodeBlock--quote/g, 'bbCodeQuote'))
    );
    const doc = parseHtml(html);
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(2);
  });

  it('post chỉ có media — không bị filter dù media bị strip', () => {
    const html = xf1PageHtml(
      xf1PostHtml('media_guy', 1, EMBED_MEDIA_ONLY)
    );
    const doc = parseHtml(html);
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(1);
  });

  it('50 posts hỗn hợp — giữ đúng số lượng', () => {
    const contents = [TEXT_ONLY, IMAGE_ONLY, EMOJI_ONLY, EMBED_MEDIA_ONLY, QUOTE_ONLY];
    let postsHtml = '';
    for (let i = 1; i <= 50; i++) {
      postsHtml += xf1PostHtml(`user_${i}`, i, contents[i % contents.length]);
    }
    const doc = parseHtml(xf1PageHtml(postsHtml));
    const posts = scraper.scrapePosts(doc);
    expect(posts).toHaveLength(50);
  });
});

describe('deduplicateAndSort: giữ đúng tổng số posts duy nhất', () => {
  it('không có trùng — giữ nguyên số lượng', () => {
    const posts: ScrapedPost[] = [
      { author: 'a', content: '1', timestamp: '', postNumber: 1 },
      { author: 'b', content: '2', timestamp: '', postNumber: 2 },
      { author: 'c', content: '3', timestamp: '', postNumber: 3 },
    ];
    expect(deduplicateAndSort(posts)).toHaveLength(3);
  });

  it('có trùng postNumber — chỉ giữ bản đầu tiên, số giảm tương ứng', () => {
    const posts: ScrapedPost[] = [
      { author: 'a', content: 'original', timestamp: '', postNumber: 1 },
      { author: 'a', content: 'duplicate', timestamp: '', postNumber: 1 },
      { author: 'b', content: '2', timestamp: '', postNumber: 2 },
    ];
    const result = deduplicateAndSort(posts);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('original');
  });

  it('postNumber=0 luôn được giữ (không bị dedup)', () => {
    const posts: ScrapedPost[] = [
      { author: 'a', content: 'post a', timestamp: '', postNumber: 0 },
      { author: 'b', content: 'post b', timestamp: '', postNumber: 0 },
      { author: 'c', content: 'post c', timestamp: '', postNumber: 1 },
    ];
    expect(deduplicateAndSort(posts)).toHaveLength(3);
  });

  it('không lọc theo content — content rỗng vẫn được giữ', () => {
    const posts: ScrapedPost[] = [
      { author: 'a', content: '', timestamp: '', postNumber: 1 },
      { author: 'b', content: 'non-empty', timestamp: '', postNumber: 2 },
    ];
    const result = deduplicateAndSort(posts);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('');
  });
});
