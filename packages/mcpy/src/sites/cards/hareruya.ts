/**
 * Hareruya (Magic). Probed 2026-11-22: the search page is a shell whose
 * script calls the site's own JSON search, /en/products/search/unisearch_api,
 * which answers a plain fetch. Each doc is one stock unit (product_class: one
 * card printing in one condition and language) with its price and stock, so
 * each doc is one listing; the shop sells its own stock, no product pages.
 * fq.price=min~max and sort=price asc|desc are applied by the site (checked:
 * every row >= the floor, ascending). There is no listing date: newest is not
 * applied. A responseHeader.fallback means the site dropped query words to
 * find something: those rows do not match the query and are not results.
 */

import { SiteFailure } from "../../services/common.js";
import { CardCondition, Condition, Game, ListingFormat, ListingStatus, ShoppingSort } from "../../services/shopping/schema.js";
import { bodyJson, pick } from "../readers/json.js";
import { looksBlocked } from "../readers/html.js";
import { q, str } from "../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../types.js";

const PAGE_SIZE = 60;
const ORIGIN = "https://www.hareruyamtg.com";

/** Hareruya's grade codes (the product page labels them NM, SP, MP, HP, DMG). */
const GRADES: Readonly<Record<string, CardCondition>> = {
  "1": CardCondition.NearMint,
  "2": CardCondition.Excellent,
  "3": CardCondition.LightPlayed,
  "4": CardCondition.Played,
  "5": CardCondition.Poor,
};
const GRADE_LABELS: Readonly<Record<string, string>> = { "1": "NM", "2": "SP", "3": "MP", "4": "HP", "5": "DMG" };
const LANGUAGES: Readonly<Record<string, string>> = { "1": "ja", "2": "en" };

const SORTS: Partial<Record<string, string>> = { [ShoppingSort.PriceLow]: "price+asc", [ShoppingSort.PriceHigh]: "price+desc" };

function row(d: Record<string, unknown>): RawListing | undefined {
  const id = str(d["product_class"]);
  const product = str(d["product"]);
  if (!id || !product) return undefined;
  const card = d["foil_flg"] !== undefined;
  const stock = Number(d["stock"]);
  const grade = str(d["card_condition"]);
  return {
    url: `${ORIGIN}/en/products/detail/${product}`,
    id,
    title: str(d["product_name_en"]) ?? str(d["product_name"]),
    titleOriginal: str(d["product_name"]),
    price: str(d["price"]),
    currency: "JPY",
    format: ListingFormat.FixedPrice,
    cardCondition: card && grade ? GRADES[grade] : undefined,
    language: LANGUAGES[str(d["language"]) ?? ""],
    quantity: stock > 0 ? stock : undefined,
    status: Number.isFinite(stock) ? (stock > 0 ? ListingStatus.Available : ListingStatus.SoldOut) : undefined,
    image: str(d["image_url"], 2_000),
    country: "jp",
    details: {
      Condition: card && grade ? GRADE_LABELS[grade] : undefined,
      Foil: d["foil_flg"] === "1" ? true : undefined,
      Sale: d["sale_flg"] === "1" ? true : undefined,
      Card: str(d["card_name"]),
    },
  };
}

export const hareruya: ShoppingSite = {
  key: "hareruya",
  host: "www.hareruyamtg.com",
  country: "jp",
  currency: "JPY",
  language: "ja",
  kind: SiteKind.Shop,
  games: [Game.Magic],
  listingId: (url) => /^\/[a-z]{2}\/products\/detail\/(\d+)/.exec(url.pathname)?.[1],
  search(sq) {
    const min = sq.minPrice !== undefined ? Math.max(1, Math.floor(sq.minPrice)) : 1;
    const max = sq.maxPrice !== undefined ? String(Math.ceil(sq.maxPrice)) : "*";
    const sort = SORTS[sq.sort];
    return {
      url: `${ORIGIN}/en/products/search/unisearch_api?kw=${q(sq.query)}&fq.price=${min}~${q(max)}${sort ? `&sort=${sort}` : ""}&rows=${PAGE_SIZE}&page=${sq.page}`,
      applies: { sort: sort !== undefined || sq.sort === ShoppingSort.Relevance, minPrice: true, maxPrice: true },
    };
  },
  read(page, sq) {
    const json = bodyJson(page.content);
    if (json === undefined) {
      return looksBlocked(page.content)
        ? { kind: "failed", failure: SiteFailure.Blocked, detail: "challenge page" }
        : { kind: "failed", failure: SiteFailure.Redesigned, detail: "search API answer is not JSON" };
    }
    const docs = pick(json, ["response", "docs"]);
    if (!Array.isArray(docs)) return { kind: "failed", failure: SiteFailure.Redesigned, detail: "no response.docs" };
    if (pick(json, ["responseHeader", "fallback"]) !== undefined || docs.length === 0) return { kind: "empty" };
    const total = Number(pick(json, ["response", "numFound"]));
    const rows = (docs as Record<string, unknown>[]).map(row).filter((r): r is RawListing => r !== undefined);
    return { kind: "results", rows, total: Number.isFinite(total) ? total : undefined, hasMore: Number.isFinite(total) && sq.page * PAGE_SIZE < total };
  },
};
