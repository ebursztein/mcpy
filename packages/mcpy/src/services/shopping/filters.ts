/**
 * What mcpy applies on the rows when a site does not: price bounds, sort and
 * the listing filters. A filter on a field no row states is reported as
 * ignored instead of emptying the page; rows that lack a field the others
 * state are dropped (they cannot be shown to match).
 */

import { RequestPart, type RequestPart as Part } from "../common.js";
import { CARD_CONDITION_ORDER, ShoppingSort, type Listing, type ShoppingSearchQuery } from "./schema.js";
import type { SiteRequest } from "../../sites/types.js";

export interface Filtered {
  rows: Listing[];
  ignored: Part[];
}

function byField(rows: Listing[], has: (l: Listing) => boolean, keep: (l: Listing) => boolean, part: Part, ignored: Part[]): Listing[] {
  if (!rows.some(has)) {
    if (rows.length) ignored.push(part);
    return rows;
  }
  return rows.filter((l) => has(l) && keep(l));
}

export function applyFilters(rows: Listing[], input: ShoppingSearchQuery, req: SiteRequest): Filtered {
  const ignored: Part[] = [];
  let out = rows;
  const applies = req.applies ?? {};
  if (input.min_price !== undefined && !applies.minPrice) {
    out = byField(out, (l) => l.price !== undefined, (l) => l.price!.amount >= input.min_price!, RequestPart.MinPrice, ignored);
  }
  if (input.max_price !== undefined && !applies.maxPrice) {
    out = byField(out, (l) => l.price !== undefined, (l) => l.price!.amount <= input.max_price!, RequestPart.MaxPrice, ignored);
  }
  if (input.condition) {
    const wanted = new Set(input.condition);
    out = byField(out, (l) => l.condition !== undefined, (l) => wanted.has(l.condition!), RequestPart.Condition, ignored);
  }
  if (input.card_condition) {
    const worst = CARD_CONDITION_ORDER.indexOf(input.card_condition);
    out = byField(out, (l) => l.card_condition !== undefined, (l) => CARD_CONDITION_ORDER.indexOf(l.card_condition!) <= worst, RequestPart.CardCondition, ignored);
  }
  if (input.language) {
    const wanted = new Set<string>(input.language);
    out = byField(out, (l) => l.language !== undefined, (l) => wanted.has(l.language!), RequestPart.Language, ignored);
  }
  if (input.format) {
    const wanted = new Set<string>(input.format);
    out = byField(out, (l) => l.format !== undefined, (l) => wanted.has(l.format!), RequestPart.Format, ignored);
  }
  if (!applies.sort && input.sort !== ShoppingSort.Relevance) {
    const sorted = sortRows(out, input.sort);
    if (sorted) out = sorted;
    // Sorting one page locally is not the site's order across all its results.
    ignored.push(RequestPart.Sort);
  }
  return { rows: out, ignored };
}

/** Rows sorted by `sort` when every row states the field; otherwise undefined. */
function sortRows(rows: Listing[], sort: ShoppingSearchQuery["sort"]): Listing[] | undefined {
  const key = (l: Listing): number | undefined => {
    if (sort === ShoppingSort.PriceLow || sort === ShoppingSort.PriceHigh) return l.price?.amount;
    if (sort === ShoppingSort.Newest) return l.posted_at ? Date.parse(l.posted_at) : undefined;
    if (sort === ShoppingSort.EndingSoon) return l.auction?.ends_at ? Date.parse(l.auction.ends_at) : undefined;
    return undefined;
  };
  if (!rows.every((l) => key(l) !== undefined)) return undefined;
  const dir = sort === ShoppingSort.PriceHigh || sort === ShoppingSort.Newest ? -1 : 1;
  return [...rows].sort((a, b) => dir * (key(a)! - key(b)!));
}

/** Round-robin across sites, each in its own order, up to `limit` listings. */
export function interleave(lists: Listing[][], limit: number): Listing[] {
  const out: Listing[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      if (i < list.length && out.length < limit) out.push(list[i]!);
    }
  }
  return out;
}
