export function originFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin + '/*';
  } catch {
    return null;
  }
}

export async function requestOriginPermission(origin: string): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

export async function requestOriginsPermission(origins: string[]): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins });
  } catch {
    return false;
  }
}

export async function hasOriginPermission(origin: string): Promise<boolean> {
  if (!browser.permissions) return true;
  try {
    return await browser.permissions.contains({ origins: [origin] });
  } catch {
    return true;
  }
}
