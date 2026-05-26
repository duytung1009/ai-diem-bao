import type { ScrapedPost, TrustFlag, TrustScore, UserMeta } from './types';

// ---------------------------------------------------------------------------
// Date parsing (Task 260)
// ---------------------------------------------------------------------------

/**
 * Parses a join date string from XenForo DOM into a Date object.
 * Priority:
 *  1. ISO / RFC-2822 strings (browser native Date)
 *  2. "Jan 5, 2024" — month-name format
 *  3. Returns null if unparseable (e.g. relative "2 years ago")
 */
export function parseXfDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Attempt native parse first (handles ISO 8601 and many locales)
  const nativeParsed = new Date(trimmed);
  if (!isNaN(nativeParsed.getTime())) return nativeParsed;

  // "Jan 5, 2024" or "Jan 5 2024" pattern
  const monthNameMatch = trimmed.match(
    /^([A-Za-z]{3,9})\s+(\d{1,2})[,\s]+(\d{4})$/
  );
  if (monthNameMatch) {
    const [, month, day, year] = monthNameMatch;
    const parsed = new Date(`${month} ${day}, ${year}`);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // "5 Jan 2024" (day-month-year) pattern
  const dmyMatch = trimmed.match(
    /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/
  );
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    const parsed = new Date(`${month} ${day}, ${year}`);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // "16/12/13" or "30/5/2006" — Vietnamese D/M/YY(YY) format (OtoFun, etc.)
  // Only runs when native parse already failed (i.e. day > 12 makes M/D/Y invalid)
  const slashDmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashDmyMatch) {
    const [, dayStr, monthStr, yearStr] = slashDmyMatch;
    const day = parseInt(dayStr, 10);
    const month = parseInt(monthStr, 10);
    const yearRaw = parseInt(yearStr, 10);
    const year = yearStr.length === 2
      ? (yearRaw >= 50 ? 1900 + yearRaw : 2000 + yearRaw)
      : yearRaw;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const parsed = new Date(year, month - 1, day);
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// VOZ rank scoring
// ---------------------------------------------------------------------------

/**
 * VOZ uses a tiered rank system visible in thread HTML (h5.userTitle).
 * Maps lowercased rank title → { score 0-100, restricted: posting restricted }
 */
const VOZ_RANK_SCORES: Record<string, { score: number; restricted: boolean }> = {
  'new member':             { score: 15, restricted: true },
  'junior member':          { score: 25, restricted: true },
  'member':                 { score: 70, restricted: false },
  'senior member':          { score: 80, restricted: false },
  'active member':          { score: 85, restricted: false },
  'well-known member':      { score: 90, restricted: false },
  'đã tốn tiền':            { score: 85, restricted: false },
  'thành viên tích cực':    { score: 90, restricted: false },
};

function scoreByVozRank(title: string): { score: number; restricted: boolean } | null {
  const normalized = title.toLowerCase().trim();
  const direct = VOZ_RANK_SCORES[normalized];
  if (direct) return direct;
  // Staff / Mod / Admin (custom titles often contain these)
  if (/\b(staff|mod\b|moderator|admin)\b/i.test(title)) {
    return { score: 95, restricted: false };
  }
  return null; // unknown custom title → no badge
}

// ---------------------------------------------------------------------------
// OtoFun rank scoring
// ---------------------------------------------------------------------------

/**
 * OtoFun uses a vehicle-tier rank system (Xe đạp → Xe lu) reflecting post-count milestones.
 * The post count field is "Số km" (kilometres) themed to match the vehicle motif.
 */
const OTOFUN_RANK_SCORES: Record<string, { score: number; restricted: boolean }> = {
  'xe đạp':       { score: 20, restricted: true  }, // bicycle — lowest tier, very new
  'xe máy':       { score: 30, restricted: true  }, // motorbike — new member
  'xe con':       { score: 55, restricted: false }, // car (generic)
  'sedan':        { score: 55, restricted: false },
  'suv':          { score: 58, restricted: false },
  'hatchback':    { score: 55, restricted: false },
  'cuv':          { score: 58, restricted: false },
  'xe tải':       { score: 70, restricted: false }, // truck — established (~200-500 posts)
  'xe điện':      { score: 78, restricted: false }, // EV — higher activity (~2 000-5 000 posts)
  'xe bus':       { score: 80, restricted: false },
  'xe khách':     { score: 80, restricted: false },
  'xe container': { score: 87, restricted: false }, // container truck — veteran (5 000+ posts)
  'xe tăng':      { score: 93, restricted: false }, // tank — super member
  'xe lu':        { score: 95, restricted: false }, // road roller — highest tier
};

function scoreByOtofunRank(title: string): { score: number; restricted: boolean } | null {
  // Strip optional custom badge suffix, e.g. "Xe điện {Kinh doanh chuyên nghiệp}"
  const normalized = title.toLowerCase().trim().replace(/\{[^}]*\}/g, '').trim();
  const direct = OTOFUN_RANK_SCORES[normalized];
  if (direct) return direct;
  if (/\b(mod\b|moderator|admin|ban quản trị)\b/i.test(title)) {
    return { score: 95, restricted: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Trust Scorer (Task 262)
// ---------------------------------------------------------------------------

/** Days between two dates. */
function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Pure function — computes trust scores for all users who posted in the
 * given posts array.  No side-effects.
 */
export function computeTrustScores(
  posts: ScrapedPost[],
  now: Date = new Date()
): Record<string, TrustScore> {
  // Collect per-user: first-seen userMeta + post count in thread
  const userMetaMap = new Map<string, UserMeta | undefined>();
  const postCountMap = new Map<string, number>();

  for (const post of posts) {
    const username = post.author;
    if (!userMetaMap.has(username)) {
      userMetaMap.set(username, post.userMeta);
    }
    postCountMap.set(username, (postCountMap.get(username) ?? 0) + 1);
  }

  const result: Record<string, TrustScore> = {};

  for (const [username, meta] of userMetaMap) {
    const postCountInThread = postCountMap.get(username) ?? 0;

    if (!meta || (
      meta.messageCount === undefined &&
      meta.reactionScore === undefined &&
      meta.joinDate === undefined &&
      !meta.userTitle
    )) {
      result[username] = {
        username,
        score: 0,
        flags: ['no_meta'],
        postCountInThread,
        meta,
      };
      continue;
    }

    // --- Rank-based scoring (userTitle present but no dl.pairs stats) ---
    // Covers: VOZ (title-only thread view) and OtoFun fallback.
    if (
      meta.userTitle &&
      meta.messageCount === undefined &&
      meta.reactionScore === undefined &&
      meta.joinDate === undefined
    ) {
      const rankResult = scoreByVozRank(meta.userTitle) ?? scoreByOtofunRank(meta.userTitle);
      const flags: TrustFlag[] = [];
      if (rankResult) {
        if (rankResult.restricted) {
          flags.push(
            scoreByVozRank(meta.userTitle)?.restricted ? 'voz_rank_restricted' : 'otofun_rank_restricted'
          );
        }
        if (rankResult.score < 60 && postCountInThread > 5) flags.push('high_thread_activity');
        result[username] = { username, score: rankResult.score, flags, postCountInThread, meta };
      } else {
        // Unknown custom title — treat as neutral, no badge
        result[username] = { username, score: 0, flags: ['no_meta'], postCountInThread, meta };
      }
      continue;
    }

    let score = 100;
    const flags: TrustFlag[] = [];

    // --- Join date penalty ---
    const joinDate = parseXfDate(meta.joinDate);
    if (joinDate) {
      const ageDays = daysBetween(joinDate, now);
      if (ageDays < 30) {
        score -= 40;
        flags.push('new_account');
      } else if (ageDays < 90) {
        score -= 25;
        flags.push('new_account');
      } else if (ageDays < 180) {
        score -= 10;
        flags.push('new_account');
      }
    }

    // --- Message count penalty ---
    if (meta.messageCount !== undefined) {
      if (meta.messageCount < 10) {
        score -= 30;
        flags.push('low_post_count');
      } else if (meta.messageCount < 50) {
        score -= 15;
        flags.push('low_post_count');
      }
    }

    // --- Reaction ratio penalty ---
    if (meta.messageCount !== undefined && meta.messageCount > 0 && meta.reactionScore !== undefined) {
      const ratio = meta.reactionScore / meta.messageCount;
      if (ratio < 0.02) {
        score -= 20;
        flags.push('low_reaction_ratio');
      } else if (ratio < 0.05) {
        score -= 10;
        flags.push('low_reaction_ratio');
      }
    }

    // --- High thread activity penalty (only when score already low) ---
    if (score < 50 && postCountInThread > 5) {
      score -= 10;
      flags.push('high_thread_activity');
    }

    result[username] = {
      username,
      score: Math.max(0, score),
      flags,
      postCountInThread,
      meta,
    };
  }

  return result;
}
