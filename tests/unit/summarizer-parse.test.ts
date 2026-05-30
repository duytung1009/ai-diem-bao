import { describe, it, expect } from 'vitest';
import { parseSummaryJSON } from '@/lib/llm/summarizer';
import type { SummaryJSON } from '@/lib/types';

const validSummary: SummaryJSON = {
  summary: 'Tóm tắt nội dung chính của topic.',
  opinions: [
    {
      title: 'Ủng hộ',
      description: 'Cho rằng phương án A là tốt nhất',
      supporters: ['user1', 'user2'],
      quotes: [{ author: 'user1', postNumber: 1, text: 'Tôi ủng hộ A.' }],
    },
    {
      title: 'Phản đối',
      description: 'Lo ngại về rủi ro',
      supporters: ['user3'],
      quotes: [{ author: 'user3', postNumber: 5, text: 'Rủi ro quá lớn.' }],
    },
  ],
  conclusion: 'Cần cân nhắc kỹ trước khi quyết định.',
};

describe('parseSummaryJSON', () => {
  it('parses valid plain JSON', () => {
    const result = parseSummaryJSON(JSON.stringify(validSummary));
    expect(result).not.toBeNull();
    expect(result?.summary).toBe(validSummary.summary);
    expect(result?.opinions).toHaveLength(2);
    expect(result?.conclusion).toBe(validSummary.conclusion);
  });

  it('parses triple-backtick fenced JSON', () => {
    const input = '```json\n' + JSON.stringify(validSummary) + '\n```';
    const result = parseSummaryJSON(input);
    expect(result).not.toBeNull();
    expect(result?.summary).toBe(validSummary.summary);
  });

  it('parses triple-backtick without json tag', () => {
    const input = '```\n' + JSON.stringify(validSummary) + '\n```';
    const result = parseSummaryJSON(input);
    expect(result).not.toBeNull();
    expect(result?.summary).toBe(validSummary.summary);
  });

  it('parses single-backtick wrapped JSON', () => {
    const input = '`' + JSON.stringify(validSummary) + '`';
    const result = parseSummaryJSON(input);
    expect(result).not.toBeNull();
    expect(result?.summary).toBe(validSummary.summary);
  });

  it('parses JSON with extra whitespace', () => {
    const input = '  \n  ' + JSON.stringify(validSummary) + '  \n  ';
    const result = parseSummaryJSON(input);
    expect(result).not.toBeNull();
    expect(result?.summary).toBe(validSummary.summary);
  });

  it('parses JSON with NBSP characters', () => {
    const input = JSON.stringify(validSummary).replace(/ /g, '\u00A0');
    const result = parseSummaryJSON(input);
    expect(result).not.toBeNull();
    expect(result?.summary).toBe(validSummary.summary);
  });

  it('parses JSON with invalid escape sequences', () => {
    const input = JSON.stringify(validSummary).replace(/"T/g, '"\\T');
    const result = parseSummaryJSON(input);
    expect(result).not.toBeNull();
  });

  it('preserves literal backslash in usernames with invalid escapes like \\o', () => {
    const json = '{"summary":"Tóm.","opinions":[{"title":"A","description":"d","supporters":["oo/\\oovoz"],"quotes":[]}],"conclusion":"Kết."}';
    const result = parseSummaryJSON(json);
    expect(result).not.toBeNull();
    expect(result?.opinions[0].supporters[0]).toBe('oo/\\oovoz');
  });

  it('repairs unescaped quotes inside string values', () => {
    const broken = '{"summary":"mục đích "cắm" tài sản","opinions":[],"conclusion":"kết luận"}';
    const result = parseSummaryJSON(broken);
    expect(result).not.toBeNull();
    expect(result?.summary).toContain('cắm');
  });

  it('repairs raw newlines inside string values', () => {
    const broken = '{"summary":"dòng 1\ndòng 2","opinions":[],"conclusion":"kết"}';
    const result = parseSummaryJSON(broken);
    expect(result).not.toBeNull();
    expect(result?.summary).toContain('dòng 1');
    expect(result?.summary).toContain('dòng 2');
  });

  it('repairs raw carriage returns inside string values', () => {
    const broken = '{"summary":"dòng 1\r\ndòng 2","opinions":[],"conclusion":"kết"}';
    const result = parseSummaryJSON(broken);
    expect(result).not.toBeNull();
  });

  it('returns null for completely invalid input', () => {
    const result = parseSummaryJSON('this is not json at all');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parseSummaryJSON('');
    expect(result).toBeNull();
  });

  it('returns null for JSON missing required fields', () => {
    const result = parseSummaryJSON('{"summary":"only summary"}');
    expect(result).toBeNull();
  });

  it('returns null for JSON with wrong types', () => {
    const input = JSON.stringify({
      summary: 123,
      opinions: 'not an array',
      conclusion: null,
    });
    const result = parseSummaryJSON(input);
    expect(result).toBeNull();
  });

  it('returns null for JSON with invalid opinion structure', () => {
    const input = JSON.stringify({
      summary: 'valid',
      opinions: [{ title: 123, supporters: 'not array', quotes: [] }],
      conclusion: 'valid',
    });
    const result = parseSummaryJSON(input);
    expect(result).toBeNull();
  });

  it('does not parse JSON with markdown text before fence', () => {
    const input = 'Dưới đây là kết quả:\n\n```json\n' + JSON.stringify(validSummary) + '\n```';
    const result = parseSummaryJSON(input);
    expect(result).toBeNull();
  });

  it('parses JSON with empty opinions array', () => {
    const minimal = { summary: 'Tóm tắt.', opinions: [], conclusion: 'Kết.' };
    const result = parseSummaryJSON(JSON.stringify(minimal));
    expect(result).not.toBeNull();
    expect(result?.opinions).toEqual([]);
  });

  it('parses JSON with complex nested quotes', () => {
    const complex: SummaryJSON = {
      summary: 'Thảo luận về "vấn đề A" và "giải pháp B".',
      opinions: [
        {
          title: 'Ý kiến "nóng"',
          description: 'Nhiều người cho rằng "cần phải" hành động ngay.',
          supporters: ['user "biệt danh"', 'user2'],
          quotes: [{ author: 'user1', postNumber: 1, text: '"Trích dẫn" quan trọng.' }],
        },
      ],
      conclusion: 'Kết luận "cuối cùng".',
    };
    const repaired = JSON.stringify(complex).replace(
      /"([^"]*)"/g,
      (match, content) => `"${content.replace(/"/g, '"')}"`,
    );
    const result = parseSummaryJSON(repaired);
    expect(result).not.toBeNull();
  });
});
