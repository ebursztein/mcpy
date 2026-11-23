/**
 * Shpock UK. Probed 2026-11-22: /en-gb/results renders (HTTP 200, from
 * Cloudflare and a residential IP) but its server-side itemSearch is empty:
 * Shpock locates the visitor by IP (cc:us, "loc:new york") and finds nothing
 * near a US address. The page's own GraphQL endpoint (POST /graphql,
 * ItemSearch) takes the same serialized filters as the page and honours a
 * distance filter with an explicit location: centred on Great Britain with a
 * 1000 km radius it returns UK rows (30 a page, offset paging). sort
 * {"type":"date_listed","direction":"d"} is newest first, price a/d the price
 * orders; price {"from","to"} is applied by the API (checked: every row >=
 * the floor). An unknown query answers an empty items list.
 */

import { HttpMethod } from "../../../enums.js";
import { ListingStatus, ShoppingSort } from "../../../services/shopping/schema.js";
import { bodyJson, pick } from "../../readers/json.js";
import { looksBlocked } from "../../readers/html.js";
import { str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";

const PAGE_SIZE = 30;
const SORTS: Partial<Record<string, { type: string; direction: string }>> = {
  [ShoppingSort.Newest]: { type: "date_listed", direction: "d" },
  [ShoppingSort.PriceLow]: { type: "price", direction: "a" },
  [ShoppingSort.PriceHigh]: { type: "price", direction: "d" },
  [ShoppingSort.Relevance]: { type: "relevance", direction: "d" },
};
/** Roughly the centre of Great Britain; 1000 km covers the UK. */
const UK = { location: { lat: 54.0, lng: -2.5 }, radius: 1000 };

const QUERY =
  "query ItemSearch($serializedFilters: String, $pagination: Pagination, $trackingSource: TrackingSource!) {" +
  " itemSearch(serializedFilters: $serializedFilters, pagination: $pagination, trackingSource: $trackingSource) {" +
  " offset limit count total itemResults { distanceGroup items { __typename ... on ItemSummary {" +
  " id title description path locality price originalPrice currency media { id } isNew isSold isFree isOnSale isBoosted isShippable isExpired canonicalURL } } } } }";

function row(item: Record<string, unknown>): RawListing | undefined {
  if (item["__typename"] !== "ItemSummary") return undefined;
  const path = str(item["canonicalURL"], 2_000) ?? str(item["path"], 2_000);
  if (!path) return undefined;
  const media = str(pick(item, ["media", 0, "id"]));
  const was = item["originalPrice"];
  return {
    url: path,
    id: str(item["id"]),
    title: str(item["title"]),
    description: str(item["description"], 1_200),
    price: item["isFree"] === true ? undefined : (item["price"] as number | undefined),
    currency: str(item["currency"])?.toUpperCase(),
    status: item["isSold"] === true ? ListingStatus.SoldOut : undefined,
    location: str(item["locality"]),
    country: "gb",
    promoted: item["isBoosted"] === true,
    image: media ? `https://m1.secondhandapp.at/2.0/${media}` : undefined,
    details: {
      Free: item["isFree"] === true ? true : undefined,
      "Was price": typeof was === "number" ? was : undefined,
      Shipping: item["isShippable"] === true ? "available" : undefined,
      New: item["isNew"] === true ? true : undefined,
    },
  };
}

export const shpock: ShoppingSite = {
  key: "shpock",
  host: "www.shpock.com",
  country: "gb",
  currency: "GBP",
  language: "en",
  kind: SiteKind.Classifieds,
  listingId: (url) => /^\/en-gb\/i\/([A-Za-z0-9_-]+)\//.exec(url.pathname)?.[1],
  search(sq) {
    const sort = SORTS[sq.sort];
    const price = sq.minPrice !== undefined || sq.maxPrice !== undefined ? { price: { ...(sq.minPrice !== undefined ? { from: sq.minPrice } : {}), ...(sq.maxPrice !== undefined ? { to: sq.maxPrice } : {}) } } : {};
    const filters = { q: sq.query, distance: UK, ...(sort ? { sort } : {}), ...price };
    return {
      url: "https://www.shpock.com/graphql",
      method: HttpMethod.Post,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        operationName: "ItemSearch",
        query: QUERY,
        variables: { serializedFilters: JSON.stringify(filters), pagination: { limit: PAGE_SIZE, offset: (sq.page - 1) * PAGE_SIZE }, trackingSource: "Search" },
      }),
      applies: { sort: sort !== undefined, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const search = pick(bodyJson(page.content), ["data", "itemSearch"]) as Record<string, unknown> | undefined;
    const groups = search?.["itemResults"];
    if (!Array.isArray(groups)) return { kind: "failed", failure: "redesigned", detail: "no data.itemSearch.itemResults in the GraphQL answer" };
    const items = (groups as Record<string, unknown>[]).flatMap((g) => (Array.isArray(g["items"]) ? (g["items"] as Record<string, unknown>[]) : []));
    if (items.length === 0) return { kind: "empty" };
    const rows = items.map(row).filter((r): r is RawListing => r !== undefined);
    return { kind: "results", rows, hasMore: items.length >= PAGE_SIZE };
  },
};
