/**
 * Catawiki (auctions). Probed 2026-11-22 through tools.ly.tl: the search
 * page's own API /buyer/api/v1/search answers a plain fetch (the HTML page
 * escalates to a paid source and holds the same lots in __NEXT_DATA__). A
 * lot states title, subtitle, start of bidding, buy-now price and free
 * shipping, but not its current bid or closing time: the page fills those
 * from /buyer/api/v3/bidding/lots?ids=... (plain fetch, any order, keyed
 * by id), which enrich() calls once per page. That API states no bid count:
 * a lot without a highest bidder has no bids and its amount is the starting
 * bid. mcpy applies the price floor on the enriched rows. The site sorts by relevance or closing date only, and every sort value tried
 * on the API was rejected (HTTP 422), so nothing but relevance is applied;
 * budget filters had no effect. Lots flagged isVectorSearchResult are
 * semantic look-alikes (a nonsense query returns only those) and are
 * dropped; the keyword part also matches any word, so rows must contain
 * every word in title or subtitle.
 */

import { CardCondition, ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import { looksBlocked } from "../../readers/html.js";
import { bodyJson, pick } from "../../readers/json.js";
import { q, str } from "../../readers/values.js";
import type { RawListing, ShoppingSite } from "../../types.js";
import { relevant, Relevance } from "./shared.js";

const PAGE_SIZE = 24;

type Obj = Record<string, unknown>;

const GRADES: readonly [RegExp, CardCondition][] = [
  [/\bnear mint\b|\(nm\)/i, CardCondition.NearMint],
  [/\bmint\b|\(m\)/i, CardCondition.Mint],
  [/\bexcellent\b|\(ex\)/i, CardCondition.Excellent],
  [/\blight played\b|\(lp\)/i, CardCondition.LightPlayed],
  [/\bgood\b|\(gd\)/i, CardCondition.Good],
  [/\bplayed\b|\(pl\)/i, CardCondition.Played],
  [/\bpoor\b|\(po\)/i, CardCondition.Poor],
];

const LANGUAGES: Readonly<Record<string, string>> = {
  english: "en", japanese: "ja", chinese: "zh", korean: "ko", german: "de", french: "fr", italian: "it", spanish: "es", dutch: "nl", portuguese: "pt",
};

/** Trading-card subtitles read "Language - Grade (CODE)": both only when the grade is there. */
function card(subtitle: string | undefined): { cardCondition?: CardCondition; language?: string } {
  if (!subtitle) return {};
  const parts = subtitle.split(/\s+-\s+/);
  const grade = parts.find((p) => /\((?:m|nm|ex|gd|lp|pl|po)\)$/i.test(p.trim()));
  if (!grade) return {};
  return {
    cardCondition: GRADES.find(([re]) => re.test(grade))?.[1],
    language: parts.map((p) => LANGUAGES[p.trim().toLowerCase()]).find(Boolean),
  };
}

function row(lot: Obj): RawListing | undefined {
  const url = str(lot["url"], 2_000);
  if (!url) return undefined;
  const subtitle = str(lot["subtitle"]);
  const buyNow = pick(lot, ["buyNow", "price_eur"]) as number | undefined;
  return {
    url,
    id: str(lot["id"]),
    title: str(lot["title"]),
    description: subtitle,
    currency: "EUR",
    format: ListingFormat.Auction,
    buyNow,
    shipping: lot["hasFreeShipping"] === true ? "free" : undefined,
    ...card(subtitle),
    postedAt: str(lot["biddingStartTime"]),
    image: str(lot["thumbImageUrl"], 2_000),
    details: { "Reserve price": lot["reservePriceSet"] === true ? true : lot["reservePriceSet"] === false ? false : undefined, Livestream: lot["live"] ? true : undefined },
  };
}

/** Bidding state by lot id -> the row with current bid, end time and closed flag. */
function withBids(row: RawListing, lot: Obj | undefined): RawListing {
  if (!lot) return row;
  const bid = pick(lot, ["current_bid_amount", "EUR"]);
  const noBids = lot["highest_bidder_token"] === null;
  return {
    ...row,
    price: typeof bid === "number" ? bid : row.price,
    currency: "EUR",
    bids: noBids ? 0 : row.bids,
    endsAt: str(lot["bidding_end_time"]) ?? row.endsAt,
    buyNow: lot["is_buy_now_available"] === false ? undefined : row.buyNow,
    details: { ...row.details, Bid: noBids ? "starting bid" : "current bid", Closed: lot["closed"] === true ? true : undefined, "Reserve met": typeof lot["reserve_price_met"] === "boolean" ? lot["reserve_price_met"] : undefined },
  };
}

export const catawiki: ShoppingSite = {
  key: "catawiki",
  host: "www.catawiki.com",
  country: "nl",
  currency: "EUR",
  language: "en",
  kind: "auction",
  listingId: (url) => /^\/[a-z]{2}\/l\/(\d{6,})(?:-|\/|$)/.exec(url.pathname)?.[1],
  search(sq) {
    return {
      url: `https://www.catawiki.com/buyer/api/v1/search?locale=en&q=${q(sq.query)}&per_page=${PAGE_SIZE}&page=${sq.page}`,
      applies: { sort: sq.sort === ShoppingSort.Relevance },
    };
  },
  enrich: {
    request(rows) {
      const ids = rows.map((r) => r.id).filter((id): id is string => typeof id === "string" && /^\d+$/.test(id));
      return ids.length ? { url: `https://www.catawiki.com/buyer/api/v3/bidding/lots?ids=${ids.join(",")}&currency_code=EUR` } : undefined;
    },
    read(page, rows) {
      const lots = pick(bodyJson(page.content), ["lots"]);
      if (!Array.isArray(lots)) return rows;
      const byId = new Map((lots as Obj[]).map((l) => [String(l["id"]), l]));
      return rows.map((r) => withBids(r, r.id ? byId.get(r.id) : undefined));
    },
  },
  read(page, sq) {
    const data = bodyJson(page.content) as Obj | undefined;
    if (!data) return looksBlocked(page.content) ? { kind: "failed", failure: "blocked", detail: "challenge page" } : { kind: "failed", failure: "redesigned", detail: "search API did not return JSON" };
    if (!Array.isArray(data["lots"])) return { kind: "failed", failure: "redesigned", detail: "no lots in search API response" };
    const lots = data["lots"] as Obj[];
    const keyword = lots.filter((l) => l["isVectorSearchResult"] !== true);
    const hits = relevant(sq.query, keyword, (l) => [str(l["title"]), str(l["subtitle"])], Relevance.Row);
    if (hits.length === 0) return { kind: "empty" };
    const rows = hits.map(row).filter((r): r is RawListing => r !== undefined);
    const total = hits.length === lots.length && typeof data["total"] === "number" ? data["total"] : undefined;
    return { kind: "results", rows, total, hasMore: lots.length >= PAGE_SIZE };
  },
};
