/**
 * Dragon Star (ドラゴンスター, Pokémon). Probed 2026-11-22: direct fetches get
 * a 403 and the Cloudflare fetch times out; the Firecrawl fallback serves the
 * server-rendered search page (/pokemon-card/product-list?kw=...). Each
 * div.element is one stock item of the shop (a card in one state: 【プレイ用】
 * play grade, 【実画像商品・キズ有】 damaged with real photo) with its price; the
 * quantity selector lists the units in stock and SOLDOUT marks none. There is
 * no JSON. The pager and sort run in JavaScript (href="#"), so only the first
 * 40 rows are read and sort and price are left to mcpy. No match: "商品が見つかりませんでした。".
 */

import { SiteFailure } from "../../services/common.js";
import { Game, ListingFormat, ListingStatus } from "../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../readers/html.js";
import { count, q } from "../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../types.js";

const ORIGIN = "https://dorasuta.jp";
const GAME = "pokemon-card";

function row(el: string): RawListing | undefined {
  const pid = first(el, /href="[^"]*\/product\?pid=(\d+)"/);
  if (!pid) return undefined;
  const stockId = first(el, /class="popup_link"[^>]*data-value="(\d+)"/);
  const soldOut = /class="condition soldout"/.test(el);
  const description = first(el, /<div class="description">([\s\S]*?)<\/ul>/);
  const title = text(first(description, /<a [^>]*>([\s\S]*?)<\/a>/));
  const facts = [...(description ?? "").matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => text(m[1]));
  const units = first(el, /<select id="quantity_[^"]*">([\s\S]*?)<\/select>/)?.match(/<option /g)?.length;
  return {
    url: `${ORIGIN}/${GAME}/product?pid=${pid}`,
    id: stockId ?? pid,
    title,
    price: text(first(description, /<li>([^<]*円)<\/li>/)),
    currency: "JPY",
    format: ListingFormat.FixedPrice,
    language: "ja",
    quantity: soldOut ? undefined : units,
    status: soldOut ? ListingStatus.SoldOut : ListingStatus.Available,
    image: attr(first(el, /(<img [^>]*class="lazyload"[^>]*>)/), "src"),
    country: "jp",
    details: {
      Rarity: facts[0],
      Code: facts[1],
      "Play grade": title?.includes("【プレイ用】") ? true : undefined,
      Damaged: /キズ有/.test(title ?? "") ? true : undefined,
    },
  };
}

export const dorasuta: ShoppingSite = {
  key: "dorasuta",
  host: "dorasuta.jp",
  country: "jp",
  currency: "JPY",
  language: "ja",
  kind: SiteKind.Shop,
  games: [Game.Pokemon],
  listingId: (url) => (/^\/[a-z-]+\/product$/.test(url.pathname) ? (url.searchParams.get("pid") ?? undefined) : undefined),
  search(sq) {
    return { url: `${ORIGIN}/${GAME}/product-list?kw=${q(sq.query)}` };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: SiteFailure.Blocked, detail: "challenge page" };
    const rows = blocks(page.content, /<div class="element">/)
      .map(row)
      .filter((r): r is RawListing => r !== undefined);
    const total = first(page.content, /検索件数：[\s\S]{0,40}?／&nbsp;([\d,]+)件/);
    if (rows.length) return { kind: "results", rows, total: count(total) };
    if (/<p>\s*商品が見つかりませんでした。\s*<\/p>/.test(page.content)) return { kind: "empty" };
    return { kind: "failed", failure: SiteFailure.Redesigned, detail: "no product elements" };
  },
};
