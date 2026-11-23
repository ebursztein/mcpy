/**
 * Kleinanzeigen (de). Probed 2026-11-22 through tools.ly.tl: a plain fetch
 * serves the search page; there is no embedded search state or public JSON
 * API, so rows are read from the HTML cards in ul#srchrslt-adtable
 * (<li data-clickable="card"><article data-adid ...>, 25 a page plus TOP ads).
 * A TOP ad carries a badge <svg> before its <article> and is marked promoted.
 * The path applies price and sort: /s-preis:MIN:MAX/sortierung:neuste/WORDS/k0
 * (checked: every row >= the floor, newest first), and /seite:N/ pages.
 */

import { ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../../readers/html.js";
import { dash, timestamp } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";
import { blocked, redesigned } from "./outcome.js";

const HOST = "www.kleinanzeigen.de";
const SORTS: Partial<Record<string, string>> = { [ShoppingSort.Newest]: "sortierung:neuste" };

/** "20.11.2026" -> 2026-11-20 at German local midnight; "Heute, 01:20" stays text. */
function postedAt(label: string | undefined): string | undefined {
  const m = label ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(label) : null;
  return m ? timestamp(`${m[3]}-${m[2]}-${m[1]}`, "+01:00") : undefined;
}

function row(card: string): RawListing | undefined {
  const at = card.indexOf("<article");
  if (at < 0) return undefined;
  const top = /<svg/i.test(card.slice(0, at));
  const article = card.slice(at);
  const id = first(article, /data-adid="(\d+)"/);
  const href = attr(first(article, /(<article[^>]*>)/), "data-href");
  if (!id || !href) return undefined;
  const title = text(first(article, /<h3[^>]*>([\s\S]*?)<\/h3>/));
  const price = text(first(article, /<div[^>]*>\s*<p[^>]*>([^<]*)<\/p>\s*<\/div>/));
  const tags = [...article.matchAll(/<span[^>]*data-dhl-promotion[^>]*>([^<]+)<\/span>/g)].map((m) => text(m[1])).filter((t): t is string => !!t);
  const spans = [...article.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => text(m[1])).filter((t): t is string => !!t);
  const location = spans.find((s) => /^\d{5}\s/.test(s));
  const date = spans.find((s) => /^(Heute|Gestern|\d{2}\.\d{2}\.\d{4})/.test(s));
  const shop = text(first(article, /<a[^>]*href="\/pro\/[^"]*"[^>]*>\s*<span>([^<]+)<\/span>/));
  const wanted = tags.includes("Gesuch");
  return {
    url: new URL(href, `https://${HOST}`).href,
    id,
    title,
    description: text(first(article, /<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/)),
    price,
    currency: "EUR",
    format: wanted ? ListingFormat.Wanted : price && /\bVB\b/.test(price) ? ListingFormat.BestOffer : ListingFormat.FixedPrice,
    postedAt: postedAt(date),
    postedText: date,
    location,
    country: "de",
    seller: shop,
    promoted: top,
    image: attr(first(article, /(<img[^>]*>)/), "src"),
    details: {
      Price: price,
      Shipping: tags.includes("Versand möglich") ? "available" : undefined,
      "Buy now": tags.includes("Direkt kaufen") ? true : undefined,
      Seller: shop ? "business" : undefined,
    },
  };
}

export const kleinanzeigen: ShoppingSite = {
  key: "kleinanzeigen",
  host: HOST,
  country: "de",
  currency: "EUR",
  language: "de",
  kind: SiteKind.Classifieds,
  listingId: (url) => /^\/s-anzeige\/[^/]+\/(\d+)-\d+-\d+\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const filters: string[] = [];
    if (sq.minPrice !== undefined || sq.maxPrice !== undefined) {
      filters.push(`preis:${sq.minPrice !== undefined ? Math.floor(sq.minPrice) : ""}:${sq.maxPrice !== undefined ? Math.ceil(sq.maxPrice) : ""}`);
    }
    if (sq.page > 1) filters.push(`seite:${sq.page}`);
    const sort = SORTS[sq.sort];
    if (sort) filters.push(sort);
    const words = dash(sq.query.trim().toLowerCase().replace(/\s+/g, " "));
    return {
      url: `https://${HOST}/s-${[...filters, words].join("/")}/k0`,
      applies: { sort: sort !== undefined || sq.sort === ShoppingSort.Relevance, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return blocked("challenge page");
    const start = page.content.indexOf('id="srchrslt-adtable"');
    if (start < 0) {
      if (/Es wurden (?:leider )?keine Ergebnisse/.test(page.content)) return { kind: "empty" };
      return redesigned("no srchrslt-adtable on the search page");
    }
    const endAt = page.content.indexOf('id="srchrslt-pagination"', start);
    const list = page.content.slice(start, endAt < 0 ? undefined : endAt);
    const rows = blocks(list, /<li[^>]*data-clickable="card"/).map(row).filter((r): r is RawListing => r !== undefined);
    if (rows.length === 0) return /Es wurden (?:leider )?keine Ergebnisse/.test(page.content) ? { kind: "empty" } : redesigned("no ad cards in srchrslt-adtable");
    const summary = text(first(page.content, /id="srp-breadcrumb-summary"[^>]*>([\s\S]*?)<\/span>/));
    const m = summary ? /(\d+)\s*-\s*(\d+)\s+von\s+([\d.]+)/.exec(summary) : null;
    const total = m ? Number(m[3]!.replace(/\./g, "")) : undefined;
    return { kind: "results", rows, total, hasMore: m ? Number(m[2]) < total! : undefined };
  },
};
