export interface CategoryNormalizerConfig {
  threshold: number;
  minClusterSize: number;
}

const DEFAULT_CONFIG: CategoryNormalizerConfig = {
  threshold: 0.55,
  minClusterSize: 2,
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s]+/g, ' ').trim();
}

function levenshteinRatio(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;

  const matrix: number[][] = [];
  for (let i = 0; i <= na.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= nb.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= na.length; i++) {
    for (let j = 1; j <= nb.length; j++) {
      const cost = na[i - 1] === nb[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  const dist = matrix[na.length][nb.length];
  return 1 - dist / maxLen;
}

function tokenJaccard(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  const tokensA = new Set(na.split(' ').filter(t => t.length > 0));
  const tokensB = new Set(nb.split(' ').filter(t => t.length > 0));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;

  let intersect = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersect++;
  }
  const union = tokensA.size + tokensB.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function combinedSimilarity(a: string, b: string): number {
  const lev = levenshteinRatio(a, b);
  const jac = tokenJaccard(a, b);
  const na = normalize(a);
  const nb = normalize(b);

  let prefixScore = 0;
  const minLen = Math.min(na.length, nb.length);
  if (minLen >= 3) {
    let shared = 0;
    for (let i = 0; i < minLen; i++) {
      if (na[i] === nb[i]) shared++;
      else break;
    }
    prefixScore = shared / minLen;
  }

  if (lev >= 0.85) return lev;
  if (prefixScore >= 0.6) {
    const longer = na.length >= nb.length ? na : nb;
    const shorter = na.length >= nb.length ? nb : na;
    if (longer.includes(shorter)) return Math.max(0.7, prefixScore);
    return prefixScore * 0.7 + lev * 0.3;
  }
  return lev * 0.5 + jac * 0.3 + prefixScore * 0.2;
}

export function pickCanonical(group: string[]): string {
  const counts = new Map<string, number>();
  for (const c of group) {
    const key = c.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = group[0];
  let bestScore = -1;
  for (const c of group) {
    const freq = counts.get(c.trim()) ?? 0;
    const length = c.trim().length;
    const score = freq * 10 - length * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = c.trim();
    }
  }
  return best;
}

export function normalizeCategory(
  category: string | undefined,
  clusterMap: Map<string, string> | null,
): string | undefined {
  if (!category || !clusterMap) return category;
  const key = category.trim();
  return clusterMap.get(key) ?? category;
}

export function buildCategoryClusterMap(
  entries: { category?: string }[],
  config: CategoryNormalizerConfig = DEFAULT_CONFIG,
): Map<string, string> {
  const unique = new Map<string, number>();
  for (const e of entries) {
    const cat = e.category;
    if (!cat) continue;
    const key = cat.trim();
    unique.set(key, (unique.get(key) ?? 0) + 1);
  }

  const keys = [...unique.keys()];
  if (keys.length <= 1) return new Map();

  const n = keys.length;
  const simMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = combinedSimilarity(keys[i], keys[j]);
      simMatrix[i][j] = s;
      simMatrix[j][i] = s;
    }
  }

  const visited = new Set<number>();
  const clusters: number[][] = [];

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;
    const cluster = [i];
    visited.add(i);
    for (let j = i + 1; j < n; j++) {
      if (visited.has(j)) continue;
      const maxToCluster = cluster.reduce((max, ci) => Math.max(max, simMatrix[ci][j]), 0);
      if (maxToCluster >= config.threshold) {
        cluster.push(j);
        visited.add(j);
      }
    }
    clusters.push(cluster);
  }

  const clusterMap = new Map<string, string>();
  for (const cluster of clusters) {
    if (cluster.length >= config.minClusterSize) {
      const names = cluster.map(i => keys[i]);
      const canonical = pickCanonical(names);
      for (const name of names) {
        clusterMap.set(name, canonical);
      }
    }
  }

  return clusterMap;
}

export function normalizeCategories<T extends { category?: string }>(
  entries: T[],
  config?: CategoryNormalizerConfig,
): T[] {
  if (entries.length === 0) return entries;
  const clusterMap = buildCategoryClusterMap(entries, config);
  if (clusterMap.size === 0) return entries;
  return entries.map(e => ({
    ...e,
    category: normalizeCategory(e.category, clusterMap) ?? e.category,
  }));
}
