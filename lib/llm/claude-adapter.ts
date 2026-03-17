import type { ScrapedPost, LLMConfig } from '../types';
import type { LLMProvider, LLMResponse } from './types';

export class ClaudeAdapter implements LLMProvider {
  constructor(private config: LLMConfig) {}

  async summarize(posts: ScrapedPost[], systemPrompt: string): Promise<LLMResponse> {
    const userContent = posts
      .map((p) => `[${p.author}] (#${p.postNumber}):\n${p.content}`)
      .join('\n\n---\n\n');

    const response = await this.chatCompletion([
      { role: 'user', content: userContent },
    ], systemPrompt);

    return response;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.chatCompletion(
        [{ role: 'user', content: 'Respond with "OK" only.' }],
        'You are a helpful assistant.',
      );
      return true;
    } catch {
      return false;
    }
  }

  private async chatCompletion(
    messages: Array<{ role: string; content: string }>,
    systemPrompt: string,
  ): Promise<LLMResponse> {
    // Get API key - for testing, use mock key if not configured
    const apiKey = this.config.apiKey || 'mock-claude-key-for-testing';

    if (apiKey === 'mock-claude-key-for-testing') {
      // Mock response for testing
      return this.generateMockResponse();
    }

    const url = 'https://api.anthropic.com/v1/messages';

    const requestBody = {
      model: this.config.model || 'claude-opus-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');

      if (res.status === 401) throw new Error('Claude API: Invalid API key');
      if (res.status === 429) throw new Error('Claude API: Rate limit exceeded');
      if (res.status === 529) throw new Error('Claude API: Service overloaded');

      throw new Error(`Claude API error ${res.status}: ${errorBody || res.statusText}`);
    }

    const data = await res.json();
    const content = data.content?.[0]?.text || '';

    return {
      content,
      tokensUsed: data.usage
        ? { prompt: data.usage.input_tokens, completion: data.usage.output_tokens }
        : undefined,
    };
  }

  private generateMockResponse(): LLMResponse {
    return {
      content: `## Tóm tắt
Đây là một bản tóm tắt mẫu từ Claude adapter (chế độ mock/test).

## Quan điểm nổi bật
### Quan điểm A
Nó được đại diện bởi nhiều người.
### Quan điểm B
Đây là một góc nhìn khác về vấn đề.

## Kết luận
Cuộc thảo luận cho thấy hai quan điểm chính đối chọi.`,
      tokensUsed: { prompt: 250, completion: 180 },
    };
  }
}
