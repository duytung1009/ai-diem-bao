import type { XenForoVersion } from './types';

declare const XF: unknown;
declare const XenForo: unknown;

export function detectXenForoVersion(): XenForoVersion {
  // XenForo 2.x signals
  if (document.querySelector('html[data-app]')) return 'xf2';
  try {
    if (typeof XF !== 'undefined') return 'xf2';
  } catch {}

  // XenForo 1.x signals
  if (document.querySelector('#XenForo')) return 'xf1';
  try {
    if (typeof XenForo !== 'undefined') return 'xf1';
  } catch {}

  // DOM fallback
  if (document.querySelector('article.message')) return 'xf2';
  if (document.querySelector('li.message .messageText')) return 'xf1';

  return 'unknown';
}
