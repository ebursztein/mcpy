/**
 * Mercari Japan. Probed 2026-11-23: the unrendered search page is an app
 * shell with no rows (checked through tools.ly.tl). The page fills itself from
 * api.mercari.jp/v2/entities:search, which answers 401 without a DPoP proof
 * signed in the browser, so mcpy does not call it. The rendered page
 * (render: true) has one <li data-testid="item-cell"> per listing, with the
 * canonical jp.mercari.com/item/m... or /shops/product/... link.
 *
 * keyword, sort/order, price_min/price_max, status=on_sale and
 * page_token=v1:N are applied by the site (rendered: every row on sale and
 * >= the floor, data-location "search_result:newest"). The tile shows the price
 * in the currency Mercari picks for the visitor's IP (US$ from a US renderer),
 * so the render is asked from Japan (country: "jp"), where tiles state yen;
 * each row still carries the currency it states, and a symbol we cannot map
 * drops the price rather than mislabel it. From Japan the grid needs ~10 s to
 * fill (4 s gave skeleton cells only).
 */

import { ListingFormat, ListingStatus, ShoppingSort } from "../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../readers/html.js";
import { q } from "../readers/values.js";
import type { RawListing, ShoppingSite } from "../types.js";

const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "&sort=created_time&order=desc",
  [ShoppingSort.PriceLow]: "&sort=price&order=asc",
  [ShoppingSort.PriceHigh]: "&sort=price&order=desc",
  [ShoppingSort.Relevance]: "&sort=score&order=desc",
};

const SYMBOLS: Readonly<Record<string, string>> = { "¥": "JPY", "￥": "JPY", "US$": "USD", $: "USD", "€": "EUR", "£": "GBP", "HK$": "HKD", "NT$": "TWD", "S$": "SGD", "A$": "AUD", "C$": "CAD", "₩": "KRW" };

/** The rendered empty state; the same words also sit in the i18n bundle, so scripts are cut first. */
const EMPTY = "出品された商品がありません";

function row(cell: string): RawListing | undefined {
  const href = attr(/<a[^>]*data-testid="thumbnail-link"[^>]*>/.exec(cell)?.[0], "href");
  if (!href) return undefined;
  // <span data-testid="item-tile-price"><span><span>¥</span><span>8,000</span></span></span>; an auction's
  // current bid reads "現在 ¥".
  const price = /data-testid="item-tile-price"[^>]*><span[^>]*><span[^>]*>([^<]*)<\/span><span[^>]*>([^<]*)<\/span>/.exec(cell);
  const label = price?.[1]!.trim() ?? "";
  const auction = label.startsWith("現在");
  const currency = SYMBOLS[label.replace(/^現在\s*/, "")];
  return {
    url: href,
    title: text(first(cell, /data-testid="thumbnail-item-name"[^>]*>([\s\S]*?)<\/p>/)),
    price: currency ? price![2] : undefined,
    currency,
    format: auction ? ListingFormat.Auction : ListingFormat.FixedPrice,
    // The request asks for status=on_sale only.
    status: ListingStatus.Available,
    image: attr(/<img[^>]*>/.exec(cell)?.[0], "src"),
    details: /\/shops\/product\//.test(href) ? { Seller: "Mercari Shops" } : undefined,
  };
}

export const mercariJp: ShoppingSite = {
  key: "mercari_jp",
  host: "jp.mercari.com",
  country: "jp",
  currency: "JPY",
  language: "ja",
  kind: "marketplace",
  listingId: (url) => /^\/(?:item\/(m\d{8,14})|shops\/product\/([A-Za-z0-9]{10,40}))\/?$/.exec(url.pathname)?.slice(1).find(Boolean),
  search(sq) {
    const price = `${sq.minPrice !== undefined ? `&price_min=${Math.ceil(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&price_max=${Math.floor(sq.maxPrice)}` : ""}`;
    const sort = SORTS[sq.sort];
    const token = sq.page > 1 ? `&page_token=${q(`v1:${sq.page - 1}`)}` : "";
    return {
      url: `https://jp.mercari.com/search?keyword=${q(sq.query)}&status=on_sale${sort ?? ""}${price}${token}`,
      render: true,
      waitMs: 10_000,
      // Mercari prices tiles in the visitor's currency by IP: render from Japan for yen.
      country: "jp",
      applies: { sort: sort !== undefined, minPrice: true, maxPrice: true },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const html = page.content.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
    const cells = blocks(html, /<li[^>]*data-testid="item-cell"/);
    if (!cells.length) {
      if (html.includes(EMPTY)) return { kind: "empty" };
      return { kind: "failed", failure: "redesigned", detail: /data-testid="item-grid"|id="item-grid"/.test(html) ? "item grid without cells" : "no item cells (page not rendered?)" };
    }
    const rows = cells.map(row).filter((r): r is RawListing => r !== undefined);
    const next = html.includes(`page_token=v1%3A${sq.page}`) && /data-testid="pagination-next-button"/.test(html);
    return { kind: "results", rows, hasMore: next };
  },
};
