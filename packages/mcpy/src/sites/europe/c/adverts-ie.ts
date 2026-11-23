/**
 * Adverts.ie (Ireland). Probed 2026-11-22: a plain fetch answers HTTP 403
 * "Security Check | Adverts" from Cloudflare and from a residential IP, and
 * /api/search is 403 too; Firecrawl (basic proxy) serves the real page.
 * Rows are server-rendered grid cells (div.sr-grid-cell, 30 a page) with
 * price ("FREE", "€30"), title, area and county. Filters are path segments:
 * /for-sale/q_<words>/price_<min>-<max|*>/sortby_<order>/page-N/;
 * sortby_best_refresh_date-desc is "Most Recent", price-asc/-desc the price
 * orders. No results: "0 results" and no grid cells.
 */

import { ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../../readers/html.js";
import { amount, count, q } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";

const PAGE_SIZE = 30;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "best_refresh_date-desc",
  [ShoppingSort.PriceLow]: "price-asc",
  [ShoppingSort.PriceHigh]: "price-desc",
};

function row(cell: string): RawListing | undefined {
  const priceBlock = first(cell, /<div class="price">([\s\S]*?)<\/div>/i);
  const link = priceBlock?.match(/<a [^>]*>/i)?.[0] ?? cell.match(/<a href="[^"]*" class="main-image"/i)?.[0];
  const url = attr(link, "href");
  if (!url) return undefined;
  const priceText = text(first(priceBlock, /<a [^>]*>([\s\S]*?)<\/a>/i));
  const free = priceText !== undefined && /^free$/i.test(priceText);
  return {
    url,
    title: text(first(cell, /<div class="title">\s*<a [^>]*>([\s\S]*?)<\/a>/i)),
    price: free ? undefined : priceText,
    currency: "EUR",
    format: free || amount(priceText) !== undefined ? ListingFormat.FixedPrice : undefined,
    location: text(first(cell, /<div class="location">([\s\S]*?)<\/div>/i))?.replace(/\s+,/g, ","),
    country: "ie",
    image: attr(cell.match(/<img[^>]*class="main-ad-image"[^>]*>/i)?.[0], "src"),
    details: { Price: free ? "Free" : undefined },
  };
}

export const advertsIe: ShoppingSite = {
  key: "adverts_ie",
  host: "www.adverts.ie",
  country: "ie",
  currency: "EUR",
  language: "en",
  kind: SiteKind.Classifieds,
  listingId: (url) => /^\/[a-z0-9-]+\/[^/]+\/(\d{5,})\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const sort = SORTS[sq.sort];
    const priced = sq.minPrice !== undefined || sq.maxPrice !== undefined;
    const price = priced ? `price_${Math.floor(sq.minPrice ?? 0)}-${sq.maxPrice !== undefined ? Math.ceil(sq.maxPrice) : "*"}/` : "";
    const words = q(sq.query.trim().replace(/\s+/g, " ")).replace(/%20/g, "+");
    return {
      url: `https://www.adverts.ie/for-sale/q_${words}/${price}${sort ? `sortby_${sort}/` : ""}${sq.page > 1 ? `page-${sq.page}/` : ""}`,
      applies: { sort: sort !== undefined, minPrice: priced, maxPrice: priced },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content) || /<title>\s*Security Check/i.test(page.content)) return { kind: "failed", failure: "blocked", detail: "Security Check page" };
    const posts = page.content.indexOf('<div class="posts');
    const cells = posts < 0 ? [] : blocks(page.content.slice(posts), /<div class="sr-grid-cell/);
    if (cells.length === 0) {
      if (/>\s*All categories\s+0 results\b|\b0 results\s*</.test(page.content)) return { kind: "empty" };
      return { kind: "failed", failure: "redesigned", detail: "no div.sr-grid-cell results and no empty notice" };
    }
    const rows = cells.map(row).filter((r): r is RawListing => r !== undefined);
    const total = count(first(page.content, /([\d,]+)\s+results\b/));
    return { kind: "results", rows, total, hasMore: total !== undefined ? sq.page * PAGE_SIZE < total : cells.length === PAGE_SIZE };
  },
};
