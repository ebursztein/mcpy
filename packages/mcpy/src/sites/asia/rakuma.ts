/**
 * Rakuten Rakuma (fril.jp). Probed 2026-11-23 through tools.ly.tl: a plain
 * fetch serves server-rendered cards (<div class="item">, 40 a page) and no
 * embedded JSON or JSON-LD with the rows, so the cards are read. Listing
 * URLs live on item.fril.jp.
 *
 * sort/order, min/max, transaction=selling and page are applied by the site
 * (checked: every row 5000-20000, search_order 新着順). Rakuma's search is
 * fuzzy: a query that matches nothing still returns unrelated rows, so a page
 * where no title states a query word is the empty page (noLiteralMatch).
 */

import { ListingFormat, ListingStatus, ShoppingSort } from "../../services/shopping/schema.js";
import { attr, blocks, decodeEntities, first, looksBlocked, text } from "../readers/html.js";
import { count, q } from "../readers/values.js";
import type { RawListing, ShoppingSite } from "../types.js";
import { noLiteralMatch } from "./common.js";

const PAGE_SIZE = 40;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "&sort=created_at&order=desc",
  [ShoppingSort.PriceLow]: "&sort=sell_price&order=asc",
  [ShoppingSort.PriceHigh]: "&sort=sell_price&order=desc",
  [ShoppingSort.Relevance]: "&sort=relevance&order=desc",
};

function row(card: string): RawListing | undefined {
  const link = /<a[^>]*href="(https:\/\/item\.fril\.jp\/[0-9a-f]+)"[^>]*class="link_search_title"[^>]*>/.exec(card);
  if (!link) return undefined;
  const priceTag = /class="item-box__item-price"[\s\S]*?<span data-content="([A-Z]{3})"[^>]*>[^<]*<\/span>\s*<span data-content="(\d+)"/.exec(card);
  // data-rat-itemid="<seller id>/<item number>"
  const ratId = attr(link[0], "data-rat-itemid");
  return {
    url: link[1],
    title: text(first(card, /class="link_search_title"[^>]*>\s*<span>([\s\S]*?)<\/span>/)),
    price: priceTag?.[2],
    currency: priceTag?.[1],
    format: ListingFormat.FixedPrice,
    status: card.includes("item-box__soldout_ribbon") ? ListingStatus.SoldOut : ListingStatus.Available,
    image: attr(/<img[^>]*data-original="[^"]*"[^>]*>/.exec(card)?.[0], "data-original"),
    country: "jp",
    details: {
      Brand: text(first(card, /class="item-box__item-sub-name"[^>]*>([\s\S]*?)<\/div>/)),
      "Seller type": attr(link[0], "data-rat-sgenre"),
      "Item number": ratId?.split("/")[1],
      "Price reduced": card.includes("item-box__reduction-icon") ? true : undefined,
    },
  };
}

export const rakuma: ShoppingSite = {
  key: "rakuma",
  // n-gram search: "リザードン 初版" returned One Piece cards (2026-11-23).
  matchesLoosely: true,
  host: "fril.jp",
  listingHosts: ["item.fril.jp"],
  country: "jp",
  currency: "JPY",
  language: "ja",
  kind: "marketplace",
  listingId: (url) => (url.hostname === "item.fril.jp" ? /^\/([0-9a-f]{20,40})\/?$/.exec(url.pathname)?.[1] : undefined),
  search(sq) {
    const price = `${sq.minPrice !== undefined ? `&min=${Math.ceil(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&max=${Math.floor(sq.maxPrice)}` : ""}`;
    const sort = SORTS[sq.sort];
    return {
      url: `https://fril.jp/s?query=${q(sq.query)}${sort ?? ""}${price}&transaction=selling${sq.page > 1 ? `&page=${sq.page}` : ""}`,
      applies: { sort: sort !== undefined, minPrice: true, maxPrice: true },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const html = page.content;
    if (!html.includes('class="item-list') && !html.includes("view_grid")) return { kind: "failed", failure: "redesigned", detail: "no search result list" };
    const cards = blocks(html, /<div class="item">/);
    const rows = cards.map(row).filter((r): r is RawListing => r !== undefined);
    if (!rows.length || noLiteralMatch(sq.query, rows.map((r) => r.title ?? undefined))) return { kind: "empty" };
    const total = count(decodeEntities(first(html, /data-rat-cp-totalresults="(\d+)"/) ?? ""));
    return { kind: "results", rows, total, hasMore: cards.length === PAGE_SIZE };
  },
};
