/**
 * Yahoo! Auctions Japan. Probed 2026-11-22 through tools.ly.tl: a plain fetch
 * serves the search page; rows are in __NEXT_DATA__ at
 * props.pageProps.initialState.search.items.listing.items (n=100 a page, the
 * most the site serves: newest-first pages are up to ~70% PayPay Flea rows,
 * and no URL parameter drops only those; fixed=2 drops every fixed price row).
 * aucminprice/aucmaxprice and s1/o1 are applied by the site (checked: every
 * row >= the floor, sort +PRICE). Rows flagged isFleamarketItem are PayPay
 * Flea listings, served by the paypay_flea site: dropped here so one item
 * never becomes two listings.
 */

import { Condition, ListingFormat, ShoppingSort } from "../../services/shopping/schema.js";
import { nextData, pick } from "../readers/json.js";
import { looksBlocked } from "../readers/html.js";
import { q, str } from "../readers/values.js";
import type { RawListing, ShoppingSite } from "../types.js";

const PAGE_SIZE = 100;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "&s1=new&o1=d",
  [ShoppingSort.PriceLow]: "&s1=cbids&o1=a",
  [ShoppingSort.PriceHigh]: "&s1=cbids&o1=d",
  [ShoppingSort.EndingSoon]: "&s1=end&o1=a",
};

function row(item: Record<string, unknown>): RawListing | undefined {
  if (item["isFleamarketItem"] === true) return undefined;
  const id = str(item["auctionId"]);
  if (!id) return undefined;
  const fixed = item["isFixedPrice"] === true;
  const bids = typeof item["bidCount"] === "number" ? item["bidCount"] : undefined;
  const cond = str(item["itemCondition"]);
  const seller = pick(item, ["seller"]) as Record<string, unknown> | undefined;
  return {
    url: `https://auctions.yahoo.co.jp/jp/auction/${id}`,
    id,
    title: str(item["title"]),
    price: item["price"] as number,
    currency: "JPY",
    format: fixed ? ListingFormat.FixedPrice : ListingFormat.Auction,
    bids: fixed ? undefined : bids,
    endsAt: fixed ? undefined : str(item["endTime"]),
    buyNow: fixed ? undefined : (item["buyNowPrice"] as number | undefined),
    shipping: item["isFreeShipping"] === true ? "free" : undefined,
    condition: cond === "NEW" ? Condition.New : cond?.startsWith("USED") ? Condition.Used : undefined,
    seller: str(seller?.["displayName"]),
    sellerFeedbackPercent: str(seller?.["goodRating"]),
    promoted: item["isFeatured"] === true,
    image: str(item["imageUrl"], 2_000),
    details: { Category: str(pick(item, ["category", "name"])), Condition: cond },
    country: "jp",
  };
}

export const yahooAuctions: ShoppingSite = {
  key: "yahoo_auctions",
  host: "auctions.yahoo.co.jp",
  country: "jp",
  currency: "JPY",
  language: "ja",
  kind: "auction",
  listingId: (url) => /^\/jp\/auction\/([a-z]?\d{9,11})\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const price = `${sq.minPrice !== undefined ? `&aucminprice=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&aucmaxprice=${Math.ceil(sq.maxPrice)}` : ""}`;
    const sort = SORTS[sq.sort] ?? "";
    return {
      url: `https://auctions.yahoo.co.jp/search/search?p=${q(sq.query)}&n=${PAGE_SIZE}&b=${(sq.page - 1) * PAGE_SIZE + 1}${price}${sort}`,
      applies: { sort: sort !== "" || sq.sort === ShoppingSort.Relevance, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const listing = pick(nextData(page.content), ["props", "pageProps", "initialState", "search", "items", "listing"]) as Record<string, unknown> | undefined;
    if (!listing) return { kind: "failed", failure: "redesigned", detail: "no search listing in __NEXT_DATA__" };
    const items = Array.isArray(listing["items"]) ? (listing["items"] as Record<string, unknown>[]) : [];
    const total = typeof listing["totalResultsAvailable"] === "number" ? listing["totalResultsAvailable"] : undefined;
    if (items.length === 0) return { kind: "empty" };
    const rows = items.map(row).filter((r): r is RawListing => r !== undefined);
    return { kind: "results", rows, total, hasMore: total !== undefined && items.length === PAGE_SIZE };
  },
};
