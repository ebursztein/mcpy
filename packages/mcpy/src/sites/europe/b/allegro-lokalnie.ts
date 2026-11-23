/**
 * Allegro Lokalnie (pl). Probed 2026-11-22 through tools.ly.tl: a plain fetch
 * of /oferty/q/WORDS serves the page with a JSON-LD ItemList (name, url,
 * price, condition) and one <article itemtype="http://schema.org/Offer">
 * card per row, which also states the offer type (Kup teraz / Licytacja with
 * its end time and bidders), "do negocjacji", the town and the sponsored
 * badge. Cards are read and the JSON-LD adds the condition. The first block
 * is "Ogłoszenia promowane" (sponsored, marked promoted); cards linking to
 * allegro.pl are allegro.pl offers, not Lokalnie listings, and are dropped
 * by the host check. price_from/price_to and sort (startingTime-desc,
 * price-asc, price-desc) are applied by the site (checked: every row >= the
 * floor; the sort values are the site's own select options).
 */

import { Condition, ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import { attr, blocks, first, jsonLd, looksBlocked, text } from "../../readers/html.js";
import { parseJson, pick } from "../../readers/json.js";
import { count, dash, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";
import { blocked, redesigned } from "./outcome.js";

const HOST = "allegrolokalnie.pl";
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "startingTime-desc",
  [ShoppingSort.PriceLow]: "price-asc",
  [ShoppingSort.PriceHigh]: "price-desc",
};
const EMPTY = /nie możemy znaleźć żadnego ogłoszenia/i;

function conditions(html: string): Map<string, Condition> {
  const out = new Map<string, Condition>();
  for (const product of jsonLd(html, "Product")) {
    const url = str(product["url"], 2_000);
    const c = str(product["itemCondition"]);
    if (!url || !c) continue;
    if (/NewCondition/.test(c)) out.set(url, Condition.New);
    else if (/UsedCondition/.test(c)) out.set(url, Condition.Used);
    else if (/RefurbishedCondition/.test(c)) out.set(url, Condition.Refurbished);
    else if (/DamagedCondition/.test(c)) out.set(url, Condition.ForParts);
  }
  return out;
}

function row(card: string, conditionOf: Map<string, Condition>): RawListing | undefined {
  const href = attr(first(card, /(<a[^>]*itemprop="url"[^>]*>)/), "href");
  if (!href) return undefined;
  const url = new URL(href, `https://${HOST}`).href;
  const auction = /mlc-itembox__offer-type--bidding|>\s*Licytacja\s*</.test(card);
  const whole = text(first(card, /<span[^>]*ml-offer-price__dollars[^>]*>([^<]*)<\/span>/));
  const cents = text(first(card, /<span[^>]*ml-offer-price__cents[^>]*>([^<]*)<\/span>/));
  const ending = parseJson(attr(first(card, /(<span[^>]*data-mlc-itembox-bidding-remaining-time=[^>]*>)/), "data-mlc-itembox-bidding-remaining-time"));
  const bidders = first(card, /(\d+)\s+os(?:oba|oby|ób)\s+licytuj/);
  const negotiable = /do negocjacji/.test(card);
  const sellerType = text(first(card, /(Sprzedający:[^<]*)</));
  return {
    url,
    title: text(first(card, /<h3[^>]*>([\s\S]*?)<\/h3>/)),
    price: whole ? `${whole}${cents ?? ""}` : undefined,
    currency: "PLN",
    format: auction ? ListingFormat.Auction : negotiable ? ListingFormat.BestOffer : ListingFormat.FixedPrice,
    bids: auction ? count(bidders) : undefined,
    endsAt: auction ? str(pick(ending, ["endingAt"])) : undefined,
    condition: conditionOf.get(url),
    location: text(first(card, /<address[^>]*>([\s\S]*?)<\/address>/)),
    country: "pl",
    promoted: /data-mlc-sponsor-modal-button/.test(card),
    image: attr(first(card, /(<img[^>]*>)/), "src"),
    details: { Seller: sellerType?.replace(/^Sprzedający:\s*/, ""), Negotiable: negotiable ? true : undefined },
  };
}

/** The pager: <input type="number" max="LAST" value="CURRENT">. */
function hasMore(html: string): boolean | undefined {
  const at = html.indexOf("Paginacja stron");
  const input = at < 0 ? undefined : first(html.slice(at, at + 3_000), /(<input[^>]*type="number"[^>]*>)/);
  const last = Number(attr(input, "max"));
  const current = Number(attr(input, "value"));
  return Number.isFinite(last) && Number.isFinite(current) && last > 0 ? current < last : undefined;
}

export const allegroLokalnie: ShoppingSite = {
  key: "allegro_lokalnie",
  host: HOST,
  country: "pl",
  currency: "PLN",
  language: "pl",
  kind: SiteKind.Classifieds,
  listingId: (url) => /^\/oferta\/([^/]+)\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const params = new URLSearchParams();
    if (sq.minPrice !== undefined) params.set("price_from", String(Math.floor(sq.minPrice)));
    if (sq.maxPrice !== undefined) params.set("price_to", String(Math.ceil(sq.maxPrice)));
    const sort = SORTS[sq.sort];
    if (sort) params.set("sort", sort);
    if (sq.page > 1) params.set("page", String(sq.page));
    const qs = params.toString();
    return {
      url: `https://${HOST}/oferty/q/${dash(sq.query.trim().replace(/\s+/g, " "))}${qs ? `?${qs}` : ""}`,
      applies: { sort: sort !== undefined || sq.sort === ShoppingSort.Relevance, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return blocked("challenge page");
    const cards = blocks(page.content, /<article\b/).map((b) => {
      const end = b.indexOf("</article>");
      return end < 0 ? b : b.slice(0, end);
    });
    if (cards.length === 0) return EMPTY.test(page.content) ? { kind: "empty" } : redesigned("no offer cards on the search page");
    const conditionOf = conditions(page.content);
    const rows = cards.map((c) => row(c, conditionOf)).filter((r): r is RawListing => r !== undefined);
    return { kind: "results", rows, hasMore: hasMore(page.content) };
  },
};
