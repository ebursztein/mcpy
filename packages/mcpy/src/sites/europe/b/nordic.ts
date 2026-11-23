/**
 * The Nordic classifieds that share one platform: FINN (no), Blocket (se),
 * DBA (dk) and Tori (fi). Probed 2026-11-22 through tools.ly.tl: every host
 * serves the JSON the search page itself calls, by plain GET, at
 * /recommerce/forsale/search/api/search/SEARCH_ID_BAP_COMMON (53 rows a page).
 * The site applies sort=PUBLISHED_DESC|PRICE_ASC|PRICE_DESC and
 * price_from/price_to (checked: every row >= the floor, every row <= the cap,
 * newest-first timestamps). Rows found only by the semantic (vector) search
 * are near-matches, not results, and are dropped.
 */

import type { Country, Currency, Language } from "../../../services/common.js";
import type { Marketplace } from "../../../services/shopping/marketplace.js";
import { ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import { looksBlocked } from "../../readers/html.js";
import { bodyJson, pick } from "../../readers/json.js";
import { q, str } from "../../readers/values.js";
import { blocked, redesigned } from "./outcome.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";

interface NordicSettings {
  key: Marketplace;
  host: string;
  country: Country;
  currency: Currency;
  language: Language;
  /** The trade_type label of a buyer's "wanted" post. */
  wanted: string;
}

const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "PUBLISHED_DESC",
  [ShoppingSort.PriceLow]: "PRICE_ASC",
  [ShoppingSort.PriceHigh]: "PRICE_DESC",
  [ShoppingSort.Relevance]: "RELEVANCE",
};

/** Which search found the row: keyword, semantic (vector only) or both. */
const SEMANTIC_ONLY = "semantic";

function row(doc: Record<string, unknown>, s: NordicSettings): RawListing | undefined {
  if (pick(doc, ["metadata", "source"]) === SEMANTIC_ONLY) return undefined;
  const id = str(doc["id"]) ?? str(doc["ad_id"]);
  if (!id) return undefined;
  const flags = Array.isArray(doc["flags"]) ? (doc["flags"] as unknown[]).filter((f): f is string => typeof f === "string") : [];
  const tradeType = str(doc["trade_type"]);
  const retailer = flags.includes("retailer");
  return {
    url: str(doc["canonical_url"], 2_000) ?? `https://${s.host}/recommerce/forsale/item/${id}`,
    id,
    title: str(doc["heading"]),
    price: pick(doc, ["price", "amount"]) as number | undefined,
    currency: str(pick(doc, ["price", "currency_code"])),
    format: tradeType === s.wanted ? ListingFormat.Wanted : ListingFormat.FixedPrice,
    postedAt: typeof doc["timestamp"] === "number" ? doc["timestamp"] : undefined,
    location: str(doc["location"]),
    country: s.country,
    seller: retailer ? str(doc["organisation_name"]) : undefined,
    image: str(pick(doc, ["image", "url"]), 2_000),
    details: {
      "Trade type": tradeType,
      Seller: retailer ? "business" : flags.includes("private") ? "private" : undefined,
      Shipping: flags.includes("shipping_exists") ? "available" : undefined,
      "Buy now": flags.includes("buy_now") ? true : undefined,
      Brand: str(doc["brand"]),
    },
  };
}

function nordicSite(s: NordicSettings): ShoppingSite {
  return {
    key: s.key,
    host: s.host,
    country: s.country,
    currency: s.currency,
    language: s.language,
    kind: SiteKind.Classifieds,
    listingId: (url) => /^\/recommerce\/forsale\/item\/(\d+)\/?$/.exec(url.pathname)?.[1],
    search(sq) {
      const sort = SORTS[sq.sort];
      const price = `${sq.minPrice !== undefined ? `&price_from=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&price_to=${Math.ceil(sq.maxPrice)}` : ""}`;
      return {
        url: `https://${s.host}/recommerce/forsale/search/api/search/SEARCH_ID_BAP_COMMON?q=${q(sq.query)}${sort ? `&sort=${sort}` : ""}${price}${sq.page > 1 ? `&page=${sq.page}` : ""}`,
        headers: { accept: "application/json" },
        applies: { sort: sort !== undefined, minPrice: true, maxPrice: true },
      };
    },
    read(page) {
      const body = bodyJson(page.content) as Record<string, unknown> | undefined;
      if (!body) return looksBlocked(page.content) ? blocked("challenge page") : redesigned("search API did not return JSON");
      const docs = body["docs"];
      if (!Array.isArray(docs)) return redesigned("no docs in the search API response");
      if (docs.length === 0) return { kind: "empty" };
      const rows = (docs as Record<string, unknown>[]).map((d) => row(d, s)).filter((r): r is RawListing => r !== undefined);
      if (rows.length === 0) return { kind: "empty" };
      const total = pick(body, ["metadata", "result_size", "match_count"]);
      const current = pick(body, ["metadata", "paging", "current"]);
      const last = pick(body, ["metadata", "paging", "last"]);
      const end = pick(body, ["metadata", "is_end_of_paging"]) === true;
      return {
        kind: "results",
        rows,
        total: typeof total === "number" ? total : undefined,
        hasMore: !end && typeof current === "number" && typeof last === "number" && current < last,
      };
    },
  };
}

export const finn = nordicSite({ key: "finn", host: "www.finn.no", country: "no", currency: "NOK", language: "nb", wanted: "Ønskes kjøpt" });
export const blocket = nordicSite({ key: "blocket", host: "www.blocket.se", country: "se", currency: "SEK", language: "sv", wanted: "Köpes" });
export const dba = nordicSite({ key: "dba", host: "www.dba.dk", country: "dk", currency: "DKK", language: "da", wanted: "Købes" });
export const tori = nordicSite({ key: "tori", host: "www.tori.fi", country: "fi", currency: "EUR", language: "fi", wanted: "Ostetaan" });
