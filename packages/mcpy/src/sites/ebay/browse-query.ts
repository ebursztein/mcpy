/**
 * A generic shopping query as eBay Browse search parameters
 * (item_summary/search). Each filter is applied by eBay when it maps exactly,
 * and claimed in `applies`; anything else is left to mcpy (rows) or reported
 * ignored. Checked live 2026-11-23 through PicClick:
 *
 * - buyingOptions, conditionIds and sellers take several values {a|b}.
 * - itemLocationCountry takes one country: several are left to mcpy.
 * - aspect_filter needs a category (categoryId:<id>,Name:{v1|v2}); `game`
 *   sets eBay's trading-card category and its Game aspect, and `language`
 *   then maps to the Language aspect (PSA 10 charizard: 19 of 20 titles say 10).
 * - fieldgroups ASPECT_REFINEMENTS + CATEGORY_REFINEMENTS add facets (about
 *   1.4 MB for a popular query), so they are asked for only on request.
 */

import type { Country, Currency, Language } from "../../services/common.js";
import { Condition, Game, ListingFormat, ShoppingSort } from "../../services/shopping/schema.js";
import type { Applied, SiteQuery } from "../types.js";

export const PAGE_SIZE = 60;

const SORTS: Partial<Record<ShoppingSort, string>> = {
  [ShoppingSort.Newest]: "newlyListed",
  [ShoppingSort.PriceLow]: "price",
  [ShoppingSort.PriceHigh]: "-price",
  [ShoppingSort.EndingSoon]: "endingSoonest",
  // Relevance: eBay's best match is the default order, no sort parameter.
};

const FORMATS: Partial<Record<ListingFormat, string>> = {
  [ListingFormat.FixedPrice]: "FIXED_PRICE",
  [ListingFormat.Auction]: "AUCTION",
  [ListingFormat.BestOffer]: "BEST_OFFER",
};

/** eBay condition ids per condition. 2750 and 4000 (graded / ungraded cards, like new / very good) are used goods. */
const CONDITIONS: Record<Condition, readonly number[]> = {
  [Condition.New]: [1000],
  [Condition.OpenBox]: [1500],
  [Condition.Refurbished]: [2000, 2010, 2020, 2030, 2500],
  [Condition.Used]: [2750, 3000, 4000, 5000, 6000],
  [Condition.ForParts]: [7000],
};

/** eBay's "CCG Individual Cards" and its Game aspect values. */
const CARD_CATEGORY = "183454";
const GAMES: Record<Game, string> = {
  [Game.Pokemon]: "Pokémon TCG",
  [Game.Magic]: "Magic: The Gathering",
  [Game.YuGiOh]: "Yu-Gi-Oh! TCG",
  [Game.OnePiece]: "One Piece CCG",
  [Game.Lorcana]: "Disney Lorcana TCG",
};

/** The Language aspect's values (live: English, Japanese, Chinese, Korean, French...). */
const LANGUAGES: Partial<Record<Language, string>> = {
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
  fr: "French",
  de: "German",
  it: "Italian",
  es: "Spanish",
  pt: "Portuguese",
  nl: "Dutch",
  ru: "Russian",
  pl: "Polish",
};

/** Characters with a meaning in eBay's filter syntax: a value holding one is not sent. */
const SYNTAX = /[{}|,:]/;

export interface BrowseDefaults {
  /** The store's own seller country, used when the query names none. */
  country?: Country;
  /** Price bounds are in this currency. */
  currency: Currency;
}

/** The search parameters and what they apply. */
export function browseParams(sq: SiteQuery, defaults: BrowseDefaults): { params: URLSearchParams; applies: Applied } {
  const applies: Applied = { sort: true, minPrice: true, maxPrice: true };
  const filters: string[] = [];

  const countries = sq.sellerCountry?.length ? sq.sellerCountry : defaults.country ? [defaults.country] : [];
  if (countries.length === 1) {
    filters.push(`itemLocationCountry:${countries[0]!.toUpperCase()}`);
    applies.sellerCountry = true;
  }
  if (sq.minPrice !== undefined || sq.maxPrice !== undefined) filters.push(`price:[${sq.minPrice ?? ""}..${sq.maxPrice ?? ""}]`, `priceCurrency:${defaults.currency}`);
  if (sq.format?.length && sq.format.every((f) => FORMATS[f])) {
    filters.push(`buyingOptions:{${sq.format.map((f) => FORMATS[f]).join("|")}}`);
    applies.format = true;
  }
  if (sq.condition?.length) {
    filters.push(`conditionIds:{${sq.condition.flatMap((c) => CONDITIONS[c]).join("|")}}`);
    applies.condition = true;
  }
  if (sq.seller && !SYNTAX.test(sq.seller)) {
    filters.push(`sellers:{${sq.seller}}`);
    applies.seller = true;
  }

  const category = sq.category ?? (sq.game ? CARD_CATEGORY : undefined);
  const aspects: string[] = [];
  if (sq.game && category === CARD_CATEGORY) {
    aspects.push(`Game:{${GAMES[sq.game]}}`);
    applies.game = true;
  }
  if (sq.language?.length && category === CARD_CATEGORY && sq.language.every((l) => LANGUAGES[l])) {
    aspects.push(`Language:{${sq.language.map((l) => LANGUAGES[l]).join("|")}}`);
    applies.language = true;
  }
  const attributes = Object.entries(sq.attributes ?? {});
  if (category && attributes.length && attributes.every(([name, values]) => !SYNTAX.test(name) && values.every((v) => !SYNTAX.test(v)))) {
    for (const [name, values] of attributes) aspects.push(`${name}:{${values.join("|")}}`);
    applies.attributes = true;
  }

  const params = new URLSearchParams({ q: sq.query, limit: String(PAGE_SIZE), offset: String((sq.page - 1) * PAGE_SIZE) });
  const sort = SORTS[sq.sort];
  if (sort) params.set("sort", sort);
  if (filters.length) params.set("filter", filters.join(","));
  if (category && !SYNTAX.test(category)) {
    params.set("category_ids", category);
    applies.category = sq.category !== undefined;
    if (aspects.length) params.set("aspect_filter", [`categoryId:${category}`, ...aspects].join(","));
  } else {
    applies.game = applies.language = applies.attributes = false;
  }
  if (sq.facets) params.set("fieldgroups", "MATCHING_ITEMS,ASPECT_REFINEMENTS,CATEGORY_REFINEMENTS");
  return { params, applies };
}
