/**
 * Combining result lists from several search sources (thorough mode).
 *
 * Reciprocal rank fusion: each list contributes 1 / (K + rank) to every
 * result it contains, so results ranked high by several sources rise to the
 * top without needing comparable scores. Duplicates are found by a
 * normalized URL; the first source's fields win and gaps are filled from
 * the others.
 */

import type { FoundPage } from "../providers/types.js";

/** Standard RRF damping constant (Cormack et al., 2009). */
export const RRF_K = 60;

export interface MergedPage extends FoundPage {
  /** How many sources returned this result. */
  sources: number;
}

const TRACKING_PARAM = /^(utm_.*|gclid|fbclid|msclkid|mc_[a-z]+|ref|ref_src)$/i;

/** Identity of a result URL: scheme-less, no www., no fragment, tracking or trailing slash. */
export function resultKey(raw: string): string {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const params = [...url.searchParams].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${query}`;
  } catch {
    return raw.trim();
  }
}

/** Fill fields missing on `into` from `from` (never overwrite). */
function fillGaps(into: MergedPage, from: FoundPage): void {
  for (const [key, value] of Object.entries(from) as [keyof FoundPage, FoundPage[keyof FoundPage]][]) {
    if (value !== undefined && value !== "" && (into[key] === undefined || into[key] === "")) {
      (into as unknown as Record<string, unknown>)[key] = value;
    }
  }
}

/** Merge ranked lists into one ranking, best first, at most `limit` results. */
export function mergeRanked(lists: FoundPage[][], limit: number): MergedPage[] {
  const merged = new Map<string, { page: MergedPage; score: number }>();
  for (const list of lists) {
    const seen = new Set<string>();
    list.forEach((hit, rank) => {
      const key = resultKey(hit.url);
      if (seen.has(key)) return; // a source listing the same page twice counts once
      seen.add(key);
      const entry = merged.get(key);
      if (entry) {
        entry.score += 1 / (RRF_K + rank + 1);
        entry.page.sources += 1;
        fillGaps(entry.page, hit);
      } else {
        merged.set(key, { page: { ...hit, sources: 1 }, score: 1 / (RRF_K + rank + 1) });
      }
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || b.page.sources - a.page.sources)
    .slice(0, limit)
    .map((e) => e.page);
}

/** Dedupe a single list, keeping order (one source can repeat a URL across pages). */
export function dedupe(list: FoundPage[], limit: number): MergedPage[] {
  return mergeRanked([list], limit);
}
