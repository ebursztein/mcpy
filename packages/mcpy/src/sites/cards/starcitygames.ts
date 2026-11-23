/**
 * Star City Games (Magic). Probed 2026-11-22: /search/?search_query=... is a
 * BigCommerce shell whose rows a HawkSearch script inserts after load; the
 * unrendered page has no rows and no search endpoint is named in the page or
 * its theme bundle, so the search is rendered (one paid render per search).
 * Each product lists the shop's own stock per grade (NM, PL, HP) with price
 * and stock count, so each grade is one listing (id = SCG's variant id).
 * Sort and price are not on the URL: left to mcpy. A query without matches
 * is answered with rows for a spell-corrected query (hawk-corrected-search;
 * hawkspellcheck=0 on the URL does not stop it): those read as empty.
 */

import { SiteFailure } from "../../services/common.js";
import { CardCondition, Condition, Game, ListingFormat, ListingStatus } from "../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../readers/html.js";
import { count, plus } from "../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../types.js";

const ORIGIN = "https://starcitygames.com";
/** The game class HawkSearch puts on each Magic row. */
const MAGIC = "magic-the-gathering";

/** SCG's grades: Near Mint, Played (between lightly and moderately played), Heavily Played. */
const GRADES: Readonly<Record<string, CardCondition>> = {
  NM: CardCondition.NearMint,
  PL: CardCondition.LightPlayed,
  HP: CardCondition.Played,
};

function rows(item: string): RawListing[] {
  const anchor = first(item, /(<a [^>]*class="item-title-link"[^>]*>)/);
  const href = attr(anchor, "href");
  const name = text(first(item, /class="item-title-link"[^>]*>([\s\S]*?)<\/a>/));
  if (!href || !name) return [];
  const url = new URL(href, ORIGIN);
  url.search = "";
  const set = text(first(item, /class="item-category-link"[^>]*>([\s\S]*?)<\/a>/));
  const finish = text(first(item, /class="finish-chip[^"]*">([\s\S]*?)<\/div>/));
  const image = attr(first(item, /(<img [^>]*class="item-image[^"]*"[^>]*>)/), "src");
  const out: RawListing[] = [];
  for (const v of blocks(item, /<div class="variant-row/)) {
    const variant = first(v, /data-tooltip-id="\d+_[A-Za-z_]+_(\d+)_tippy"/);
    const grade = text(first(v, /<div class="name">([\s\S]*?)<\/div>/));
    if (!variant || !grade) continue;
    const stock = text(first(v, /class="stock-count[^"]*">([\s\S]*?)<\/div>/));
    const soldOut = /out-of-stock-variant/.test(v.slice(0, 80)) || /out of stock/i.test(stock ?? "");
    out.push({
      url: url.href,
      id: variant,
      title: set ? `${name} - ${set}` : name,
      price: text(first(v, /--price childAttributes">([\s\S]*?)<\/div>/)),
      currency: "USD",
      format: ListingFormat.FixedPrice,
      cardCondition: GRADES[grade],
      quantity: soldOut ? undefined : count(stock),
      status: soldOut ? ListingStatus.SoldOut : ListingStatus.Available,
      image,
      country: "us",
      details: { Condition: grade, Set: set, Finish: finish },
    });
  }
  return out;
}

export const starcitygames: ShoppingSite = {
  key: "starcitygames",
  host: "starcitygames.com",
  country: "us",
  currency: "USD",
  language: "en",
  kind: SiteKind.Shop,
  games: [Game.Magic],
  listingId: (url) => /^\/([a-z0-9-]+-sgl-[a-z0-9-]+)\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    return { url: `${ORIGIN}/search/?search_query=${plus(sq.query)}${sq.page > 1 ? `&page=${sq.page}` : ""}`, render: true, waitMs: 3_000 };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: SiteFailure.Blocked, detail: "challenge page" };
    // "Showing results for <corrected> / Search instead for <query>": rows for another query, not results.
    if (/class="hawk-corrected-search"/.test(page.content)) return { kind: "empty" };
    const items = blocks(page.content, /<div class="hawk-results-item /);
    if (!items.length) {
      return /id="hawkitemlist"|No results found|did not match any|0 results/i.test(page.content)
        ? { kind: "empty" }
        : { kind: "failed", failure: SiteFailure.Redesigned, detail: "no HawkSearch rows (page not rendered?)" };
    }
    const total = first(page.content, /class="page-total">\s*of\s*(\d+)/);
    // SCG also sells other games (Lorcana, Flesh and Blood...) and its search covers them all: keep Magic rows.
    const magic = items.filter((i) => (first(i, /^<div class="hawk-results-item ([a-z-]+)/) ?? MAGIC) === MAGIC);
    return { kind: "results", rows: magic.flatMap(rows), hasMore: total !== undefined && sq.page < Number(total) };
  },
};
