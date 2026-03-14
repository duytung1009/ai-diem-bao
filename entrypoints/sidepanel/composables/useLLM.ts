import { ref } from 'vue';
import { sendMessage } from '@/lib/messaging';
import type { ScrapedPost } from '@/lib/types';

export function useLLM() {
  const isLoading = ref(false);
  const error = ref('');
  const progress = ref('');

  async function summarize(posts: ScrapedPost[]): Promise<string | null> {
    isLoading.value = true;
    error.value = '';
    progress.value = 'Đang tóm tắt...';

    try {
      const result = await sendMessage<{ summary?: string; error?: string }>(
        'SUMMARIZE',
        posts,
      );
      if (result.error) throw new Error(result.error);
      return result.summary ?? null;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      isLoading.value = false;
      progress.value = '';
    }
  }

  async function summarizeIncremental(
    previousSummary: string,
    newPosts: ScrapedPost[],
  ): Promise<string | null> {
    isLoading.value = true;
    error.value = '';
    progress.value = 'Đang cập nhật tóm tắt...';

    try {
      const result = await sendMessage<{ summary?: string; error?: string }>(
        'SUMMARIZE_INCREMENTAL',
        { previousSummary, newPosts },
      );
      if (result.error) throw new Error(result.error);
      return result.summary ?? null;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      isLoading.value = false;
      progress.value = '';
    }
  }

  async function analyzeOpinions(posts: ScrapedPost[]): Promise<string | null> {
    isLoading.value = true;
    error.value = '';
    progress.value = 'Đang phân tích ý kiến...';

    try {
      const result = await sendMessage<{ opinions?: string; error?: string }>(
        'ANALYZE_OPINIONS',
        posts,
      );
      if (result.error) throw new Error(result.error);
      return result.opinions ?? null;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      isLoading.value = false;
      progress.value = '';
    }
  }

  return { summarize, summarizeIncremental, analyzeOpinions, isLoading, error, progress };
}
