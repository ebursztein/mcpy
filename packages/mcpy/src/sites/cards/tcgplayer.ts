/**
 * TCGplayer (all games). Probed 2026-11-22: the search page and the product
 * page are app shells; both call TCGplayer's own JSON API on
 * mp-search-api.tcgplayer.com with POST, which answers a plain fetch:
 *
 *   POST /v1/search/request?q=...   -> results[0].results: products (best match first)
 *   POST /v1/product/{id}/listings  -> results[0].results: every seller's offer
 *
 * Search rows are products, so the search returns product links and each
 * offer on a product becomes a listing (id = listingId). The API cannot sort
 * products by listing age and its price range filters products, not offers,
 * so sort and price are left to mcpy. A game is a productLineName term filter
 * (its urlValue: magic, pokemon + pokemon-japan, yugioh, one-piece-card-game,
 * lorcana-tcg; checked: "black lotus" with magic returns Magic products only).
 */

import { HttpMethod } from "../../enums.js";
import { SiteFailure } from "../../services/common.js";
import { Condition, Game, ListingFormat } from "../../services/shopping/schema.js";
import { bodyJson, pick } from "../readers/json.js";
import { looksBlocked } from "../readers/html.js";
import { q, str } from "../readers/values.js";
import { SiteKind, type ProductLink, type RawListing, type ReadOutcome, type ShoppingSite, type SitePage } from "../types.js";
import { languageCode, usGrade } from "./grades.js";

const API = "https://mp-search-api.tcgplayer.com/v1";
const PAGE_SIZE = 24;
const OFFERS = 50;
const HEADERS = { "Content-Type": "application/json", Origin: "https://www.tcgplayer.com", Referer: "https://www.tcgplayer.com/" };
const LIVE = { term: { sellerStatus: "Live", channelId: 0 }, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } };

export const productUrl = (id: string): string => `https://www.tcgplayer.com/product/${id}`;

type Obj = Record<string, unknown>;

/** TCGplayer's product lines per game (Japanese Pokémon is its own line). */
const PRODUCT_LINES: Readonly<Record<Game, readonly string[]>> = {
  [Game.Pokemon]: ["pokemon", "pokemon-japan"],
  [Game.Magic]: ["magic"],
  [Game.YuGiOh]: ["yugioh"],
  [Game.OnePiece]: ["one-piece-card-game"],
  [Game.Lorcana]: ["lorcana-tcg"],
};

/** results[0] of an API answer, or a failure when the body is not the API's JSON. */
function firstResult(page: SitePage): { result: Obj } | { failed: ReadOutcome } {
  const json = bodyJson(page.content);
  if (json === undefined) {
    const blocked = looksBlocked(page.content);
    return { failed: { kind: "failed", failure: blocked ? SiteFailure.Blocked : SiteFailure.Redesigned, detail: blocked ? "challenge page" : "API answer is not JSON" } };
  }
  const result = pick(json, ["results", 0]);
  if (!result || typeof result !== "object") return { failed: { kind: "failed", failure: SiteFailure.Redesigned, detail: "no results[0] in the API answer" } };
  return { result: result as Obj };
}

const idOf = (v: unknown): string | undefined => (typeof v === "number" && Number.isFinite(v) ? String(Math.trunc(v)) : str(v));

function offer(o: Obj, link: ProductLink): RawListing | undefined {
  const id = idOf(o["listingId"]);
  if (!id) return undefined;
  const grade = str(o["condition"]);
  const sealed = grade === "Unopened";
  const shipping = typeof o["shippingPrice"] === "number" && o["shippingPrice"] > 0 ? o["shippingPrice"] : undefined;
  const custom = pick(o, ["customData"]) as Obj | undefined;
  return {
    url: productUrl(link.id),
    id,
    title: str(custom?.["title"]) ?? link.title,
    description: str(custom?.["description"]),
    price: o["price"] as number,
    currency: "USD",
    format: ListingFormat.FixedPrice,
    shipping,
    // Sealed product is new by definition; a single's state is its grade, not new/used.
    condition: sealed ? Condition.New : undefined,
    cardCondition: sealed ? undefined : usGrade(grade),
    language: languageCode(str(o["language"])),
    quantity: o["quantity"] as number,
    postedAt: str(o["listedDate"]),
    seller: str(o["sellerName"]),
    sellerFeedbackPercent: o["sellerRating"] as number,
    country: str(pick(o, ["sellerLocation", "country"])),
    details: {
      Condition: grade,
      Printing: str(o["printing"]),
      "Seller sales": str(o["sellerSales"]),
      "Gold seller": o["goldSeller"] === true ? true : undefined,
      Direct: o["directListing"] === true || o["directProduct"] === true ? true : undefined,
    },
  };
}

export const tcgplayer: ShoppingSite = {
  key: "tcgplayer",
  host: "www.tcgplayer.com",
  country: "us",
  currency: "USD",
  language: "en",
  kind: SiteKind.Marketplace,
  games: [Game.Pokemon, Game.Magic, Game.YuGiOh, Game.OnePiece, Game.Lorcana],
  listingId: (url) => /^\/product\/(\d+)/.exec(url.pathname)?.[1],
  search(sq) {
    const body = {
      algorithm: "sales_dismax",
      from: (sq.page - 1) * PAGE_SIZE,
      size: PAGE_SIZE,
      filters: { term: sq.game ? { productLineName: PRODUCT_LINES[sq.game] } : {}, range: {}, match: {} },
      listingSearch: { context: { cart: {} }, filters: LIVE },
      context: { cart: {}, shippingCountry: "US" },
      settings: { useFuzzySearch: true, didYouMean: {} },
      sort: {},
    };
    return { url: `${API}/search/request?q=${q(sq.query)}&isList=false`, method: HttpMethod.Post, body: JSON.stringify(body), headers: HEADERS };
  },
  read(page, sq) {
    const got = firstResult(page);
    if ("failed" in got) return got.failed;
    const result = got.result;
    const items = Array.isArray(result["results"]) ? (result["results"] as Obj[]) : [];
    const total = typeof result["totalResults"] === "number" ? result["totalResults"] : undefined;
    const products: ProductLink[] = [];
    for (const p of items) {
      const id = idOf(p["productId"]);
      if (!id || !(typeof p["totalListings"] === "number" && p["totalListings"] > 0)) continue;
      const set = str(p["setName"]);
      const name = str(p["productName"]);
      products.push({ id, url: productUrl(id), title: name && set ? `${name} (${set})` : name });
    }
    if (!products.length) return { kind: "empty" };
    return { kind: "results", rows: [], products, total, hasMore: total !== undefined && sq.page * PAGE_SIZE < total };
  },
  product: {
    request: (link) => ({
      url: `${API}/product/${link.id}/listings`,
      method: HttpMethod.Post,
      body: JSON.stringify({ filters: LIVE, from: 0, size: OFFERS, sort: { field: "price+shipping", order: "asc" }, context: { shippingCountry: "US", cart: {} }, aggregations: ["listingType"] }),
      headers: HEADERS,
    }),
    read(page, link) {
      const got = firstResult(page);
      if ("failed" in got) return got.failed;
      const items = Array.isArray(got.result["results"]) ? (got.result["results"] as Obj[]) : [];
      const rows = items.map((o) => offer(o, link)).filter((r): r is RawListing => r !== undefined);
      return rows.length ? { kind: "results", rows } : { kind: "empty" };
    },
  },
};
