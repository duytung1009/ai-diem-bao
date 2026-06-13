import type { NotebookEntry } from './types';

export function parseAnswerHtml(text: string, selectedEntryIds: string[]): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="badge badge-neutral font-mono">$1</code>')
    .replace(/\[(\d+)\]/g, (_, n) => {
      const entryId = selectedEntryIds[parseInt(n, 10) - 1];
      if (!entryId) return `[${n}]`;
      return `<button class="inline-flex items-center text-xs text-(--color-secondary) hover:underline font-medium" data-entry-id="${entryId}">[${n}]</button>`;
    })
    .replace(/\n/g, '<br>');
}

export function citedEntries(text: string, selectedEntryIds: string[], entryMap: Map<string, NotebookEntry>): NotebookEntry[] {
  const seen = new Set<string>();
  const result: NotebookEntry[] = [];
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = selectedEntryIds[parseInt(m[1], 10) - 1];
    if (id && !seen.has(id)) {
      seen.add(id);
      const entry = entryMap.get(id);
      if (entry) result.push(entry);
    }
  }
  return result;
}
