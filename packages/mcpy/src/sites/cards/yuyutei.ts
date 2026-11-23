/**
 * Yuyu-tei (遊々亭, Pokémon singles). Probed 2026-11-22: a plain fetch
 * serves the search page with every matching card as server-rendered HTML
 * (div.card-product: price and the shop's own stock, "在庫 : 3 点", "◯" for
 * plenty, "×" for none). There is no JSON. Each game has its own path and no
 * cross-game search exists (/sell/all and /sell/mtg answer 404): poc (Pokémon,
 * the default), ygo (Yu-Gi-Oh! OCG) and opc (One Piece) were checked. All matches come on one page; sort and price are not on
 * the URL: left to mcpy.
 */

import { SiteFailure } from "../../services/common.js";
import { Game, ListingFormat, ListingStatus } from "../../services/shopping/schema.js";
import { attr, first, looksBlocked, text } from "../readers/html.js";
import { q } from "../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../types.js";

const GAMES: Partial<Record<Game, string>> = { [Game.Pokemon]: "poc", [Game.YuGiOh]: "ygo", [Game.OnePiece]: "opc" };
const ORIGIN = "https://yuyu-tei.jp";

function row(card: string, rarity: string | undefined): RawListing | undefined {
  const href = attr(first(card, /(<a\s[^>]*href="[^"]*\/sell\/[a-z]+\/card\/[^"]+"[^>]*>)/), "href");
  if (!href) return undefined;
  const path = new URL(href, ORIGIN).pathname;
  const ids = /\/card\/([^/]+)\/([^/]+)$/.exec(path);
  if (!ids) return undefined;
  const damaged = attr(first(card, /(<input\s[^>]*class="cart_kizu"[^>]*>)/), "value") === "1";
  const stock = text(first(card, /cart_sell_zaiko"[^>]*>([\s\S]*?)<\/label>/));
  const units = first(stock, /(\d+)\s*点/);
  const soldOut = /×/.test(stock ?? "") || card.slice(0, 120).includes("sold-out");
  const number = text(first(card, /<span\s+class="d-block border[^"]*">([\s\S]*?)<\/span>/));
  return {
    url: `${ORIGIN}${path}`,
    id: `${ids[1]}-${ids[2]}${damaged ? "-kizu" : ""}`,
    title: text(first(card, /<h4[^>]*>([\s\S]*?)<\/h4>/)),
    price: text(first(card, /<strong\s+class="d-block text-end[^"]*">([\s\S]*?)<\/strong>/)),
    currency: "JPY",
    format: ListingFormat.FixedPrice,
    language: "ja",
    quantity: units,
    status: soldOut ? ListingStatus.SoldOut : ListingStatus.Available,
    image: attr(first(card, /(<img\s[^>]*class="card img-fluid"[^>]*>)/), "src"),
    country: "jp",
    details: { Rarity: rarity, Number: number, Damaged: damaged ? true : undefined, Stock: stock },
  };
}

export const yuyutei: ShoppingSite = {
  key: "yuyutei",
  host: "yuyu-tei.jp",
  country: "jp",
  currency: "JPY",
  language: "ja",
  kind: SiteKind.Shop,
  games: [Game.Pokemon, Game.YuGiOh, Game.OnePiece],
  listingId: (url) => /^\/sell\/[a-z]+\/card\/([^/]+)\/([^/]+)$/.exec(url.pathname)?.slice(1).join("-"),
  search(sq) {
    return { url: `${ORIGIN}/sell/${GAMES[sq.game ?? Game.Pokemon] ?? GAMES[Game.Pokemon]}/s/search?search_word=${q(sq.query)}` };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: SiteFailure.Blocked, detail: "challenge page" };
    const rows: RawListing[] = [];
    // Cards are grouped under one heading per rarity (<h3><span>MUR</span> Card List</h3>); tags break lines between name and attributes.
    const headings = [...page.content.matchAll(/<div\s+class="py-4\s+cards-list"[^>]*>\s*<h3[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/g)].map((m) => ({ at: m.index, rarity: text(m[1]) }));
    const starts = [...page.content.matchAll(/<div\s+class="card-product/g)].map((m) => m.index);
    starts.forEach((at, i) => {
      const rarity = headings.filter((h) => h.at < at).pop()?.rarity;
      const r = row(page.content.slice(at, starts[i + 1] ?? at + 8_000), rarity);
      if (r) rows.push(r);
    });
    if (rows.length) return { kind: "results", rows, total: rows.length };
    if (/検索条件に該当する商品は見つかりませんでした/.test(page.content)) return { kind: "empty" };
    return { kind: "failed", failure: SiteFailure.Redesigned, detail: "no card-product rows" };
  },
};
