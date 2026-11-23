/**
 * One eBay search card (li.s-card) -> a row. The card states its facts as
 * short text rows ("3 bids", "+£4.50 delivery", "from Japan", "Listed 1m
 * ago"); each is classified by the site's own words. "Sponsored" is hidden:
 * the footer's <b aria-labelledby="ids"> names hidden divs, and the card is
 * promoted when one of them holds text (eBay leaves the others empty).
 */

import { Condition, ListingFormat } from "../../services/shopping/schema.js";
import { attr, first, text } from "../readers/html.js";
import type { RawListing } from "../types.js";

/** The words one eBay site uses on its cards. */
export interface EbayWords {
  bids: RegExp;
  bestOffer: RegExp;
  buyNow: RegExp;
  freeShipping: RegExp;
  location: RegExp;
  listed: RegExp;
  timeLeft: RegExp;
  seller: RegExp;
}

const CONDITIONS: readonly [RegExp, Condition][] = [
  [/open box|geöffnet|ouvert|aperta|caja abierta/i, Condition.OpenBox],
  [/refurb|generalüberholt|reconditionné|ricondizionat|reacondicionado|restaurado/i, Condition.Refurbished],
  [/for parts|parts only|defekt|ersatzteil|pour pièces|per ricambi|para piezas|no funciona/i, Condition.ForParts],
  [/pre-owned|used|gebraucht|occasion|usato|segunda mano|usado/i, Condition.Used],
  [/\bnew\b|\bneu\b|neuf|nuovo|nuevo/i, Condition.New],
];

export const conditionOf = (subtitle: string | undefined): Condition | undefined => (subtitle ? CONDITIONS.find(([re]) => re.test(subtitle))?.[1] : undefined);

/** The currency a price text states; null when it names one this site does not use (C $, AU $). */
function currencyOf(price: string): string | undefined | null {
  if (/£|GBP/.test(price)) return "GBP";
  if (/€|EUR/.test(price)) return "EUR";
  if (/^(?:US\s*)?\$|USD/.test(price.trim())) return "USD";
  return /[A-Z]{1,3}\s*\$|[A-Z]{3}\s*\d/.test(price) ? null : undefined;
}

/** id -> text of the hidden label divs eBay points aria-labelledby at. */
export function hiddenLabels(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<div id="?(s-[a-z0-9]+)"?>([^<]*)<\/div>/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

function promoted(card: string, labels: Map<string, string>): boolean | undefined {
  const sep = first(card, /class="?s-card__sep"?[^>]*>\s*(<b[^>]*>)/);
  const ids = attr(sep, "aria-labelledby");
  if (!ids) return undefined;
  return ids.split(/\s+/).some((id) => (labels.get(id) ?? "") !== "");
}

/** The visible text rows of a card, in order: [class, text]. */
function spans(card: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of card.matchAll(/<span class="su-styled-text ([^"]*)"[^>]*>([\s\S]*?)<\/span>/g)) {
    const t = text(m[2]);
    if (t) out.push([m[1]!, t]);
  }
  return out;
}

/** The item number from /itm/123456789012 or /itm/slug/123456789012. */
export const ebayItemId = (url: URL): string | undefined => /^\/itm\/(?:[^/]+\/)?(\d{9,15})\/?$/.exec(url.pathname)?.[1];

export function ebayCard(card: string, host: string, words: EbayWords, labels: Map<string, string>): RawListing | undefined {
  const href = attr(/<a\b[^>]*\bs-card__link\b[^>]*>/.exec(card)?.[0], "href");
  let link: URL;
  try {
    link = new URL(href ?? "");
  } catch {
    return undefined;
  }
  const id = link.hostname === host ? ebayItemId(link) : undefined;
  if (!id) return undefined;
  const titleAt = card.search(/s-card__title/);
  const title = titleAt < 0 ? undefined : text(first(card.slice(titleAt), /<span class="su-styled-text primary[^"]*"[^>]*>([\s\S]*?)<\/span>/));
  const subtitleAt = card.search(/class="?s-card__subtitle"?>/);
  const subtitleParts = subtitleAt < 0 ? [] : [...card.slice(subtitleAt, card.indexOf("</div>", subtitleAt)).matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((m) => text(m[1])?.replace(/\s*\|$/, ""));
  const [subtitle, sellerType] = subtitleParts.filter((s): s is string => !!s);
  const prices = spans(card).filter(([cls]) => cls.includes("s-card__price"));
  const rows = spans(card).filter(([cls]) => !cls.includes("s-card__price") && !/primary default/.test(cls));
  const priceText = prices[0]?.[1];
  const currency = priceText ? currencyOf(priceText) : undefined;
  const has = (re: RegExp) => rows.some(([, t]) => re.test(t));
  const match = (re: RegExp) => rows.map(([, t]) => re.exec(t)).find((m) => m);
  const bids = match(words.bids)?.[1];
  const auction = bids !== undefined;
  const bestOffer = has(words.bestOffer);
  const shipping = has(words.freeShipping) ? "free" : rows.map(([, t]) => t).find((t) => /^\+\s*\D{0,4}\s*\d/.test(t) && !t.includes("%"));
  const seller = match(words.seller);
  const timeLeft = match(words.timeLeft)?.[0];
  const img = /<img\b[^>]*s-card__image[^>]*>/.exec(card)?.[0];
  const image = attr(img, "src") ?? attr(img, "data-defer-load");
  return {
    url: `https://${host}/itm/${id}`,
    id,
    title,
    price: currency === null ? undefined : priceText,
    currency: currency ?? undefined,
    format: auction ? ListingFormat.Auction : bestOffer ? ListingFormat.BestOffer : ListingFormat.FixedPrice,
    bids: bids,
    buyNow: auction && has(words.buyNow) && prices[1] && currency !== null ? prices[1][1] : undefined,
    shipping,
    condition: conditionOf(subtitle),
    postedText: match(words.listed)?.[0],
    location: match(words.location)?.[1],
    seller: seller?.[1],
    sellerFeedbackPercent: seller?.[2],
    sellerFeedbackCount: seller?.[3],
    promoted: promoted(card, labels),
    image: image && !/ir\.ebaystatic\.com/.test(image) ? image : undefined,
    details: { Condition: subtitle, "Seller type": sellerType, "Time left": timeLeft, "Best offer": auction && bestOffer ? true : undefined },
  };
}
