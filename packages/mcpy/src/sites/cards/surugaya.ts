/**
 * Suruga-ya (駿河屋, general second-hand shop). Probed 2026-11-22: direct
 * fetches are refused (403) and Cloudflare is escalated to the paid
 * fallbacks, which serve the server-rendered search page; there is no JSON
 * and the only JSON-LD is a breadcrumb. Each div.item is one product with the
 * shop's own price per state (中古 used, 新品 new; a time sale shows the sale
 * price) or 品切れ (sold out). Each stated state is one listing (id = product
 * id + state). The "マケプレ ￥460" line is the lowest of other sellers'
 * offers, a product summary: not a listing. A search without matches is a
 * 404 result page ("該当件数：0件"). Sort and price are left to mcpy.
 */

import { SiteFailure } from "../../services/common.js";
import { Condition, ListingFormat, ListingStatus } from "../../services/shopping/schema.js";
import { blocks, first, looksBlocked, text } from "../readers/html.js";
import { q } from "../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../types.js";

const ORIGIN = "https://www.suruga-ya.jp";
const STATES = { 中古: Condition.Used, 新品: Condition.New } as const;

function rows(item: string): RawListing[] {
  const id = first(item, /href="[^"]*\/product\/(?:detail|other)\/(\d+)/);
  const title = text(first(item, /<h3 class="product-name">([\s\S]*?)<\/h3>/));
  if (!id || !title) return [];
  const own = first(item, /<div class="item_price[^"]*">([\s\S]*?)(?:<div class="mgnT20 highlight-box"|$)/) ?? "";
  const priced = own.replace(/<div class="panel_buy[\s\S]*?<\/div>/g, "");
  const base: RawListing = {
    url: `${ORIGIN}/product/detail/${id}`,
    title,
    currency: "JPY",
    format: ListingFormat.FixedPrice,
    image: `${ORIGIN}/database/photo.php?shinaban=${id}&size=m`,
    country: "jp",
    details: {
      Category: text(first(item, /<p class="condition background-kishu"[^>]*>([\s\S]*?)<\/p>/)),
      Released: first(item, /\[発売日：([^\]]+)\]/),
      Brand: text(first(item, /<p class="brand">([\s\S]*?)<\/p>/))?.replace(/^\[|\]$/g, ""),
    },
  };
  const out: RawListing[] = [];
  // Each own price is a red <strong>￥N</strong>; its state is the last 中古/新品 label before it.
  for (const m of priced.matchAll(/<strong>\s*[￥¥]([\d,]+)\s*<\/strong>/g)) {
    const before = priced.slice(0, m.index);
    const after = priced.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (/～/.test(after) || /～\s*$/.test(before.slice(-40))) continue; // a price range over other states
    const state = (before.match(/(中古|新品)/g) ?? []).pop() as keyof typeof STATES | undefined;
    if (!state) continue;
    out.push({ ...base, id: `${id}-${state === "中古" ? "used" : "new"}`, price: m[1], condition: STATES[state], status: ListingStatus.Available, details: { ...base.details, "Time sale": /タイムセール/.test(before) ? true : undefined } });
  }
  if (!out.length && /品切れ/.test(priced)) out.push({ ...base, id, status: ListingStatus.SoldOut });
  return out;
}

export const surugaya: ShoppingSite = {
  key: "surugaya",
  host: "www.suruga-ya.jp",
  country: "jp",
  currency: "JPY",
  language: "ja",
  kind: SiteKind.Shop,
  listingId: (url) => /^\/product\/(?:detail|other)\/(\d+)$/.exec(url.pathname)?.[1],
  emptyStatuses: [404],
  search(sq) {
    return { url: `${ORIGIN}/search?category=&search_word=${q(sq.query)}${sq.page > 1 ? `&page=${sq.page}` : ""}` };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: SiteFailure.Blocked, detail: "challenge page" };
    const items = blocks(page.content, /<div class="item">/);
    const listings = items.flatMap(rows);
    if (listings.length) return { kind: "results", rows: listings, hasMore: page.content.includes(`page=${sq.page + 1}"`) };
    if (/該当件数：0件/.test(page.content)) return { kind: "empty" };
    return { kind: "failed", failure: SiteFailure.Redesigned, detail: "no item rows" };
  },
};
