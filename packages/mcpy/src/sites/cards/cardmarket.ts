/**
 * Cardmarket (Pokémon). Probed 2026-11-22: a plain fetch from Cloudflare
 * times out and direct fetches get a 401; the Firecrawl fallback (no render)
 * serves the real pages. There is no public JSON: both pages are HTML.
 *
 *   /en/Pokemon/Products/Search?searchString=...&site=N  gallery of products ("From 0,02 €")
 *   /en/Pokemon/Products/Singles/{set}/{card}             up to 50 offers (div#articleRow{id})
 *
 * Search rows are products, so each offer on a product page is a listing
 * (id = article id). Each game has its own path (/en/Pokemon, /en/Magic,
 * /en/YuGiOh, /en/OnePiece, /en/Lorcana, all linked from the site menu) and
 * there is no cross-game search; Pokémon is the default. Sorting orders products, not offers,
 * and price bounds are not on the URL: left to mcpy.
 */

import { SiteFailure } from "../../services/common.js";
import { Game, ListingFormat } from "../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../readers/html.js";
import { count, q, str } from "../readers/values.js";
import { SiteKind, type ProductLink, type RawListing, type ReadOutcome, type ShoppingSite } from "../types.js";
import { CARDMARKET_GRADES, countryCode, languageCode } from "./grades.js";

/** Cardmarket's path segment per game. */
const GAMES: Readonly<Record<Game, string>> = { [Game.Pokemon]: "Pokemon", [Game.Magic]: "Magic", [Game.YuGiOh]: "YuGiOh", [Game.OnePiece]: "OnePiece", [Game.Lorcana]: "Lorcana" };
const base = (game: Game | undefined): string => `https://www.cardmarket.com/en/${GAMES[game ?? Game.Pokemon]}`;
const PRODUCT_PATH = /^\/[a-z]{2}\/[A-Za-z-]+\/Products\/[^?#]+$/;

const blocked: ReadOutcome = { kind: "failed", failure: SiteFailure.Blocked, detail: "challenge page" };

function productLinks(html: string): ProductLink[] {
  const out: ProductLink[] = [];
  for (const card of blocks(html, /<a [^>]*class="card[^"]*galleryBox/)) {
    const href = attr(first(card, /^(<a [^>]*>)/), "href");
    if (!href) continue;
    const url = new URL(href, "https://www.cardmarket.com");
    if (!PRODUCT_PATH.test(url.pathname)) continue;
    const title = text(first(card, /<h2[^>]*>([\s\S]*?)<\/h2>/));
    out.push({ id: url.pathname.split("/").slice(-2).join("/"), url: url.href, title });
  }
  return out;
}

/** Facts about one offer from its div#articleRow block. */
function offer(row: string, link: ProductLink, pageTitle: string | undefined): RawListing | undefined {
  const id = first(row, /^id="articleRow(\d+)"/);
  if (!id) return undefined;
  const attrs = row.slice(row.indexOf("product-attributes"), row.indexOf("product-comments"));
  const grade = first(attrs, /class="badge[^"]*">([A-Z]{2})</);
  const labels = [...attrs.matchAll(/class="icon[^"]*"[^>]*aria-label="([^"]+)"|aria-label="([^"]+)"[^>]*class="icon/g)].map((m) => m[1] ?? m[2]!);
  const language = labels.map(languageCode).find((l) => l !== undefined);
  const extras = labels.filter((l) => languageCode(l) === undefined && !l.includes("<"));
  const location = first(row, /aria-label="Item location: ([^"]+)"/);
  const sales = first(row, /data-bs-original-title="([\d.,]+)&nbsp;Sales/) ?? first(row, /data-bs-original-title="([\d.,]+)\s*Sales/);
  const price = first(row, /class="price-container[\s\S]*?<span class="color-primary[^"]*">([^<]+)</) ?? first(row, /<span class="color-primary[^"]*">([^<]+)</);
  const comment = text(first(row, /class="product-comments[^"]*"[\s\S]*?<span class="d-block text-truncate[^"]*">([\s\S]*?)<\/span>/));
  return {
    url: link.url,
    id,
    title: pageTitle ?? link.title,
    description: comment,
    price: str(price),
    currency: "EUR",
    format: ListingFormat.FixedPrice,
    cardCondition: grade ? CARDMARKET_GRADES[grade] : undefined,
    language,
    quantity: str(first(row, /class="item-count[^"]*">(\d+)</)),
    seller: text(first(row, /href="[^"]*\/Users\/[^"]*">([^<]+)<\/a>/)),
    location,
    country: countryCode(location),
    details: {
      Condition: grade,
      "Seller sales": sales ? count(sales) : undefined,
      Professional: /aria-label="Professional"/.test(row) ? true : undefined,
      Extras: extras.length ? extras.join(", ") : undefined,
    },
  };
}

export const cardmarket: ShoppingSite = {
  key: "cardmarket",
  host: "www.cardmarket.com",
  country: "de",
  currency: "EUR",
  language: "en",
  kind: SiteKind.Marketplace,
  games: [Game.Pokemon, Game.Magic, Game.YuGiOh, Game.OnePiece, Game.Lorcana],
  listingId: (url) => (PRODUCT_PATH.test(url.pathname) ? url.pathname.split("/").slice(-2).join("/") : undefined),
  search(sq) {
    return { url: `${base(sq.game)}/Products/Search?searchString=${q(sq.query)}${sq.page > 1 ? `&site=${sq.page}` : ""}` };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return blocked;
    // A search with one match can land straight on its product page.
    if (/id="articleRow\d+/.test(page.content)) {
      const url = new URL(page.finalUrl);
      const title = text(first(page.content, /<h1[^>]*>([\s\S]*?)<span/));
      return { kind: "results", rows: [], products: [{ id: url.pathname.split("/").slice(-2).join("/"), url: `${url.origin}${url.pathname}`, title }] };
    }
    const hits = first(page.content, />\s*([\d.,]+) Hits\s*</);
    const products = productLinks(page.content);
    if (products.length) return { kind: "results", rows: [], products, total: count(hits), hasMore: new RegExp(`[?&](?:amp;)?site=${sq.page + 1}\\b`).test(page.content) };
    if (hits !== undefined && count(hits) === 0) return { kind: "empty" };
    if (/class="[^"]*noResults|Sorry, no matches/i.test(page.content)) return { kind: "empty" };
    return { kind: "failed", failure: SiteFailure.Redesigned, detail: "no product gallery" };
  },
  product: {
    request: (link) => ({ url: link.url }),
    read(page, link) {
      if (looksBlocked(page.content)) return blocked;
      const rows = blocks(page.content, /id="articleRow\d+/);
      if (!rows.length) {
        return /class="table-body"/.test(page.content) || /No offers/i.test(page.content)
          ? { kind: "empty" }
          : { kind: "failed", failure: SiteFailure.Redesigned, detail: "no offer rows" };
      }
      const pageTitle = text(first(page.content, /<h1[^>]*>([\s\S]*?)<span/));
      const listings = rows.map((r) => offer(r, link, pageTitle)).filter((r): r is RawListing => r !== undefined);
      return { kind: "results", rows: listings };
    },
  },
};
