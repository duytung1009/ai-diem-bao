export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\t/g, ' ')
    .replace(/ +/g, ' ')
    .replace(/\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim();
}

export function sanitizeQuotesForLLM(text: string): string {
  return text.replace(/"/g, '\u201C').replace(/"/g, '\u201D').replace(/"/g, '\u201C');
}
