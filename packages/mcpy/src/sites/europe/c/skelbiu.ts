/**
 * Skelbiu.lt (Lithuania). Probed 2026-11-22: a plain fetch answers HTTP 403
 * (the site's own block page, "Skelbiu.lt", ~21 KB) from Cloudflare and from
 * a residential IP, for desktop and mobile agents and for the /skelbimai/
 * path form; Firecrawl serves the real page. Rows are server-rendered cards
 * (a.standard-list-item[data-item-id], 24 a page) with title, price, "city,
 * age" and "Būklė" (condition). orderBy=1 is newest first; cost_min/cost_max
 * are applied by the site (checked: every row of a 50-200 search in range).
 * Pages are /skelbimai/N?keywords=. No results: "Pagal Jūsų paiešką nieko
 * neradome" with no cards.
 */

import { Condition, ShoppingSort } from "../../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../../readers/html.js";
import { plus, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";

const PAGE_SIZE = 24;
const ORDERS: Partial<Record<string, string>> = { [ShoppingSort.Newest]: "1", [ShoppingSort.Relevance]: "2" };
const CONDITIONS: Readonly<Record<string, Condition>> = { nauja: Condition.New, naudota: Condition.Used };

function row(card: string): RawListing | undefined {
  const open = card.slice(0, card.indexOf(">") + 1);
  const url = attr(open, "href");
  const id = attr(open, "data-item-id");
  if (!url || !id) return undefined;
  const line = text(first(card, /<div class="second-dataline">([\s\S]*?)<\/div>/i) ?? first(card, /<div class="second-line">([\s\S]*?)<\/div>/i));
  const cut = line ? line.lastIndexOf(", ") : -1;
  const params = [...card.matchAll(/<div class="param">([\s\S]*?)<\/div>/gi)].map((m) => text(m[1]) ?? "");
  const condition = params.find((p) => /^Būklė:/i.test(p))?.replace(/^Būklė:\s*/i, "");
  return {
    url,
    id,
    title: text(first(card, /<div class="title">([\s\S]*?)<\/div>/i)),
    description: text(first(card, /<div class="first-dataline">([\s\S]*?)<\/div>/i)),
    price: text(first(card, /<div class="price">([\s\S]*?)<\/div>/i)),
    currency: "EUR",
    condition: condition ? CONDITIONS[condition.toLowerCase()] : undefined,
    location: cut > 0 ? line!.slice(0, cut) : undefined,
    postedText: cut > 0 ? line!.slice(cut + 2) : line,
    country: "lt",
    image: attr(card.match(/<img[^>]*>/i)?.[0], "src"),
    details: Object.fromEntries(params.filter((p) => p.includes(":")).slice(0, 5).map((p) => [p.slice(0, p.indexOf(":")).trim(), p.slice(p.indexOf(":") + 1).trim()])),
  };
}

export const skelbiu: ShoppingSite = {
  key: "skelbiu",
  host: "www.skelbiu.lt",
  country: "lt",
  currency: "EUR",
  language: "lt",
  kind: SiteKind.Classifieds,
  listingId: (url) => /^\/skelbimai\/[^/]*-(\d+)\.html$/.exec(url.pathname)?.[1],
  search(sq) {
    const order = ORDERS[sq.sort];
    const price = `${sq.minPrice !== undefined ? `&cost_min=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&cost_max=${Math.ceil(sq.maxPrice)}` : ""}`;
    return {
      url: `https://www.skelbiu.lt/skelbimai/${sq.page > 1 ? sq.page : ""}?keywords=${plus(sq.query)}${order ? `&orderBy=${order}` : ""}${price}`,
      applies: { sort: order !== undefined, minPrice: true, maxPrice: true },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    if (!/standard-list-container|id="searchForm"|name="keywords"/.test(page.content)) return { kind: "failed", failure: "blocked", detail: "not a Skelbiu search page (block page)" };
    const cards = blocks(page.content, /<a [^>]*class="js-cfuser-link standard-list-item/);
    if (cards.length === 0) {
      if (/nieko neradome/.test(page.content)) return { kind: "empty" };
      return { kind: "failed", failure: "redesigned", detail: "no standard-list-item cards and no empty-result notice" };
    }
    const rows = cards.map(row).filter((r): r is RawListing => r !== undefined);
    const next = new RegExp(`href="[^"]*/skelbimai/${sq.page + 1}\\?`).test(page.content);
    return { kind: "results", rows, hasMore: next || cards.length === PAGE_SIZE };
  },
};
