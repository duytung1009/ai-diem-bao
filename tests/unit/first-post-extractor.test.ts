import { describe, it, expect } from 'vitest';
import { extractFirstPostDescriptionSource, toThreadFirstPageUrl } from '@/lib/scrapers/first-post-extractor';

// Minimal XF2 page-1 markup mirroring voz.vn news threads:
// - OP (#1) carries an article-summary blockquote (empty data-source) + an unfurl block + a short comment
// - Reply (#2) carries a *reply* quote (data-source="post: ...") which must NOT be picked
const NEWS_HTML = `
<div class="block-container">
  <article class="message message--post js-post" data-author="OP Author" data-content="post-100" id="js-post-100">
    <div class="message-inner"><div class="message-cell message-cell--main"><div class="message-main">
      <div class="message-content">
        <div class="message-userContent">
          <article class="message-body js-selectToQuote">
            <div>
              <div class="bbWrapper">
                <blockquote data-attributes="" data-quote="" data-source="" class="bbCodeBlock bbCodeBlock--expandable bbCodeBlock--quote js-expandWatch">
                  <div class="bbCodeBlock-content">
                    <div class="bbCodeBlock-expandContent js-expandContent">
                      <h3 class="bbHeading">Ca sĩ Việt 15 tuổi cầu cứu, tố 'bị ép đi khách'</h3>Ca sĩ T.H.Đ (15 tuổi), thành viên nhóm nhạc V.S lên tiếng cầu cứu, tố lãnh đạo công ty bạo lực tinh thần, "ép đi khách".
                    </div>
                    <div class="bbCodeBlock-expandLink js-expandLink"><a role="button" tabindex="0">Click to expand...</a></div>
                  </div>
                </blockquote>
                <div class="bbCodeBlock bbCodeBlock--unfurl js-unfurl" data-url="https://znews.vn/abc.html"><div class="contentRow-snippet">unfurl noise</div></div>
                Ái chà chà!
              </div>
            </div>
          </article>
        </div>
      </div>
    </div></div></div>
  </article>
  <article class="message message--post js-post" data-author="Replier" data-content="post-200" id="js-post-200">
    <div class="message-content"><div class="message-userContent"><article class="message-body">
      <div itemprop="text"><div class="bbWrapper">
        <blockquote data-quote="OP Author" data-source="post: 100" class="bbCodeBlock bbCodeBlock--quote">
          <div class="bbCodeBlock-content"><div class="bbCodeBlock-expandContent">Ca sĩ nào nhỉ?</div></div>
        </blockquote>
        Đờm từ anh thợ cắt tóc lên ông hoàng nhạc Việt
      </div></div>
    </article></div></div>
  </article>
</div>`;

describe('extractFirstPostDescriptionSource', () => {
  it('picks the OP article-summary blockquote, not a reply quote', () => {
    const text = extractFirstPostDescriptionSource(NEWS_HTML);
    expect(text).toBeTruthy();
    expect(text).toContain('Ca sĩ Việt 15 tuổi cầu cứu');
    expect(text).toContain('ép đi khách');
  });

  it('strips the "Click to expand..." expand link', () => {
    const text = extractFirstPostDescriptionSource(NEWS_HTML)!;
    expect(text).not.toContain('Click to expand');
  });

  it('does not pick content from the reply post', () => {
    const text = extractFirstPostDescriptionSource(NEWS_HTML)!;
    expect(text).not.toContain('Đờm từ anh thợ cắt tóc');
  });

  it('falls back to OP own text when no article quote exists', () => {
    const html = `
      <article class="message message--post" data-content="post-1">
        <article class="message-body"><div><div class="bbWrapper">Thớt thảo luận thường, không phải tin tức nhưng đủ dài để mô tả.</div></div></article>
      </article>`;
    const text = extractFirstPostDescriptionSource(html);
    expect(text).toContain('Thớt thảo luận thường');
  });

  it('returns null when there is no article element', () => {
    expect(extractFirstPostDescriptionSource('<div>nothing here</div>')).toBeNull();
  });
});

describe('toThreadFirstPageUrl', () => {
  const base = 'https://voz.vn/t/ca-si-viet-15-tuoi.1251579';

  it('strips /page-N and the post anchor (last page link)', () => {
    expect(toThreadFirstPageUrl(`${base}/page-5#post-42516265`)).toBe(base);
  });

  it('strips /unread', () => {
    expect(toThreadFirstPageUrl(`${base}/unread`)).toBe(base);
  });

  it('strips /latest', () => {
    expect(toThreadFirstPageUrl(`${base}/latest`)).toBe(base);
  });

  it('strips a /post-xxx deep link', () => {
    expect(toThreadFirstPageUrl(`${base}/post-42516265`)).toBe(base);
  });

  it('keeps an already-base thread url (drops trailing slash)', () => {
    expect(toThreadFirstPageUrl(`${base}/`)).toBe(base);
  });

  it('handles the /threads/ path variant', () => {
    const t = 'https://example.com/threads/some-slug.999';
    expect(toThreadFirstPageUrl(`${t}/page-3`)).toBe(t);
  });

  it('drops query string', () => {
    expect(toThreadFirstPageUrl(`${base}/page-2?foo=bar`)).toBe(base);
  });
});
