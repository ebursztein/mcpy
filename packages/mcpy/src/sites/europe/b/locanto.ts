/**
 * Locanto (de, fr, it, es, gb), one classifieds platform on five hosts.
 * Probed 2026-11-22: tools.ly.tl times out or gets 403, and a direct fetch
 * gets a Cloudflare challenge ("Einen Moment bitte..."), so the page only
 * comes through the paid unblocking fallbacks. The page then has no embedded
 * state or listing JSON-LD; rows are the HTML cards <article data-msgid
 * data-unix> (about 25 a page). The card title is "TITLE, TOWN". The search
 * URL /q/?query= has no verified sort or price parameter, so mcpy filters
 * and sorts the rows itself.
 */

import type { Country, Currency, Language } from "../../../services/common.js";
import type { Marketplace } from "../../../services/shopping/marketplace.js";
import { ListingFormat } from "../../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../../readers/html.js";
import { q } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";
import { blocked, redesigned } from "./outcome.js";

interface LocantoSettings {
  key: Marketplace;
  host: string;
  country: Country;
  currency: Currency;
  language: Language;
}

/** The localized Cloudflare interstitial titles ("One moment please..."). */
const CHALLENGE = /<title>\s*(?:One moment|Einen Moment|Un instant|Un momento|Un attimo)[^<]*<\/title>/i;

function row(card: string, s: LocantoSettings): RawListing | undefined {
  const id = first(card, /data-msgid="(\d+)"/);
  const href = attr(first(card, /(<a[^>]*js-ad_link[^>]*>)/) ?? first(card, /(<a[^>]*href="[^"]*\/ID_\d+\/[^"]*"[^>]*>)/), "href");
  if (!id || !href) return undefined;
  const heading = text(first(card, /<div[^>]*class="h3[^"]*"[^>]*>([\s\S]*?)<\/div>/));
  const comma = heading ? heading.lastIndexOf(", ") : -1;
  const unix = Number(first(card, /data-unix="(\d+)"/));
  return {
    url: new URL(href, `https://${s.host}`).href,
    id,
    title: comma > 0 ? heading!.slice(0, comma) : heading,
    description: text(first(card, /js-description_snippet[^>]*>([\s\S]*?)<\/div>/)),
    price: text(first(card, /<span[^>]*posting_listing__price[^>]*>([\s\S]*?)<\/span>/)),
    currency: s.currency,
    format: ListingFormat.FixedPrice,
    postedAt: Number.isFinite(unix) && unix > 0 ? unix : undefined,
    location: comma > 0 ? heading!.slice(comma + 2) : undefined,
    country: s.country,
    image: attr(first(card, /(<img[^>]*posting_listing__image"[^>]*>)/) ?? first(card, /(<img[^>]*images\.locanto\.info[^>]*>)/), "src"),
    details: { Category: text(first(card, /js-bst_list_item_category[^>]*>([\s\S]*?)<\/span>/)) },
  };
}

function locanto(s: LocantoSettings): ShoppingSite {
  return {
    key: s.key,
    host: s.host,
    country: s.country,
    currency: s.currency,
    language: s.language,
    kind: SiteKind.Classifieds,
    listingId: (url) => /\/ID_(\d+)\//.exec(url.pathname)?.[1],
    search(sq) {
      return { url: `https://${s.host}/q/?query=${q(sq.query)}${sq.page > 1 ? `&page=${sq.page}` : ""}` };
    },
    read(page) {
      if (looksBlocked(page.content) || CHALLENGE.test(page.content)) return blocked("Cloudflare challenge");
      const cards = blocks(page.content, /<article[^>]*data-msgid=/).map((b) => {
        const end = b.indexOf("</article>");
        return end < 0 ? b : b.slice(0, end);
      });
      if (cards.length === 0) {
        if (/class="plp__text"|result_meta__count[^"]*">\s*0\s/.test(page.content)) return { kind: "empty" };
        return redesigned("no result cards on the search page");
      }
      const rows = cards.map((c) => row(c, s)).filter((r): r is RawListing => r !== undefined);
      const total = Number(first(page.content, /result_meta__count[^"]*">\s*([\d.,]+)/)?.replace(/[.,]/g, ""));
      const current = Number(new URL(page.finalUrl).searchParams.get("page") ?? "1");
      return {
        kind: "results",
        rows,
        total: Number.isFinite(total) ? total : undefined,
        hasMore: new RegExp(`[?&;]page=${current + 1}\\b`).test(page.content),
      };
    },
  };
}

export const locantoDe = locanto({ key: "locanto_de", host: "www.locanto.de", country: "de", currency: "EUR", language: "de" });
export const locantoFr = locanto({ key: "locanto_fr", host: "www.locanto.fr", country: "fr", currency: "EUR", language: "fr" });
export const locantoIt = locanto({ key: "locanto_it", host: "www.locanto.it", country: "it", currency: "EUR", language: "it" });
export const locantoEs = locanto({ key: "locanto_es", host: "www.locanto.es", country: "es", currency: "EUR", language: "es" });
export const locantoGb = locanto({ key: "locanto_gb", host: "www.locanto.co.uk", country: "gb", currency: "GBP", language: "en" });
