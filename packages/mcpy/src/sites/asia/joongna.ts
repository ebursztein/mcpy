/**
 * Joongna (web.joongna.com). Probed 2026-11-23 through tools.ly.tl: a plain
 * fetch of /search/<query> serves the Next.js app router page; the rows are
 * the dehydrated react-query result of postSearchProduct inside the flight
 * data: an object {transactionId, emptyResult, totalSize, items: [...]}.
 *
 * sort=RECENT_SORT|PRICE_ASC_SORT|PRICE_DESC_SORT, minPrice/maxPrice and page
 * are applied by the site (checked: the query key echoes them and every row
 * is 5000-20000, sortDate descending). Sold rows are excluded by default
 * (saleYn SALE_N). selfAuditRecommendItems are recommendations, not results.
 */

import { ListingFormat, ListingStatus, ShoppingSort } from "../../services/shopping/schema.js";
import { looksBlocked } from "../readers/html.js";
import { flight, objectsStartingWith } from "../readers/json.js";
import { q, str, timestamp } from "../readers/values.js";
import type { RawListing, ShoppingSite } from "../types.js";
import { koreanWanted } from "./common.js";

const PAGE_SIZE = 50;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "RECENT_SORT",
  [ShoppingSort.PriceLow]: "PRICE_ASC_SORT",
  [ShoppingSort.PriceHigh]: "PRICE_DESC_SORT",
  [ShoppingSort.Relevance]: "RECOMMEND_SORT",
};

type Obj = Record<string, unknown>;

function row(item: Obj): RawListing | undefined {
  if (item["objectType"] !== undefined && item["objectType"] !== "product") return undefined;
  const seq = typeof item["seq"] === "number" ? String(item["seq"]) : undefined;
  if (!seq) return undefined;
  const title = str(item["title"]);
  const locations = Array.isArray(item["locationNames"]) ? (item["locationNames"] as unknown[]) : [];
  return {
    url: `https://web.joongna.com/product/${seq}`,
    id: seq,
    title,
    price: item["price"] as number,
    currency: "KRW",
    format: koreanWanted(title) ? ListingFormat.Wanted : ListingFormat.FixedPrice,
    // parcelFee 1 is the card's 무료배송 badge.
    shipping: item["parcelFee"] === 1 ? "free" : undefined,
    // Only state 0 was observed (saleYn SALE_N hides sold rows); other codes stay unmapped.
    status: item["state"] === 0 ? ListingStatus.Available : undefined,
    postedAt: timestamp(item["sortDate"], "+09:00"),
    location: str(locations[0]) ?? str(item["mainLocationName"]),
    country: "kr",
    image: str(item["url"], 2_000),
    details: {
      Store: typeof item["storeSeq"] === "number" ? item["storeSeq"] : undefined,
      State: typeof item["state"] === "number" && item["state"] !== 0 ? item["state"] : undefined,
      Likes: typeof item["wishCount"] === "number" ? item["wishCount"] : undefined,
      Chats: typeof item["chatCount"] === "number" ? item["chatCount"] : undefined,
      "Joongna Pay": item["jnPayBadgeFlag"] === true ? true : undefined,
      "Certified seller": item["certifySellerFlag"] === true ? true : undefined,
    },
  };
}

export const joongna: ShoppingSite = {
  key: "joongna",
  host: "web.joongna.com",
  country: "kr",
  currency: "KRW",
  language: "ko",
  kind: "classifieds",
  listingId: (url) => /^\/product\/(\d{5,12})\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const sort = SORTS[sq.sort];
    const params = [
      sort ? `sort=${sort}` : undefined,
      sq.minPrice !== undefined ? `minPrice=${Math.ceil(sq.minPrice)}` : undefined,
      sq.maxPrice !== undefined ? `maxPrice=${Math.floor(sq.maxPrice)}` : undefined,
      sq.page > 1 ? `page=${sq.page}` : undefined,
    ].filter(Boolean);
    return {
      url: `https://web.joongna.com/search/${q(sq.query)}${params.length ? `?${params.join("&")}` : ""}`,
      applies: { sort: sort !== undefined, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const result = objectsStartingWith(flight(page.content), '{"transactionId":', 20).find((o) => Array.isArray(o["items"]));
    if (!result) return { kind: "failed", failure: "redesigned", detail: "no postSearchProduct result in the flight data" };
    const items = result["items"] as Obj[];
    if (!items.length) return { kind: "empty" };
    const total = typeof result["totalSize"] === "number" ? result["totalSize"] : undefined;
    const rows = items.map(row).filter((r): r is RawListing => r !== undefined);
    return { kind: "results", rows, total, hasMore: items.length === PAGE_SIZE };
  },
};
