import type { ScrapedPost, LLMConfig } from '../types';
import type { LLMProvider, LLMResponse } from './types';
import { llmErrorFromStatus } from '../errors';
import { withRetry } from './retry';

export class OpenAIAdapter implements LLMProvider {
  constructor(private config: LLMConfig) {}

  async summarize(posts: ScrapedPost[], systemPrompt: string): Promise<LLMResponse> {
    const userContent = posts
      .map((p) => `[${p.author}] (#${p.postNumber}):\n${p.content}`)
      .join('\n\n---\n\n');

    const response = await this.chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]);

    return response;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.chatCompletion([
        { role: 'user', content: 'Respond with "OK" only.' },
      ]);
      return true;
    } catch {
      return false;
    }
  }

  private async chatCompletion(
    messages: Array<{ role: string; content: string }>,
  ): Promise<LLMResponse> {
    return withRetry(async () => {
      const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
      const url = `${baseUrl}/chat/completions`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: this.config.temperature,
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw llmErrorFromStatus(res.status, errorBody);
      }

      const data = await res.json();
      return {
        content: data.choices?.[0]?.message?.content || '',
        tokensUsed: data.usage
          ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens }
          : undefined,
      };
    });
  }
}
