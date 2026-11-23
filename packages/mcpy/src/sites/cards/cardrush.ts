/**
 * Card Rush (カードラッシュ, Pokémon). Probed 2026-11-22: the search page
 * (/product-list?keyword=...) is server-rendered HTML; each li.list_item_cell
 * is one stock item of the shop (one card in one state, e.g. 【状態A-】) with
 * its price and stock count ("在庫数 37枚"). There is no JSON. order=asc|desc
 * sorts by price on the site; there is no newest order and no price range.
 */

import { SiteFailure } from "../../services/common.js";
import { Game, ListingFormat, ListingStatus, ShoppingSort } from "../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../readers/html.js";
import { count, q } from "../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../types.js";

const ORIGIN = "https://www.cardrush-pokemon.jp";
const PAGE_SIZE = 100;
const SORTS: Partial<Record<string, string>> = { [ShoppingSort.PriceLow]: "asc", [ShoppingSort.PriceHigh]: "desc" };

function row(cell: string): RawListing | undefined {
  const id = first(cell, /data-product-id="(\d+)"/);
  if (!id) return undefined;
  const stock = text(first(cell, /<p class="stock[^"]*">([\s\S]*?)<\/p>/));
  const soldOut = !stock || /在庫なし|売り切れ|SOLD/i.test(stock) || /soldout|sold_out/.test(cell.slice(0, 300));
  const title = text(first(cell, /<span class="goods_name">([\s\S]*?)<\/span>\s*<wbr>/)) ?? text(first(cell, /<span class="goods_name">([\s\S]*?)<\/p>/));
  return {
    url: `${ORIGIN}/product/${id}`,
    id,
    title,
    price: text(first(cell, /<span class="figure">([\s\S]*?)<\/span>/)),
    currency: "JPY",
    format: ListingFormat.FixedPrice,
    language: "ja",
    quantity: soldOut ? undefined : first(stock, /(\d+)/),
    status: soldOut ? ListingStatus.SoldOut : ListingStatus.Available,
    image: attr(first(cell, /(<img [^>]*>)/), "src"),
    country: "jp",
    details: { Set: text(first(cell, /<span class="model_number_value">([\s\S]*?)<\/span>/)), State: first(title, /【(状態[^】]*)】/) },
  };
}

export const cardrush: ShoppingSite = {
  key: "cardrush",
  host: "www.cardrush-pokemon.jp",
  country: "jp",
  currency: "JPY",
  language: "ja",
  kind: SiteKind.Shop,
  games: [Game.Pokemon],
  listingId: (url) => /^\/product\/(\d+)$/.exec(url.pathname)?.[1],
  search(sq) {
    const order = SORTS[sq.sort];
    return {
      url: `${ORIGIN}/product-list?keyword=${q(sq.query)}&num=${PAGE_SIZE}${order ? `&order=${order}` : ""}${sq.page > 1 ? `&page=${sq.page}` : ""}`,
      applies: { sort: order !== undefined || sq.sort === ShoppingSort.Relevance },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: SiteFailure.Blocked, detail: "challenge page" };
    const cells = blocks(page.content, /<li class="list_item_cell /);
    const rows = cells.map(row).filter((r): r is RawListing => r !== undefined);
    const total = first(page.content, /<p class="count_number">\s*<span class="number">([\d,]+)<\/span>/);
    if (rows.length) return { kind: "results", rows, total: count(total), hasMore: new RegExp(`[?&](?:amp;)?page=${sq.page + 1}\\b`).test(page.content) };
    if (total === "0") return { kind: "empty" };
    return { kind: "failed", failure: SiteFailure.Redesigned, detail: "no list_item_cell rows" };
  },
};
