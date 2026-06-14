export function originFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin + '/*';
  } catch {
    return null;
  }
}

export async function requestOriginPermission(origin: string): Promise<boolean> {
  if (import.meta.env.DEV) return true;

  return new Promise<boolean>((resolve) => {
    chrome.permissions.request({ origins: [origin] }, (granted) => {
      if (chrome.runtime.lastError) {
        resolve(false);
      } else {
        resolve(granted);
      }
    });
  });
}

export async function requestOriginsPermission(origins: string[]): Promise<boolean> {
  if (import.meta.env.DEV) return true;

  return new Promise<boolean>((resolve) => {
    chrome.permissions.request({ origins }, (granted) => {
      if (chrome.runtime.lastError) {
        resolve(false);
      } else {
        resolve(granted);
      }
    });
  });
}

export async function hasOriginPermission(origin: string): Promise<boolean> {
  if (import.meta.env.DEV) return true;
  if (typeof chrome === 'undefined' || !chrome.permissions) return true;
  return new Promise<boolean>((resolve) => {
    chrome.permissions.contains({ origins: [origin] }, (result) => {
      resolve(result);
    });
  });
}
