/**
 * One call's listings from every site, round-robin, each listing once.
 *
 * Sites in one listing pool (eBay's country sites) show the same listing
 * under the same id, each priced for its own buyers: seen live 2026-11-23, an
 * Italian seller's 500,000 EUR listing came back from ebay_de, ebay_es,
 * ebay_it and, converted, ebay_uk at 419,137.88 GBP. The row kept is the one
 * whose price is the seller's own (not price_converted), whichever site
 * answered first; a duplicate never takes a result slot. Every row looked at
 * counts as consumed for its site, so the cursor moves past duplicates too.
 */

import type { Listing } from "./schema.js";

export interface SiteRows {
  key: string;
  /** The site's listing pool, if it shares listings with other sites. */
  pool?: string;
  rows: Listing[];
}

export interface Merged {
  results: Listing[];
  /** Rows of each site this call used up: returned, or dropped as another site's duplicate. */
  consumed: Map<string, number>;
}

export function mergeSites(sites: readonly SiteRows[], limit: number): Merged {
  const results: Listing[] = [];
  const consumed = new Map<string, number>();
  const at = new Map<string, number>();
  const take = (key: string) => consumed.set(key, (consumed.get(key) ?? 0) + 1);
  for (let i = 0; results.length < limit && sites.some((s) => i < s.rows.length); i++) {
    for (const site of sites) {
      const row = site.rows[i];
      if (!row || results.length >= limit) continue;
      take(site.key);
      const id = site.pool ? `${site.pool}\u0000${row.id}` : undefined;
      const seen = id === undefined ? undefined : at.get(id);
      if (seen === undefined) {
        if (id !== undefined) at.set(id, results.length);
        results.push(row);
      } else if (results[seen]!.price_converted && !row.price_converted) {
        results[seen] = row;
      }
    }
  }
  return { results, consumed };
}
