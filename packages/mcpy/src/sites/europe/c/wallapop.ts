/**
 * Wallapop Spain. Probed 2026-11-22: es.wallapop.com/app/search answers a
 * 307 and /search is an app shell without rows; the JSON API the web app
 * calls, api.wallapop.com/api/v3/search, answers 403 unless the request
 * carries the app's X-DeviceOS header, and then serves 40 rows with a plain
 * GET (no cookie, no token). It needs a search centre: Madrid, as the web
 * app uses for a visitor without a location (rows come from all of Spain,
 * nearest first only under distance sort). order_by=newest is newest first,
 * price_low_to_high / price_high_to_low the price orders;
 * min_sale_price/max_sale_price are applied by the API (checked: every row
 * within 50-200). Paging is by cursor: meta.next_page is an opaque token
 * that carries the whole search (keywords, order, prices); the next page is
 * /api/v3/search?next_page=<token> (checked: 40 new rows, another token).
 */

import { ListingStatus, ShoppingSort } from "../../../services/shopping/schema.js";
import { bodyJson, pick } from "../../readers/json.js";
import { looksBlocked } from "../../readers/html.js";
import { q, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";

const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "newest",
  [ShoppingSort.PriceLow]: "price_low_to_high",
  [ShoppingSort.PriceHigh]: "price_high_to_low",
};
/** The longest per-site token the shopping service carries in next_cursor (service.ts). */
const MADRID = "latitude=40.41956&longitude=-3.69196";

function row(item: Record<string, unknown>): RawListing | undefined {
  const slug = str(item["web_slug"], 1_000);
  if (!slug) return undefined;
  const loc = item["location"] as Record<string, unknown> | undefined;
  const bump = str(pick(item, ["bump", "type"]));
  return {
    url: `https://es.wallapop.com/item/${slug}`,
    id: str(item["id"]),
    title: str(item["title"]),
    description: str(item["description"], 1_200),
    price: pick(item, ["price", "amount"]) as number | undefined,
    currency: str(pick(item, ["price", "currency"])),
    status: pick(item, ["reserved", "flag"]) === true ? ListingStatus.Reserved : undefined,
    postedAt: typeof item["created_at"] === "number" ? (item["created_at"] as number) : undefined,
    location: [str(loc?.["city"]), str(loc?.["region2"]) ?? str(loc?.["region"])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ") || undefined,
    country: str(loc?.["country_code"]),
    promoted: bump !== undefined && bump !== "none",
    image: str(pick(item, ["images", 0, "urls", "medium"]), 2_000),
    details: {
      Category: (Array.isArray(item["taxonomy"]) ? (item["taxonomy"] as Record<string, unknown>[]) : []).map((t) => str(t["name"])).filter(Boolean).join(" › ") || undefined,
      Shipping: pick(item, ["shipping", "user_allows_shipping"]) === true ? "available" : undefined,
      Refurbished: pick(item, ["is_refurbished", "flag"]) === true ? true : undefined,
    },
  };
}

export const wallapop: ShoppingSite = {
  key: "wallapop",
  // any query word matches: "black lotus" returned Lotus watches (2026-11-23).
  matchesLoosely: true,
  host: "es.wallapop.com",
  country: "es",
  currency: "EUR",
  language: "es",
  kind: SiteKind.Classifieds,
  pagesByCursor: true,
  listingId: (url) => /^\/item\/[a-z0-9-]*?-?(\d+)$/.exec(url.pathname)?.[1],
  search(sq) {
    const order = SORTS[sq.sort];
    const price = `${sq.minPrice !== undefined ? `&min_sale_price=${sq.minPrice}` : ""}${sq.maxPrice !== undefined ? `&max_sale_price=${sq.maxPrice}` : ""}`;
    const headers = { "X-DeviceOS": "0", Accept: "application/json" };
    const applies = { sort: order !== undefined, minPrice: true, maxPrice: true };
    // The token already holds the search's keywords, order and prices.
    if (sq.cursor) return { url: `https://api.wallapop.com/api/v3/search?next_page=${q(sq.cursor)}`, headers, applies };
    return {
      url: `https://api.wallapop.com/api/v3/search?source=search_box&keywords=${q(sq.query)}&${MADRID}${order ? `&order_by=${order}` : ""}${price}`,
      headers,
      applies,
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const body = bodyJson(page.content);
    const items = pick(body, ["data", "section", "payload", "items"]);
    if (!Array.isArray(items)) return { kind: "failed", failure: "redesigned", detail: "no data.section.payload.items in the search API answer" };
    if (items.length === 0) return { kind: "empty" };
    const rows = (items as Record<string, unknown>[]).map(row).filter((r): r is RawListing => r !== undefined);
    const token = str(pick(body, ["meta", "next_page"]), 4_000);
    // A signed token of ~930 chars; the service carries it inside next_cursor.
    return { kind: "results", rows, hasMore: token !== undefined, nextCursor: token };
  },
};
