/**
 * Bunjang (번개장터). Probed 2026-11-23: m.bunjang.co.kr is a client-side app
 * (6 KB shell); its search grid calls the public JSON API
 * api.bunjang.co.kr/api/search/v8/web/search (GET, no auth; through
 * tools.ly.tl too). The old /api/1/find_v2.json answers 404.
 *
 * q, sort=latest|price_asc|price_desc|score, minPrice and maxPrice are applied
 * by the API (checked: additionalFilters echo them, every row >= the floor,
 * updatedAt descending). policyKey mw.product.keyword is the mobile-web
 * keyword search, as the app sends it. Rows: type PRODUCT (ad: true is a
 * paid placement of a real Bunjang listing, kept as promoted); EXT_AD rows
 * are Naver shopping ads off Bunjang and are dropped. searchSignals carries
 * SEARCH_EMPTY / SEARCH_JUNK for the empty page.
 *
 * Paging is by an opaque search-after cursor only (no page number or
 * offset): the response's nextCursor goes back as &cursor= (checked: page 2
 * continues older rows, floor still applied). Listing URLs:
 * m.bunjang.co.kr/products/<pid>.
 */

import { ListingFormat, ListingStatus, ShoppingSort } from "../../services/shopping/schema.js";
import { bodyJson, pick } from "../readers/json.js";
import { looksBlocked } from "../readers/html.js";
import { q, str, timestamp } from "../readers/values.js";
import type { RawListing, ShoppingSite } from "../types.js";
import { koreanWanted } from "./common.js";

const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "latest",
  [ShoppingSort.PriceLow]: "price_asc",
  [ShoppingSort.PriceHigh]: "price_desc",
  [ShoppingSort.Relevance]: "score",
};

type Obj = Record<string, unknown>;

function row(item: Obj): RawListing | undefined {
  if (item["type"] !== "PRODUCT") return undefined;
  const pid = typeof item["pid"] === "number" || typeof item["pid"] === "string" ? String(item["pid"]) : undefined;
  if (!pid) return undefined;
  const title = str(item["name"]);
  const image = str(item["productImage"], 2_000)?.replace("{res}", "400");
  return {
    url: `https://m.bunjang.co.kr/products/${pid}`,
    id: pid,
    title,
    price: item["price"] as number | string,
    currency: "KRW",
    format: koreanWanted(title) ? ListingFormat.Wanted : ListingFormat.FixedPrice,
    // Only SELLING was observed; other states stay in details.
    status: item["status"] === "SELLING" ? ListingStatus.Available : undefined,
    // updatedAt is the last bump (끌올), not when it was listed: kept as a detail, never as posted_at.
    promoted: item["ad"] === true,
    image,
    country: "kr",
    details: {
      Status: item["status"] !== "SELLING" ? str(item["status"]) : undefined,
      Updated: timestamp(item["updatedAt"]),
      Shop: str(pick(item, ["shop", "uid"])),
      Likes: typeof item["favoriteCount"] === "number" ? item["favoriteCount"] : undefined,
      Chats: typeof item["buntalkCount"] === "number" ? item["buntalkCount"] : undefined,
      "Bunjang Care": item["care"] === true ? true : undefined,
    },
  };
}

export const bunjang: ShoppingSite = {
  key: "bunjang",
  host: "m.bunjang.co.kr",
  country: "kr",
  currency: "KRW",
  language: "ko",
  kind: "marketplace",
  listingId: (url) => /^\/products\/(\d{5,12})\/?$/.exec(url.pathname)?.[1],
  pagesByCursor: true,
  search(sq) {
    const sort = SORTS[sq.sort];
    const price = `${sq.minPrice !== undefined ? `&minPrice=${Math.ceil(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&maxPrice=${Math.floor(sq.maxPrice)}` : ""}`;
    return {
      url: `https://api.bunjang.co.kr/api/search/v8/web/search?policyKey=mw.product.keyword&q=${q(sq.query)}${sort ? `&sort=${sort}` : ""}${price}&size=60${sq.cursor ? `&cursor=${q(sq.cursor)}` : ""}`,
      applies: { sort: sort !== undefined, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const data = pick(bodyJson(page.content), ["data"]) as Obj | undefined;
    const signals = Array.isArray(data?.["searchSignals"]) ? (data!["searchSignals"] as unknown[]) : undefined;
    if (!data || !signals) return { kind: "failed", failure: "redesigned", detail: "no search response" };
    if (signals.includes("SEARCH_EMPTY") || signals.includes("SEARCH_JUNK") || signals.includes("SEARCH_FORBIDDEN")) return { kind: "empty" };
    const grid = pick(data, ["responses", "mainGrid", "searchResponse"]) as Obj | undefined;
    if (!grid || !Array.isArray(grid["data"])) return { kind: "failed", failure: "redesigned", detail: "no mainGrid in the search response" };
    const rows = (grid["data"] as Obj[]).map(row).filter((r): r is RawListing => r !== undefined);
    if (!rows.length) return { kind: "empty" };
    const nextCursor = str(grid["nextCursor"], 2_000);
    return { kind: "results", rows, total: typeof grid["totalCount"] === "number" ? grid["totalCount"] : undefined, hasMore: nextCursor !== undefined, nextCursor };
  },
};
