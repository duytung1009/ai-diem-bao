import { isRetryableStatus } from '../errors';

const MAX_RETRIES = 3;

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err instanceof Error && 'status' in err ? (err as { status?: number }).status : undefined;
      if (!status || !isRetryableStatus(status)) throw err;
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}
