/**
 * KupujemProdajem (Serbia). Probed 2026-11-22: a plain fetch serves the
 * search page (tools.ly.tl needed a second attempt); rows are in
 * __NEXT_DATA__ at props.initialReduxState.search.lastSearchResult.ads (30 a
 * page, page=N). order=posted desc is newest first, order=price / price desc
 * the price orders. priceFrom/priceTo with currency=rsd are applied by the
 * site, which converts: an ad priced in EUR is kept when its dinar value is
 * in range (checked: 99 EUR kept for 5,000-20,000 RSD), so the row keeps the
 * currency it states. ad_type "buy" is a buyer's post. Times are Belgrade
 * local, without an offset.
 */

import { Condition, ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import { nextData, pick } from "../../readers/json.js";
import { looksBlocked } from "../../readers/html.js";
import { q, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";
import { cetTime } from "./cet.js";

const PAGE_SIZE = 30;
const ORDERS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "posted desc",
  [ShoppingSort.PriceLow]: "price",
  [ShoppingSort.PriceHigh]: "price desc",
};
const CONDITIONS: Readonly<Record<string, Condition>> = { new: Condition.New, "as-new": Condition.Used, used: Condition.Used, damaged: Condition.ForParts };
const BASE = "https://www.kupujemprodajem.com";

function row(ad: Record<string, unknown>): RawListing | undefined {
  const path = str(ad["ad_url"], 2_000);
  if (!path) return undefined;
  const currency = str(ad["currency"])?.toUpperCase();
  const cond = str(ad["condition"]);
  const photo = str(ad["photo1_tmb_300x300"], 2_000);
  return {
    url: `${BASE}${path}`,
    id: str(ad["ad_id"]),
    title: str(ad["name_decoded"]) ?? str(ad["name"]),
    description: str(ad["description_snippet_decoded"]),
    price: currency ? (ad["price"] as number | string | undefined) : undefined,
    currency,
    format: ad["ad_type"] === "buy" ? ListingFormat.Wanted : currency ? ListingFormat.FixedPrice : undefined,
    condition: cond ? CONDITIONS[cond] : undefined,
    postedAt: cetTime(str(ad["posted"])),
    postedText: str(ad["posted_days_desc"]),
    location: str(ad["location_name"]),
    country: "rs",
    promoted: ad["is_top"] === true || ad["is_priority"] === true || ad["is_top_search"] === true || ad["is_highlighted"] === true,
    image: photo ? `https://images.kupujemprodajem.com${photo}` : undefined,
    details: {
      Category: [str(ad["category_name"]), str(ad["group_name"])].filter(Boolean).join(" › ") || undefined,
      Condition: cond,
      Negotiable: ad["price_fixed"] === false && currency ? true : undefined,
      Exchange: ad["exchange"] === true ? true : undefined,
      Views: str(ad["view_count"]),
      Price: str(ad["price_text"]),
    },
  };
}

export const kupujemprodajem: ShoppingSite = {
  key: "kupujemprodajem",
  host: "www.kupujemprodajem.com",
  country: "rs",
  currency: "RSD",
  language: "sr",
  kind: SiteKind.Classifieds,
  listingId: (url) => /\/oglas\/(\d+)\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const order = ORDERS[sq.sort];
    const priced = sq.minPrice !== undefined || sq.maxPrice !== undefined;
    const price = `${sq.minPrice !== undefined ? `&priceFrom=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&priceTo=${Math.ceil(sq.maxPrice)}` : ""}${priced ? "&currency=rsd" : ""}`;
    return {
      url: `${BASE}/pretraga?keywords=${q(sq.query)}${order ? `&order=${q(order)}` : ""}${price}${sq.page > 1 ? `&page=${sq.page}` : ""}`,
      applies: { sort: order !== undefined || sq.sort === ShoppingSort.Relevance, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const result = pick(nextData(page.content), ["props", "initialReduxState", "search", "lastSearchResult"]) as Record<string, unknown> | undefined;
    if (!result || !Array.isArray(result["ads"])) return { kind: "failed", failure: "redesigned", detail: "no search.lastSearchResult.ads in __NEXT_DATA__" };
    if (str(result["captcha"])) return { kind: "failed", failure: "blocked", detail: "search answered with a captcha" };
    const ads = result["ads"] as Record<string, unknown>[];
    if (ads.length === 0) return { kind: "empty" };
    const rows = ads.map(row).filter((r): r is RawListing => r !== undefined);
    const total = typeof result["total"] === "number" ? result["total"] : undefined;
    const pages = typeof result["pages"] === "number" ? result["pages"] : undefined;
    const current = typeof result["page"] === "number" ? result["page"] : undefined;
    return { kind: "results", rows, total, hasMore: pages !== undefined && current !== undefined ? current < pages : ads.length === PAGE_SIZE };
  },
};
