/**
 * eBay's Browse API (item_summary/search) through picclick.com/search.php:
 * the first source of every eBay store. Probed 2026-11-23: PicClick passes
 * the query to eBay on its own key (EBAY_US marketplace) and returns eBay's
 * JSON unchanged. A plain GET from Cloudflare answers in about 1 s, free, no
 * render; it needs a picclick.com Referer and the `lasturl` and `slider`
 * cookies (any values), else HTTP 200 with an empty body. Undocumented: when
 * it fails, a store with a search page reads that page, then its listing API.
 *
 * A country store asks for listings located in its country unless the query
 * names seller countries (`itemLocationCountry`): live, every country probed
 * answered (pokemon: US 16.8M, GB 2.2M, CA 1.8M, AU 1.75M, JP 1.5M, DE 723k,
 * CN 261k...). Query parameters and the filters eBay applies: browse-query.ts.
 *
 * Prices: eBay states each price in USD for a US buyer and, for a listing in
 * another currency, adds `convertedFromValue` / `convertedFromCurrency`, the
 * seller's own price. Rows carry that one, so nothing here is converted.
 * Price bounds are eBay's filter in the store's currency (`priceCurrency`;
 * live, a 100 EUR floor on DE returned rows from 100.00 EUR).
 *
 * Facets: on request, eBay's category and aspect counts (the top categories,
 * and each aspect's most common values) come back on the report.
 */

import type { Country, Currency } from "../../services/common.js";
import { Condition, ListingFormat, type Facets } from "../../services/shopping/schema.js";
import { ListingMarket } from "../../providers/listing-types.js";
import { bodyJson, pick } from "../readers/json.js";
import { looksBlocked } from "../readers/html.js";
import { str } from "../readers/values.js";
import { SiteKind, type RawListing, type ReadOutcome, type ShoppingSite, type SiteQuery, type SiteRequest } from "../types.js";
import { browseParams } from "./browse-query.js";
import { ebayItemId } from "./card.js";
import { ebayListingApi } from "./listing-api.js";

const HEADERS = { referer: "https://picclick.com/", cookie: "lasturl=x; slider=1" };
const ENGLISH_FREE = /^Free (?:delivery|shipping)\b/i;

type Json = Record<string, unknown>;

/** Where a store's Browse rows point and what it asks for. */
export interface BrowseScope {
  /** The eBay host listing URLs are built on (www.ebay.de/itm/<id>). */
  host: string;
  /** The store's seller country when the query names none; unset: every country. */
  country?: Country;
  /** The store's currency: price bounds are in it. */
  currency: Currency;
}

export type BrowseFeed = NonNullable<ShoppingSite["feed"]>;

/** eBay condition ids, grouped as browse-query.ts filters them (2750 and 4000: graded / ungraded cards, like new / very good). */
function conditionOf(id: string | undefined): Condition | undefined {
  const n = Number(id);
  if (n === 1000) return Condition.New;
  if (n === 1500) return Condition.OpenBox;
  if (n >= 2000 && n <= 2500) return Condition.Refurbished;
  if (n === 2750 || n === 3000 || n === 4000 || n === 5000 || n === 6000) return Condition.Used;
  if (n === 7000) return Condition.ForParts;
  return undefined;
}

/** The seller's own amount and currency: eBay's original when it converted, else its stated price. */
function own(money: unknown): { amount?: string; currency?: string; usd?: string } {
  if (!money || typeof money !== "object") return {};
  const m = money as Json;
  const from = str(m["convertedFromValue"]);
  return from ? { amount: from, currency: str(m["convertedFromCurrency"]), usd: str(m["value"]) } : { amount: str(m["value"]), currency: str(m["currency"]), usd: m["currency"] === "USD" ? str(m["value"]) : undefined };
}

function shippingOf(options: unknown): { shipping?: string; currency?: string } {
  const first = Array.isArray(options) ? (options[0] as Json | undefined) : undefined;
  if (first?.["shippingCostType"] !== "FIXED") return {};
  const cost = own(first["shippingCost"]);
  return { shipping: cost.amount, currency: cost.currency };
}

function row(item: Json, host: string): RawListing | undefined {
  const id = str(item["legacyItemId"]);
  if (!id || !/^\d{9,15}$/.test(id)) return undefined;
  const options = Array.isArray(item["buyingOptions"]) ? (item["buyingOptions"] as unknown[]) : [];
  const auction = options.includes("AUCTION");
  const fixed = own(item["price"]);
  const price = auction ? own(item["currentBidPrice"]) : fixed;
  const ship = shippingOf(item["shippingOptions"]);
  const format = auction ? ListingFormat.Auction : options.includes("BEST_OFFER") ? ListingFormat.BestOffer : options.includes("FIXED_PRICE") ? ListingFormat.FixedPrice : undefined;
  return {
    url: `https://${host}/itm/${id}`,
    id,
    title: str(item["title"]),
    price: price.amount,
    currency: price.currency,
    format,
    bids: auction ? (item["bidCount"] as number | undefined) : undefined,
    endsAt: auction ? str(item["itemEndDate"]) : undefined,
    buyNow: auction && options.includes("FIXED_PRICE") && fixed.currency === price.currency ? fixed.amount : undefined,
    shipping: ship.shipping,
    shippingCurrency: ship.currency,
    condition: conditionOf(str(item["conditionId"])),
    postedAt: str(item["itemCreationDate"]),
    location: str(pick(item, ["itemLocation", "city"])),
    country: str(pick(item, ["itemLocation", "country"]))?.toLowerCase(),
    seller: str(pick(item, ["seller", "username"])),
    sellerFeedbackCount: pick(item, ["seller", "feedbackScore"]) as number | undefined,
    sellerFeedbackPercent: str(pick(item, ["seller", "feedbackPercentage"])),
    image: str(pick(item, ["thumbnailImages", 0, "imageUrl"]), 2_000) ?? str(pick(item, ["image", "imageUrl"]), 2_000),
    details: {
      Condition: str(item["condition"]),
      "eBay site": str(item["listingMarketplaceId"]),
      "USD price": price.usd,
      Watchers: typeof item["watchCount"] === "number" ? item["watchCount"] : undefined,
      "Top rated": item["topRatedBuyingExperience"] === true ? true : undefined,
    },
  };
}

const MAX_FACET_CATEGORIES = 20;
const MAX_FACET_ATTRIBUTES = 30;
const MAX_FACET_VALUES = 12;

const count = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

/** eBay's refinement block as facets, most common first and capped. */
function facetsOf(refinement: unknown): Facets | undefined {
  if (!refinement || typeof refinement !== "object") return undefined;
  const r = refinement as Json;
  const list = (v: unknown) => (Array.isArray(v) ? (v as Json[]) : []);
  const categories = list(r["categoryDistributions"])
    .flatMap((c) => {
      const id = str(c["categoryId"]);
      const name = str(c["categoryName"]);
      return id && name ? [{ id, name, count: count(c["matchCount"]) }] : [];
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_FACET_CATEGORIES);
  const attributes = list(r["aspectDistributions"])
    .flatMap((a) => {
      const name = str(a["localizedAspectName"]);
      const values = list(a["aspectValueDistributions"])
        .flatMap((v) => {
          const value = str(v["localizedAspectValue"]);
          return value ? [{ value, count: count(v["matchCount"]) }] : [];
        })
        .sort((x, y) => y.count - x.count)
        .slice(0, MAX_FACET_VALUES);
      return name && values.length ? [{ name, values }] : [];
    })
    .slice(0, MAX_FACET_ATTRIBUTES);
  return categories.length || attributes.length ? { categories, attributes } : undefined;
}

function read(content: string, host: string): ReadOutcome {
  // Without the Referer or cookies the proxy answers 200 with nothing at all.
  if (!content.trim()) return { kind: "failed", failure: "blocked", detail: "the search answered an empty body" };
  if (looksBlocked(content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
  const body = bodyJson(content) as Json | undefined;
  if (!body || typeof body !== "object") return { kind: "failed", failure: "redesigned", detail: "the search answered no JSON" };
  if (Array.isArray(body["errors"])) return { kind: "failed", failure: "upstream_failed", detail: `eBay error: ${str(pick(body, ["errors", 0, "message"])) ?? "unknown"}` };
  if (typeof body["total"] !== "number") return { kind: "failed", failure: "redesigned", detail: "no total in eBay's answer" };
  const items = Array.isArray(body["itemSummaries"]) ? (body["itemSummaries"] as Json[]) : [];
  if (items.length === 0) return { kind: "empty" };
  const rows = items.map((i) => row(i, host)).filter((r): r is RawListing => r !== undefined);
  const facets = facetsOf(body["refinement"]);
  return { kind: "results", rows, total: body["total"], hasMore: typeof body["next"] === "string", ...(facets ? { facets } : {}) };
}

function request(sq: SiteQuery, scope: BrowseScope): SiteRequest {
  const { params, applies } = browseParams(sq, scope);
  return { url: `https://picclick.com/search.php?${params}`, headers: HEADERS, applies };
}

/** The Browse search for one store. */
export function browseFeed(scope: BrowseScope): BrowseFeed {
  return { search: (sq) => request(sq, scope), read: (page) => read(page.content, scope.host) };
}

/**
 * Every eBay site in one search, each row at its seller's own price; narrow
 * it with seller_country, category, attributes and the listing filters.
 */
export const ebayWorldwide: ShoppingSite = (() => {
  const feed = browseFeed({ host: "www.ebay.com", currency: "USD" });
  return {
    key: "ebay",
    host: "picclick.com",
    listingHosts: ["www.ebay.com"],
    country: "us",
    currency: "USD",
    language: "en",
    kind: SiteKind.Marketplace,
    listingId: ebayItemId,
    // The same item numbers on every eBay store: a call returns each listing once.
    listingPool: "ebay",
    search: feed.search,
    read: feed.read,
    api: ebayListingApi(ListingMarket.EbayUs, "www.ebay.com", ENGLISH_FREE),
  };
})();
