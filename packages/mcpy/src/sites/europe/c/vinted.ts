/**
 * Vinted France. Probed 2026-11-22 through tools.ly.tl: a plain fetch serves
 * /catalog (3-4 MB); the rows are server-rendered cards only (the Next flight
 * data carries translations, not items; /api/v2/catalog/items answers 404
 * without a session cookie). Each card (data-testid="product-item-id-N")
 * states the title in its link title ("Title, Marque: X, État: Y, 21.00 €,
 * 22.75 €"), the price, the price with buyer protection, brand and
 * condition. order=newest_first is newest first; price_from/price_to are
 * applied by the site (checked: every row within 50-200). The empty page has
 * data-testid="search-empty-state--title".
 */

import { Condition, ShoppingSort } from "../../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../../readers/html.js";
import { q, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";

const PAGE_SIZE = 96;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "newest_first",
  [ShoppingSort.PriceLow]: "price_low_to_high",
  [ShoppingSort.PriceHigh]: "price_high_to_low",
  [ShoppingSort.Relevance]: "relevance",
};

const CONDITIONS: Readonly<Record<string, Condition>> = {
  "neuf avec étiquette": Condition.New,
  "neuf sans étiquette": Condition.New,
  "très bon état": Condition.Used,
  "bon état": Condition.Used,
  satisfaisant: Condition.Used,
};

/** "Title, Marque: X, État: Y, 21.00 €, 22.75 €" -> "Title". */
export function vintedTitle(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const cut = label.search(/, (?:Marque|État|Taille|Couleur)\s?: /);
  if (cut > 0) return label.slice(0, cut);
  return label.replace(/(?:, [\d.,]+\s?€)+$/, "");
}

function row(card: string): RawListing | undefined {
  const id = first(card, /data-testid="product-item-id-(\d+)"/);
  const link = card.match(/<a [^>]*data-testid="product-item-id-\d+--overlay-link"[^>]*>/i)?.[0];
  const url = attr(link, "href");
  if (!id || !url) return undefined;
  const condition = text(first(card, /--description-subtitle">([\s\S]*?)<\//i));
  const total = str(attr(card.match(/<button[^>]*aria-label="[^"]*frais Vinted inclus"[^>]*>/i)?.[0], "aria-label"));
  return {
    url: url.replace(/\?.*$/, ""),
    id,
    title: vintedTitle(str(attr(link, "title"), 1_000)),
    price: text(first(card, /--price-text">([\s\S]*?)<\//i)),
    currency: "EUR",
    condition: condition ? CONDITIONS[condition.toLowerCase()] : undefined,
    promoted: /--bump-text"/.test(card),
    image: attr(card.match(/<img[^>]*data-testid="product-item-id-\d+--image--img"[^>]*>/i)?.[0], "src"),
    details: {
      Brand: text(first(card, /--description-title">([\s\S]*?)<\//i)),
      Condition: condition,
      "With buyer protection": total?.replace(/,\s*frais Vinted inclus$/, ""),
    },
  };
}

export const vintedFr: ShoppingSite = {
  key: "vinted_fr",
  host: "www.vinted.fr",
  country: "fr",
  currency: "EUR",
  language: "fr",
  kind: SiteKind.Marketplace,
  listingId: (url) => /^\/items\/(\d+)/.exec(url.pathname)?.[1],
  search(sq) {
    const order = SORTS[sq.sort];
    const price = `${sq.minPrice !== undefined ? `&price_from=${sq.minPrice}` : ""}${sq.maxPrice !== undefined ? `&price_to=${sq.maxPrice}` : ""}${sq.minPrice !== undefined || sq.maxPrice !== undefined ? "&currency=EUR" : ""}`;
    return {
      url: `https://www.vinted.fr/catalog?search_text=${q(sq.query)}${order ? `&order=${order}` : ""}${price}${sq.page > 1 ? `&page=${sq.page}` : ""}`,
      applies: { sort: order !== undefined, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const cards = blocks(page.content, /<div [^>]*data-testid="grid-item"/);
    if (cards.length === 0) {
      if (/data-testid="search-empty-state--title"/.test(page.content)) return { kind: "empty" };
      return { kind: "failed", failure: "redesigned", detail: "no grid-item cards and no empty-state notice" };
    }
    const rows = cards.map(row).filter((r): r is RawListing => r !== undefined);
    return { kind: "results", rows, hasMore: cards.length >= PAGE_SIZE };
  },
};
