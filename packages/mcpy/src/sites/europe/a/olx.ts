/**
 * OLX in Poland, Portugal, Romania, Bulgaria and Ukraine: one platform.
 * Probed 2026-11-22 through tools.ly.tl: the public API the search page calls,
 * /api/v1/offers/, answers a plain fetch on every domain (40 rows, offset
 * paging; the site serves the first 1000). sort_by=created_at:desc (newest),
 * filter_float_price:asc|desc, filter_float_price:from/to and offset are
 * applied by the site (checked: every row inside the range, prices
 * ascending). Promoted rows (metadata.promoted indexes, promotion.top_ad) are
 * interleaved with the organic ones and marked promoted. The API is typo
 * tolerant: a nonsense query returns tractors. On the Latin-script sites a
 * row must contain every query word in title or description; Ukrainian and
 * Bulgarian sellers write "charizard" as "Чарізард", so there a page is
 * empty only when no row has every word. Partner listings (otodom, otomoto)
 * live on other hosts and are not listings of this site.
 */

import { Condition, ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import type { Country, Currency, Language } from "../../../services/common.js";
import type { Marketplace } from "../../../services/shopping/marketplace.js";
import { looksBlocked } from "../../readers/html.js";
import { bodyJson, pick } from "../../readers/json.js";
import { q, str } from "../../readers/values.js";
import type { RawListing, ShoppingSite } from "../../types.js";
import { relevant, Relevance } from "./shared.js";

const PAGE_SIZE = 40;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "created_at:desc",
  [ShoppingSort.PriceLow]: "filter_float_price:asc",
  [ShoppingSort.PriceHigh]: "filter_float_price:desc",
};

type Obj = Record<string, unknown>;

interface Settings {
  key: Marketplace;
  tld: string;
  country: Country;
  currency: Currency;
  language: Language;
  relevance: Relevance;
}

function param(offer: Obj, key: string): Obj | undefined {
  const list = Array.isArray(offer["params"]) ? (offer["params"] as Obj[]) : [];
  return list.find((p) => p["key"] === key)?.["value"] as Obj | undefined;
}

function condition(key: string | undefined): Condition | undefined {
  if (key === "new") return Condition.New;
  if (key === "used") return Condition.Used;
  if (key === "damaged" || key === "broken") return Condition.ForParts;
  return undefined;
}

const plain = (html: unknown, max: number) => str(typeof html === "string" ? html.replace(/<[^>]+>/g, " ") : undefined, max);

function row(offer: Obj, promotedAt: Set<number>, index: number, country: Country): RawListing | undefined {
  const url = str(offer["url"], 2_000);
  if (!url) return undefined;
  const price = param(offer, "price");
  const state = param(offer, "state");
  const user = (offer["user"] ?? {}) as Obj;
  const city = str(pick(offer, ["location", "city", "name"]));
  const region = str(pick(offer, ["location", "region", "name"]));
  const photo = str(pick(offer, ["photos", 0, "link"]), 2_000);
  const wanted = offer["offer_type"] === "buy" || offer["offer_type"] === "seek";
  return {
    url,
    id: str(offer["id"]),
    title: str(offer["title"]),
    description: plain(offer["description"], 1_200),
    price: typeof price?.["value"] === "number" ? price["value"] : undefined,
    currency: str(price?.["currency"]),
    format: wanted ? ListingFormat.Wanted : price?.["negotiable"] === true ? ListingFormat.BestOffer : ListingFormat.FixedPrice,
    condition: condition(str(state?.["key"])),
    postedAt: str(offer["created_time"]),
    location: city && region ? `${city}, ${region}` : (city ?? region),
    country,
    seller: str(user["company_name"]) ?? str(user["name"]),
    promoted: promotedAt.has(index) || pick(offer, ["promotion", "top_ad"]) === true,
    image: photo?.replace("{width}x{height}", "400x300"),
    details: {
      Price: str(price?.["label"]),
      Condition: str(state?.["label"]),
      Seller: offer["business"] === true ? "business" : offer["business"] === false ? "private" : undefined,
      Delivery: pick(offer, ["delivery", "rock", "active"]) === true ? true : undefined,
      Refreshed: str(offer["last_refresh_time"]),
    },
  };
}

function olx(s: Settings): ShoppingSite {
  const host = `www.olx.${s.tld}`;
  return {
    key: s.key,
    host,
    country: s.country,
    currency: s.currency,
    language: s.language,
    kind: "classifieds",
    listingId: (url) => /-ID([A-Za-z0-9]+)\.html$/.exec(url.pathname)?.[1],
    search(sq) {
      const sort = SORTS[sq.sort];
      const offset = (sq.page - 1) * PAGE_SIZE;
      const price = `${sq.minPrice !== undefined ? `&filter_float_price:from=${sq.minPrice}` : ""}${sq.maxPrice !== undefined ? `&filter_float_price:to=${sq.maxPrice}` : ""}`;
      return {
        url: `https://${host}/api/v1/offers/?offset=${offset}&limit=${PAGE_SIZE}&query=${q(sq.query)}${sort ? `&sort_by=${sort}` : ""}${price}`,
        applies: { sort: sort !== undefined || sq.sort === ShoppingSort.Relevance, minPrice: true, maxPrice: true },
      };
    },
    read(page, sq) {
      const data = bodyJson(page.content) as Obj | undefined;
      if (!data) return looksBlocked(page.content) ? { kind: "failed", failure: "blocked", detail: "challenge page" } : { kind: "failed", failure: "redesigned", detail: "offers API did not return JSON" };
      if (!Array.isArray(data["data"])) return { kind: "failed", failure: "redesigned", detail: "no data in offers API response" };
      const offers = data["data"] as Obj[];
      const promoted = pick(data, ["metadata", "promoted"]);
      const promotedAt = new Set(Array.isArray(promoted) ? promoted.filter((n): n is number => typeof n === "number") : []);
      const indexed = offers.map((offer, index) => ({ offer, index }));
      const hits = relevant(sq.query, indexed, ({ offer }) => [str(offer["title"]), plain(offer["description"], 5_000)], s.relevance);
      if (hits.length === 0) return { kind: "empty" };
      const rows = hits.map(({ offer, index }) => row(offer, promotedAt, index, s.country)).filter((r): r is RawListing => r !== undefined);
      const visible = pick(data, ["metadata", "visible_total_count"]);
      const total = hits.length === offers.length && typeof visible === "number" ? visible : undefined;
      return { kind: "results", rows, total, hasMore: offers.length >= PAGE_SIZE && typeof pick(data, ["links", "next", "href"]) === "string" };
    },
  };
}

export const olxSites: readonly ShoppingSite[] = [
  olx({ key: "olx_pl", tld: "pl", country: "pl", currency: "PLN", language: "pl", relevance: Relevance.Row }),
  olx({ key: "olx_pt", tld: "pt", country: "pt", currency: "EUR", language: "pt", relevance: Relevance.Row }),
  olx({ key: "olx_ro", tld: "ro", country: "ro", currency: "RON", language: "ro", relevance: Relevance.Row }),
  olx({ key: "olx_bg", tld: "bg", country: "bg", currency: "EUR", language: "bg", relevance: Relevance.Page }),
  olx({ key: "olx_ua", tld: "ua", country: "ua", currency: "UAH", language: "uk", relevance: Relevance.Page }),
];
