import type { ScrapedPost } from '../types';

export function mergeAbortSignals(...signals: (AbortSignal | undefined)[]): AbortController {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) { ctrl.abort(s.reason); break; }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl;
}

const LEFT_DQ = '\u201C';
const RIGHT_DQ = '\u201D';

export function formatPostsForLLM(posts: ScrapedPost[]): string {
  return posts
    .map((p) => `[${p.author}] (#${p.postNumber}):\n${sanitizeQuotes(p.content)}`)
    .join('\n\n---\n\n');
}

function sanitizeQuotes(text: string): string {
  return text.replace(/"/g, LEFT_DQ).replace(/"/g, RIGHT_DQ).replace(/"/g, LEFT_DQ);
}
