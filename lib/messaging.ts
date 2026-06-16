import { isRef, toRaw, unref } from 'vue';
import type { Message, MessageType } from './types';

/**
 * Recursively unwrap a Vue reactive/ref/readonly proxy into a plain object so it
 * can cross the structured-clone boundary in `browser.runtime.sendMessage`.
 *
 * Firefox throws `DataCloneError: Proxy object could not be cloned` when a reactive
 * payload is sent; Chrome silently clones the underlying target. Class instances and
 * non-plain objects (Date, etc.) are returned as-is so structured clone handles them.
 */
function toPlain<T>(input: T): T {
  const value = isRef(input) ? unref(input) : input;
  if (Array.isArray(value)) {
    return value.map((item) => toPlain(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const raw = toRaw(value as object) as Record<string, unknown>;
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) return raw as unknown as T;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(raw)) result[key] = toPlain(raw[key]);
    return result as unknown as T;
  }
  return value as unknown as T;
}

export function sendMessage<TResponse = unknown>(
  type: MessageType,
  payload?: unknown,
): Promise<TResponse> {
  return browser.runtime.sendMessage({ type, payload: toPlain(payload) } satisfies Message);
}

export function sendMessageQuiet(type: MessageType, payload?: unknown): void {
  try {
    const p = browser.runtime.sendMessage({ type, payload: toPlain(payload) } satisfies Message);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* ignore */ }
}

export function onMessage(
  type: MessageType,
  handler: (payload: unknown, sender: Browser.runtime.MessageSender) => unknown | Promise<unknown>,
): void {
  browser.runtime?.onMessage.addListener((message: Message, sender, sendResponse) => {
    if (message.type !== type) return false;
    const result = handler(message.payload, sender);
    if (result instanceof Promise) {
      result.then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
      return true;
    }
    sendResponse(result);
    return false;
  });
}
