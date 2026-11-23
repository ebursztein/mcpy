/**
 * Card Kingdom (Magic). Probed 2026-11-22: a direct fetch serves the
 * server-rendered search page (/catalog/search?filter[name]=...); the API
 * host it names (api.cardkingdom.com) is not what renders the rows. Each
 * product card lists the shop's own stock per grade (NM, EX, VG, G) with price
 * and quantity, so each grade is one listing (id = product path + grade).
 * filter[sort] did not order the rows and filter[price] filters on the NM
 * price only (EX/VG/G rows below the floor came back), so sort and price are
 * left to mcpy.
 */

import { SiteFailure } from "../../services/common.js";
import { CardCondition, Condition, Game, ListingFormat, ListingStatus } from "../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../readers/html.js";
import { plus, str } from "../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../types.js";

const ORIGIN = "https://www.cardkingdom.com";

/** Card Kingdom's grades on the reference scale (its EX is "lightly played", VG "moderately", G "heavily"). */
const GRADES: Readonly<Record<string, CardCondition>> = {
  NM: CardCondition.NearMint,
  EX: CardCondition.Excellent,
  VG: CardCondition.LightPlayed,
  G: CardCondition.Played,
};

function rows(card: string): RawListing[] {
  const link = first(card, /<span class="productDetailTitle">([\s\S]*?)<\/span>/);
  const href = attr(first(link, /(<a [^>]*>)/), "href");
  const title = text(link);
  if (!href || !title) return [];
  const path = new URL(href, ORIGIN).pathname;
  const set = text(first(card, /<div class="productDetailSet">\s*<a [^>]*>([\s\S]*?)<\/a>/));
  const image = attr(first(card, /(<mtg-card-image [^>]*>)/), "src") ?? attr(first(card, /(<img [^>]*class="imgix-card-image"[^>]*>)/), "src");
  const out: RawListing[] = [];
  for (const li of blocks(card, /<li class="itemAddToCart /)) {
    const grade = first(li, /^<li class="itemAddToCart ([A-Z]+)/);
    if (!grade || !GRADES[grade]) continue;
    const soldOut = /outOfStockNotice/.test(li);
    out.push({
      url: `${ORIGIN}${path}`,
      id: `${path.replace(/^\//, "")}:${grade}`,
      title: set ? `${title} - ${set}` : title,
      price: text(first(li, /<span class="stylePrice">([\s\S]*?)<\/span>/)),
      currency: "USD",
      format: ListingFormat.FixedPrice,
      cardCondition: GRADES[grade],
      quantity: soldOut ? undefined : str(text(first(li, /<span class="styleQty">([\s\S]*?)<\/span>/))),
      status: soldOut ? ListingStatus.SoldOut : ListingStatus.Available,
      image,
      country: "us",
      details: { Condition: grade, Set: set, Foil: /\bFoil\b/.test(title) ? true : undefined },
    });
  }
  return out;
}

export const cardkingdom: ShoppingSite = {
  key: "cardkingdom",
  host: "www.cardkingdom.com",
  country: "us",
  currency: "USD",
  language: "en",
  kind: SiteKind.Shop,
  games: [Game.Magic],
  listingId: (url) => /^\/mtg\/[^/]+\/[^/]+$/.exec(url.pathname)?.[0].slice(1),
  search(sq) {
    return { url: `${ORIGIN}/catalog/search?search=header&filter%5Bname%5D=${plus(sq.query)}${sq.page > 1 ? `&page=${sq.page}` : ""}` };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: SiteFailure.Blocked, detail: "challenge page" };
    const cards = blocks(page.content, /<div class="productItemWrapper productCardWrapper/);
    if (!cards.length) {
      return /No results were found|\b0 results found/.test(page.content)
        ? { kind: "empty" }
        : { kind: "failed", failure: SiteFailure.Redesigned, detail: "no product cards" };
    }
    const listings = cards.flatMap(rows);
    const total = first(page.content, /([\d,]+) results found/);
    return { kind: "results", rows: listings, total: total ? Number(total.replace(/,/g, "")) : undefined, hasMore: new RegExp(`[?&](?:amp;)?page=${sq.page + 1}\\b`).test(page.content) };
  },
};
