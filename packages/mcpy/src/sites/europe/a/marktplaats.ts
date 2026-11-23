/**
 * Marktplaats (NL) and 2dehands (BE): one Adevinta platform. Probed
 * 2026-11-22 through tools.ly.tl: the search page's own JSON API
 * /lrp/api/search answers a plain fetch (30 rows, offset paging).
 * sortBy=SORT_INDEX&sortOrder=DECREASING (newest), PRICE INCREASING|DECREASING
 * and attributeRanges[]=PriceCents:MIN:MAX (cents, "null" for an open end)
 * are applied by the site (checked: every row inside the range, echoed in
 * searchRequest.attributeRanges). topBlock holds commercial ads and is never
 * read. The API matches any query word (a nonsense query returns "Glurak"
 * cards, "black lotus" returns Lotus cars), so rows must contain every word.
 * Rows state their date as text ("Vandaag", "6 sep 26"): kept as postedText.
 */

import { Condition, ListingFormat, ListingStatus, ShoppingSort } from "../../../services/shopping/schema.js";
import type { Country } from "../../../services/common.js";
import type { Marketplace } from "../../../services/shopping/marketplace.js";
import { looksBlocked } from "../../readers/html.js";
import { bodyJson } from "../../readers/json.js";
import { q, str } from "../../readers/values.js";
import type { RawListing, ShoppingSite } from "../../types.js";
import { relevant, Relevance } from "./shared.js";

const PAGE_SIZE = 30;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "&sortBy=SORT_INDEX&sortOrder=DECREASING",
  [ShoppingSort.PriceLow]: "&sortBy=PRICE&sortOrder=INCREASING",
  [ShoppingSort.PriceHigh]: "&sortBy=PRICE&sortOrder=DECREASING",
  [ShoppingSort.Relevance]: "&sortBy=OPTIMIZED&sortOrder=DECREASING",
};

type Obj = Record<string, unknown>;

/** priceType -> format; FIXED states the asking price, MIN_BID the minimum bid. */
const FORMATS: Partial<Record<string, ListingFormat>> = {
  FIXED: ListingFormat.FixedPrice,
  MIN_BID: ListingFormat.BestOffer,
  FAST_BID: ListingFormat.BestOffer,
  NOTK: ListingFormat.BestOffer,
  FREE: ListingFormat.FixedPrice,
};

function attribute(item: Obj, key: string): string | undefined {
  const list = Array.isArray(item["attributes"]) ? (item["attributes"] as Obj[]) : [];
  return str(list.find((a) => a["key"] === key)?.["value"]);
}

function condition(label: string | undefined): Condition | undefined {
  if (!label) return undefined;
  if (/^nieuw$/i.test(label)) return Condition.New;
  if (/niet werkend|defect/i.test(label)) return Condition.ForParts;
  return Condition.Used;
}

function row(item: Obj, origin: string, country: Country): RawListing | undefined {
  const path = str(item["vipUrl"], 2_000);
  if (!path) return undefined;
  const info = (item["priceInfo"] ?? {}) as Obj;
  const type = str(info["priceType"]);
  const cents = typeof info["priceCents"] === "number" ? info["priceCents"] : 0;
  const location = (item["location"] ?? {}) as Obj;
  const cond = attribute(item, "condition");
  const priority = str(item["priorityProduct"]);
  return {
    url: new URL(path, origin).href,
    id: str(item["itemId"]),
    title: str(item["title"]),
    description: str(item["description"], 1_200),
    price: (type === "FIXED" || type === "MIN_BID") && cents > 0 ? cents / 100 : undefined,
    currency: "EUR",
    format: type ? FORMATS[type] : undefined,
    condition: condition(cond),
    status: item["reserved"] === true ? ListingStatus.Reserved : undefined,
    postedText: str(item["date"]),
    location: str(location["cityName"]),
    country: location["abroad"] === true ? undefined : country,
    seller: str((item["sellerInformation"] as Obj | undefined)?.["sellerName"]),
    promoted: priority !== undefined && priority !== "NONE",
    image: str((item["imageUrls"] as unknown[] | undefined)?.[0], 2_000),
    details: { Price: type, Condition: cond, Delivery: attribute(item, "delivery") },
  };
}

function platform(key: Marketplace, host: string, country: Country): ShoppingSite {
  const origin = `https://${host}`;
  return {
    key,
    host,
    country,
    currency: "EUR",
    language: "nl",
    kind: "classifieds",
    listingId: (url) => /^\/v\/(?:[^/]+\/){1,2}([ma]\d{6,})-/.exec(url.pathname)?.[1],
    search(sq) {
      const sort = SORTS[sq.sort] ?? "";
      const range =
        sq.minPrice !== undefined || sq.maxPrice !== undefined
          ? `&attributeRanges[]=PriceCents:${sq.minPrice !== undefined ? Math.floor(sq.minPrice * 100) : "null"}:${sq.maxPrice !== undefined ? Math.ceil(sq.maxPrice * 100) : "null"}`
          : "";
      return {
        url: `${origin}/lrp/api/search?query=${q(sq.query)}&limit=${PAGE_SIZE}&offset=${(sq.page - 1) * PAGE_SIZE}${sort}${range}`,
        format: "html",
        applies: { sort: sort !== "", minPrice: true, maxPrice: true },
      };
    },
    read(page, sq) {
      const data = bodyJson(page.content) as Obj | undefined;
      if (!data) return looksBlocked(page.content) ? { kind: "failed", failure: "blocked", detail: "challenge page" } : { kind: "failed", failure: "redesigned", detail: "search API did not return JSON" };
      if (!Array.isArray(data["listings"])) return { kind: "failed", failure: "redesigned", detail: "no listings in search API response" };
      const listings = data["listings"] as Obj[];
      const hits = relevant(sq.query, listings, (i) => [str(i["title"]), str(i["description"], 5_000)], Relevance.Row);
      if (hits.length === 0) return { kind: "empty" };
      const rows = hits.map((i) => row(i, origin, country)).filter((r): r is RawListing => r !== undefined);
      const total = hits.length === listings.length && typeof data["totalResultCount"] === "number" ? data["totalResultCount"] : undefined;
      return { kind: "results", rows, total, hasMore: listings.length >= PAGE_SIZE };
    },
  };
}

export const marktplaats = platform("marktplaats", "www.marktplaats.nl", "nl");
export const tweedehands = platform("2dehands", "www.2dehands.be", "be");
