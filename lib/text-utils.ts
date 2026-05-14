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
