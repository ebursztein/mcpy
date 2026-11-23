/**
 * todocoleccion.net (Spain). Probed 2026-11-22: a plain fetch gets the
 * Cloudflare challenge (HTTP 403) from Cloudflare and from a residential IP;
 * Firecrawl serves the real page. Rows are server-rendered cards
 * (div.card-lote, 30 a page) inside #buscador-lote-items-container, followed
 * by a carousel of unrelated lots and, for a search without results, a
 * "Sin resultados para ..." page whose container holds suggestions
 * ("Te mostramos opciones similares"): neither is a result. O=r is newest
 * first, O=menos / O=mas the price orders. preciodesde/preciohasta narrow
 * the search, but auctions whose current bid is under the floor still come
 * back (checked live: 26 and 35 EUR bids for preciodesde=50), so the floor is
 * not reported as applied. P = page.
 */

import { ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../../readers/html.js";
import { count, plus, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";

const PAGE_SIZE = 30;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "r",
  [ShoppingSort.PriceLow]: "menos",
  [ShoppingSort.PriceHigh]: "mas",
  [ShoppingSort.Relevance]: "rl",
};

/** The real result grid: from its container to the pagination (or the end of the grid). */
function resultGrid(html: string): string | undefined {
  const start = html.search(/<div id="buscador-lote-items-container" class="ga-track-buscador"/);
  if (start < 0) return undefined;
  const rest = html.slice(start);
  const end = rest.search(/<div class="pagination-container"|<div id="sugerencias_busqueda"|<div class="banner-container/);
  return end < 0 ? rest : rest.slice(0, end);
}

function row(card: string): RawListing | undefined {
  const id = first(card, /data-testid="(\d+)"/);
  const link = card.match(/<a id="lot-title-\d+"[^>]*>/i)?.[0];
  const url = attr(link, "href");
  if (!id || !url) return undefined;
  const bids = first(card, /(\d+)\s+pujas?\b/i);
  const auction = /badge-sell|badge-extra|auctionTimeRemaining/.test(card) && bids !== undefined;
  const timeLeft = auction ? text(first(card, /x-data="auctionTimeRemaining\([^"]*"\s*>([\s\S]*?)<\/span>/i) ?? first(card, /badge-extra">([\s\S]*?)<a /i)) : undefined;
  const discount = text(first(card, /badge-success">([\s\S]*?)<\//i));
  return {
    url,
    id,
    // The link text; its title attribute is entity-encoded twice ("&amp;amp;").
    title: text(first(card, /<a id="lot-title-\d+"[^>]*>([\s\S]*?)<\/a>/i)) ?? str(attr(link, "title")),
    price: text(first(card, /class="card-price[^"]*"[^>]*>([\s\S]*?)<\/span>/i)),
    currency: "EUR",
    format: auction ? ListingFormat.Auction : /Admite ofertas/i.test(card) ? ListingFormat.BestOffer : ListingFormat.FixedPrice,
    bids: auction ? count(bids) : undefined,
    image: attr(card.match(/<img[^>]*card-lote-main-image[^>]*>/i)?.[0], "src"),
    country: "es",
    details: {
      Section: text(first(card, /<a class="fs-14 text-gray-500[^"]*"[^>]*>([\s\S]*?)<\/a>/i)),
      "Time left": timeLeft,
      Discount: discount,
    },
  };
}

export const todocoleccion: ShoppingSite = {
  key: "todocoleccion",
  host: "www.todocoleccion.net",
  country: "es",
  currency: "EUR",
  language: "es",
  kind: SiteKind.Marketplace,
  listingId: (url) => /~x(\d+)$/.exec(url.pathname)?.[1],
  search(sq) {
    const sort = SORTS[sq.sort];
    const price = `${sq.minPrice !== undefined ? `&preciodesde=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&preciohasta=${Math.ceil(sq.maxPrice)}` : ""}`;
    return {
      url: `https://www.todocoleccion.net/buscador?bu=${plus(sq.query)}${sort ? `&O=${sort}` : ""}${price}${sq.page > 1 ? `&P=${sq.page}` : ""}`,
      // preciodesde/preciohasta narrow the search but are not checked against the shown price:
      // auctions whose current bid is below the floor still come back, so mcpy filters too.
      applies: { sort: sort !== undefined },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "Cloudflare challenge" };
    if (/Sin resultados para/.test(page.content) && !/class="ga-track-buscador"/.test(page.content)) return { kind: "empty" };
    const grid = resultGrid(page.content);
    if (!grid) return { kind: "failed", failure: "redesigned", detail: "no #buscador-lote-items-container result grid" };
    const cards = blocks(grid, /<div class="card-lote card-lote-as-gallery"/);
    if (cards.length === 0) return { kind: "empty" };
    const rows = cards.map(row).filter((r): r is RawListing => r !== undefined);
    const total = count(first(page.content, /([\d.]+)\s+lotes\b/));
    return { kind: "results", rows, total, hasMore: total !== undefined ? sq.page * PAGE_SIZE < total : cards.length === PAGE_SIZE };
  },
};
