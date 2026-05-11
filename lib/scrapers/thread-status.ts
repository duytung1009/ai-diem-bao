/** Detect if a XenForo page shows a deleted/removed thread */
export function isThreadDeleted(doc: Document): boolean {
  const title = doc.querySelector('h1.p-title-value, .p-title-value, .titleBar h1');
  const titleText = title?.textContent?.trim() ?? '';
  if (/oops|ran into some problems|not found/i.test(titleText)) return true;

  const blockMsg = doc.querySelector('.blockMessage');
  const msgText = blockMsg?.textContent?.trim() ?? '';
  if (/requested thread could not be found|thread has been deleted/i.test(msgText)) return true;

  return false;
}

/** Detect if a XenForo thread is locked/closed */
export function isThreadLocked(doc: Document): boolean {
  const lockedMsg = doc.querySelector('.blockStatus-message--locked');
  if (lockedMsg) return true;

  const dt = doc.querySelector('.blockStatus dt');
  const dtText = dt?.textContent?.trim() ?? '';
  if (/trạng thái|status/i.test(dtText)) {
    const dd = dt?.parentElement?.querySelector('.blockStatus-message');
    const ddText = dd?.textContent?.trim() ?? '';
    if (/thớt đang đóng|not open for further replies|thread is closed|đã đóng|locked/i.test(ddText)) return true;
  }

  return false;
}
