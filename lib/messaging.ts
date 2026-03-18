import type { Message, MessageType } from './types';

export function sendMessage<TResponse = unknown>(
  type: MessageType,
  payload?: unknown,
): Promise<TResponse> {
  return browser.runtime.sendMessage({ type, payload } satisfies Message);
}

export function sendTabMessage<TResponse = unknown>(
  tabId: number,
  type: MessageType,
  payload?: unknown,
): Promise<TResponse> {
  return browser.tabs.sendMessage(tabId, { type, payload } satisfies Message);
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
