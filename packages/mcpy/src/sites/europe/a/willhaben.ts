/**
 * willhaben (AT). Probed 2026-11-22 through tools.ly.tl: a plain fetch
 * serves the marketplace search; rows are in __NEXT_DATA__ at
 * props.pageProps.searchResult.advertSummaryList.advertSummary (30 a page),
 * each a list of name/values attributes. sort=1 (newest), 3/4 (price
 * ascending/descending), 7 (relevance), PRICE_FROM/PRICE_TO and page=N are
 * applied by the site (checked: every row inside the range). The search
 * matches any word in title or body, so rows must contain every word.
 * PUBLISHED_String is UTC.
 */

import { ListingFormat, ListingStatus, ShoppingSort } from "../../../services/shopping/schema.js";
import { looksBlocked } from "../../readers/html.js";
import { nextData, pick } from "../../readers/json.js";
import { q, str } from "../../readers/values.js";
import type { RawListing, ShoppingSite } from "../../types.js";
import { relevant, Relevance } from "./shared.js";

const PAGE_SIZE = 30;
const SORTS: Partial<Record<string, number>> = {
  [ShoppingSort.Newest]: 1,
  [ShoppingSort.PriceLow]: 3,
  [ShoppingSort.PriceHigh]: 4,
  [ShoppingSort.Relevance]: 7,
};

type Obj = Record<string, unknown>;

/** An advert's attributes as name -> first value. */
function attributes(ad: Obj): Record<string, string> {
  const list = pick(ad, ["attributes", "attribute"]);
  const out: Record<string, string> = {};
  if (!Array.isArray(list)) return out;
  for (const a of list as Obj[]) {
    const name = str(a["name"]);
    const value = Array.isArray(a["values"]) ? str(a["values"][0], 5_000) : undefined;
    if (name && value) out[name] = value;
  }
  return out;
}

function status(ad: Obj): ListingStatus | undefined {
  const s = str(pick(ad, ["advertStatus", "id"]));
  if (s === "active") return ListingStatus.Available;
  if (s === "reserved") return ListingStatus.Reserved;
  if (s === "sold") return ListingStatus.SoldOut;
  return undefined;
}

function row(ad: Obj): RawListing | undefined {
  const a = attributes(ad);
  const seo = a["SEO_URL"];
  const id = str(ad["id"]) ?? a["ADID"];
  if (!seo || !id) return undefined;
  return {
    url: `https://www.willhaben.at/iad/${seo.replace(/^\/+/, "")}`,
    id,
    title: a["HEADING"] ?? str(ad["description"]),
    description: str(a["BODY_DYN"], 1_200),
    price: a["PRICE"],
    currency: "EUR",
    format: ListingFormat.FixedPrice,
    status: status(ad),
    postedAt: a["PUBLISHED_String"],
    location: a["LOCATION"],
    country: a["COUNTRY"] === "Österreich" ? "at" : undefined,
    image: a["MMO"] ? `https://cache.willhaben.at/mmo/${a["MMO"]}` : undefined,
    details: {
      Seller: a["ISPRIVATE"] === "1" ? "private" : a["ISPRIVATE"] === "0" ? "professional" : undefined,
      PayLivery: a["p2penabled"] === "true" ? true : undefined,
      State: a["STATE"],
    },
  };
}

export const willhaben: ShoppingSite = {
  key: "willhaben",
  host: "www.willhaben.at",
  country: "at",
  currency: "EUR",
  language: "de",
  kind: "classifieds",
  listingId: (url) => /^\/iad\/.*-(\d{6,})\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const sort = SORTS[sq.sort];
    const price = `${sq.minPrice !== undefined ? `&PRICE_FROM=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&PRICE_TO=${Math.ceil(sq.maxPrice)}` : ""}`;
    return {
      url: `https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?keyword=${q(sq.query)}${sort ? `&sort=${sort}` : ""}${price}&rows=${PAGE_SIZE}&page=${sq.page}`,
      applies: { sort: sort !== undefined, minPrice: true, maxPrice: true },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const result = pick(nextData(page.content), ["props", "pageProps", "searchResult"]) as Obj | undefined;
    if (!result) return { kind: "failed", failure: "redesigned", detail: "no searchResult in __NEXT_DATA__" };
    const ads = pick(result, ["advertSummaryList", "advertSummary"]);
    const list = Array.isArray(ads) ? (ads as Obj[]) : [];
    const hits = relevant(sq.query, list, (ad) => {
      const a = attributes(ad);
      return [a["HEADING"] ?? str(ad["description"]), a["BODY_DYN"]];
    }, Relevance.Row);
    if (hits.length === 0) return { kind: "empty" };
    const rows = hits.map(row).filter((r): r is RawListing => r !== undefined);
    const total = hits.length === list.length && typeof result["rowsFound"] === "number" ? result["rowsFound"] : undefined;
    return { kind: "results", rows, total, hasMore: list.length >= PAGE_SIZE };
  },
};
