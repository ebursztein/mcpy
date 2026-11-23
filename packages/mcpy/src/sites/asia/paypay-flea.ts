/**
 * Yahoo! Flea Market (formerly PayPay Flea Market). Probed 2026-11-23 through
 * tools.ly.tl: a plain fetch serves the search page; rows are in __NEXT_DATA__
 * at props.initialState.searchState.search.result.items (100 a page, ?page=N).
 * minPrice/maxPrice and sort=price are applied by the site (checked: every
 * row >= the floor, prices ascending). sort=openTime&order=desc is the site's
 * 新着順: rows come in the order they last surfaced (a price drop re-surfaces
 * a listing), so openTime itself is not monotonic.
 *
 * A query that matches nothing answers HTTP 404 with 100 vector-search rows
 * and result.metadata.retriedWithVectorSearch = true: that is the empty page.
 * auctionItemsModule rows are Yahoo! Auctions listings (yahoo_auctions).
 */

import { Condition, ListingFormat, ListingStatus, ShoppingSort } from "../../services/shopping/schema.js";
import { looksBlocked } from "../readers/html.js";
import { nextData, pick } from "../readers/json.js";
import { q, str, timestamp } from "../readers/values.js";
import type { RawListing, ShoppingSite } from "../types.js";

const PAGE_SIZE = 100;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "sort=openTime&order=desc",
  [ShoppingSort.PriceLow]: "sort=price&order=asc",
  [ShoppingSort.PriceHigh]: "sort=price&order=desc",
};

/** The site's condition codes, as its filter labels them. */
const CONDITIONS: Readonly<Record<string, string>> = {
  new: "新品、未使用",
  used10: "未使用に近い",
  used20: "目立った傷や汚れなし",
  used40: "やや傷や汚れあり",
  used60: "傷や汚れあり",
  used80: "全体的に状態が悪い",
};

type Obj = Record<string, unknown>;

function row(item: Obj): RawListing | undefined {
  const id = str(item["id"]);
  if (!id) return undefined;
  const cond = str(item["condition"]);
  const status = str(item["itemStatus"]);
  const seller = item["seller"] as Obj | undefined;
  return {
    url: `https://paypayfleamarket.yahoo.co.jp/item/${id}`,
    id,
    title: str(item["title"]),
    price: item["price"] as number,
    currency: "JPY",
    format: ListingFormat.FixedPrice,
    condition: cond === "new" ? Condition.New : cond?.startsWith("used") ? Condition.Used : undefined,
    status: status === "OPEN" ? ListingStatus.Available : status === "SOLD" || status === "CLOSED" ? ListingStatus.SoldOut : undefined,
    postedAt: timestamp(item["openTime"], "+09:00"),
    seller: str(item["sellerId"]),
    sellerFeedbackCount: seller?.["numRating"] as number | undefined,
    sellerFeedbackPercent: seller?.["goodRatio"] as number | undefined,
    image: str(item["thumbnailImageUrl"], 2_000),
    country: "jp",
    details: {
      Condition: cond ? (CONDITIONS[cond] ?? cond) : undefined,
      Category: str(pick(item, ["category", "name"])),
      Brand: str(pick(item, ["brand", "name"])),
      Likes: typeof item["likeCount"] === "number" ? item["likeCount"] : undefined,
      "Price reduced": item["isPriceDown"] === true ? true : undefined,
    },
  };
}

export const paypayFlea: ShoppingSite = {
  key: "paypay_flea",
  host: "paypayfleamarket.yahoo.co.jp",
  country: "jp",
  currency: "JPY",
  language: "ja",
  kind: "marketplace",
  listingId: (url) => /^\/item\/([a-z]\d{6,12})\/?$/.exec(url.pathname)?.[1],
  emptyStatuses: [404],
  search(sq) {
    const params = [
      SORTS[sq.sort],
      sq.minPrice !== undefined ? `minPrice=${Math.ceil(sq.minPrice)}` : undefined,
      sq.maxPrice !== undefined ? `maxPrice=${Math.floor(sq.maxPrice)}` : undefined,
      sq.page > 1 ? `page=${sq.page}` : undefined,
    ].filter(Boolean);
    const sort = SORTS[sq.sort] !== undefined || sq.sort === ShoppingSort.Relevance;
    return {
      url: `https://paypayfleamarket.yahoo.co.jp/search/${q(sq.query)}${params.length ? `?${params.join("&")}` : ""}`,
      applies: { sort, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const search = pick(nextData(page.content), ["props", "initialState", "searchState", "search"]) as Obj | undefined;
    const result = search?.["result"] as Obj | undefined;
    if (!result || !Array.isArray(result["items"])) return { kind: "failed", failure: "redesigned", detail: "no search result in __NEXT_DATA__" };
    const items = result["items"] as Obj[];
    const retried = pick(result, ["metadata", "retriedWithVectorSearch"]) === true;
    if (page.status === 404 || search!["isZeroMatch"] === true || retried || items.length === 0) return { kind: "empty" };
    const total = typeof result["totalResultsAvailable"] === "number" ? result["totalResultsAvailable"] : undefined;
    const rows = items.map(row).filter((r): r is RawListing => r !== undefined);
    const offset = typeof result["offset"] === "number" ? result["offset"] : 0;
    return { kind: "results", rows, total, hasMore: items.length === PAGE_SIZE && (total === undefined || offset + items.length < total) };
  },
};
