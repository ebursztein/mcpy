/**
 * Daangn / Karrot (www.daangn.com). Probed 2026-11-23 through tools.ly.tl: a
 * plain fetch of /kr/search/buy-sell/?q= serves a Remix page whose
 * window.__remixContext holds every row in
 * state.loaderData["routes/_buy-sell-shell"].buySellArticles (about 280 at
 * once, no paging). The same rows are in a JSON-LD ItemList, without dates or
 * regions, so the Remix state is read.
 *
 * price=<min>__<max> and only_on_sale=true are applied by the site (checked:
 * currentFilters echoes them, every row >= the floor). The search page has no
 * sort control (sort= is ignored), so only relevance is "applied". Results are
 * those near the region Daangn picks for the fetching IP (currentFilters
 * regionId). The search is semantic: a query that matches nothing returns a
 * few loosely related rows, so a page where no row states a query word is the
 * empty page. productAds are external shopping ads and are not read.
 */

import { ListingFormat, ListingStatus, ShoppingSort } from "../../services/shopping/schema.js";
import { looksBlocked } from "../readers/html.js";
import { assigned, pick } from "../readers/json.js";
import { q, str, timestamp } from "../readers/values.js";
import type { RawListing, ShoppingSite } from "../types.js";
import { koreanWanted, noLiteralMatch } from "./common.js";

type Obj = Record<string, unknown>;

function row(article: Obj): RawListing | undefined {
  const href = str(article["href"], 2_000);
  if (!href) return undefined;
  const title = str(article["title"]);
  return {
    url: href,
    title,
    description: str(article["content"], 1_200),
    price: str(article["price"]),
    currency: "KRW",
    format: koreanWanted(title) ? ListingFormat.Wanted : ListingFormat.FixedPrice,
    // Only Ongoing was observed (only_on_sale=true); other states stay in details.
    status: article["status"] === "Ongoing" ? ListingStatus.Available : undefined,
    postedAt: timestamp(article["createdAt"]),
    location: str(pick(article, ["region", "name"])),
    country: "kr",
    image: str(article["thumbnail"], 2_000),
    details: {
      Status: article["status"] !== "Ongoing" ? str(article["status"]) : undefined,
      Bumped: str(article["boostedAt"]),
      Category: str(pick(article, ["category", "name"])),
      "Instant buy": article["isInstantBuyAvailable"] === true ? true : undefined,
    },
  };
}

export const daangn: ShoppingSite = {
  key: "daangn",
  host: "www.daangn.com",
  country: "kr",
  currency: "KRW",
  language: "ko",
  kind: "classifieds",
  // /kr/buy-sell/<title slug>-<id>/
  listingId: (url) => /^\/kr\/buy-sell\/[^/]*-([a-z0-9]{8,16})\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const price = sq.minPrice !== undefined || sq.maxPrice !== undefined ? `&price=${sq.minPrice !== undefined ? Math.ceil(sq.minPrice) : 0}__${sq.maxPrice !== undefined ? Math.floor(sq.maxPrice) : ""}` : "";
    return {
      url: `https://www.daangn.com/kr/search/buy-sell/?q=${q(sq.query)}&only_on_sale=true${price}`,
      applies: { sort: sq.sort === ShoppingSort.Relevance, minPrice: true, maxPrice: true },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const shell = pick(assigned(page.content, "__remixContext"), ["state", "loaderData", "routes/_buy-sell-shell"]) as Obj | undefined;
    if (!shell || !Array.isArray(shell["buySellArticles"])) return { kind: "failed", failure: "redesigned", detail: "no buySellArticles in __remixContext" };
    // Every row comes on the first page; there is no second one.
    if (sq.page > 1) return { kind: "empty" };
    const rows = (shell["buySellArticles"] as Obj[]).map(row).filter((r): r is RawListing => r !== undefined);
    if (!rows.length || noLiteralMatch(sq.query, rows.flatMap((r) => [r.title ?? undefined, r.description ?? undefined]))) return { kind: "empty" };
    return { kind: "results", rows, hasMore: false };
  },
};
