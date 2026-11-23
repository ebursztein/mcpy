/**
 * eBay active search, one site per domain, each in its own currency.
 * Probed 2026-11-22 through tools.ly.tl: the HTML search page is the only
 * source (no JSON state, no JSON-LD, the RSS feed is gone). From Cloudflare
 * IPs a direct fetch is often 403; the fallback chain then serves the page
 * (Firecrawl / Bright Data). No render is needed: rows are server-rendered
 * li.s-card cards.
 *
 * _sop (sort), _udlo/_udhi (price), _ipg (page size), _pgn (page) and rt=nc
 * are applied by eBay. Everything after the "Results matching fewer words"
 * divider (srp-river-answer--REWRITE_START) is filler, not results.
 *
 * Order of sources (2026-11-23): the Browse feed first (browse.ts: free,
 * about 1 s, sellers located in the site's country at their own price),
 * then this search page (Cloudflare IPs are often refused; the paid page
 * sources then serve it), then a listing API (listing-api.ts).
 */

import { ListingMarket } from "../../providers/listing-types.js";
import type { Country, Currency, Language } from "../../services/common.js";
import type { Marketplace } from "../../services/shopping/marketplace.js";
import { ShoppingSort } from "../../services/shopping/schema.js";
import { blocks, looksBlocked, text } from "../readers/html.js";
import { count, plus } from "../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../types.js";
import { browseFeed } from "./browse.js";
import { ebayCard, ebayItemId, hiddenLabels, type EbayWords } from "./card.js";
import { ebayListingApi } from "./listing-api.js";

const PAGE_SIZE = 60;
const SORTS: Record<ShoppingSort, string> = {
  [ShoppingSort.Newest]: "10",
  [ShoppingSort.Relevance]: "12",
  [ShoppingSort.PriceLow]: "15",
  [ShoppingSort.PriceHigh]: "16",
  [ShoppingSort.EndingSoon]: "1",
};
/** Where the filler starts: "Results matching fewer words" and its translations. */
const FEWER_WORDS = /srp-river-answer--REWRITE_START/;
/** The "no exact matches" notice eBay shows above any filler. */
const NO_MATCHES = /srp-save-null-search|srp-river-answer--BASIC_MESSAGE/;
const CARD = /<li\b[^>]*class="s-card\b/;
const SELLER = /^(\S.{0,60}?)\s+\(?([\d.,]+)%\s*[^\d(]*\(([\d.,]+\s*[KkM]?)\)\)?$/;

interface EbayLocale {
  key: Marketplace;
  host: string;
  market: ListingMarket;
  country: Country;
  currency: Currency;
  language: Language;
  words: EbayWords;
}

const LOCALES: readonly EbayLocale[] = [
  {
    key: "ebay_us",
    host: "www.ebay.com",
    market: ListingMarket.EbayUs,
    country: "us",
    currency: "USD",
    language: "en",
    words: english(/^Located in (.+)$/i, /^United States$/i),
  },
  {
    key: "ebay_uk",
    host: "www.ebay.co.uk",
    market: ListingMarket.EbayGb,
    country: "gb",
    currency: "GBP",
    language: "en",
    words: english(/^(?:from|Located in) (.+)$/i, /^United Kingdom$/i),
  },
  {
    key: "ebay_de",
    host: "www.ebay.de",
    market: ListingMarket.EbayDe,
    country: "de",
    currency: "EUR",
    language: "de",
    words: {
      bids: /^(\d+)\s+Gebote?$/i,
      bestOffer: /Preisvorschlag/i,
      buyNow: /Sofort-Kaufen/i,
      freeShipping: /^(?:Kostenlose[rn]?\s+(?:Versand|Lieferung)|Versand kostenlos|Lieferung kostenlos)/i,
      location: /^(?:aus|Artikelstandort:?)\s+(\D{2,40})$/i,
      home: /^Deutschland$/i,
      listed: /^Eingestellt\b.*$/i,
      timeLeft: /^Noch\s.+$|^\d+\s*T\b.*$/i,
      seller: SELLER,
    },
  },
  {
    key: "ebay_fr",
    host: "www.ebay.fr",
    market: ListingMarket.EbayFr,
    country: "fr",
    currency: "EUR",
    language: "fr",
    words: {
      bids: /^(\d+)\s+enchères?$/i,
      bestOffer: /Offre directe|Faire une offre/i,
      buyNow: /Achat immédiat/i,
      freeShipping: /^Livraison gratuite/i,
      location: /^(?:de|Provenance\s*:|Lieu où se trouve l'objet\s*:)\s*(\D{2,40})$/i,
      home: /^France$/i,
      listed: /^(?:Mis en vente|Nouvelle annonce|Publié)\b.*$/i,
      timeLeft: /^Il reste\s.+$|^\d+\s*j\b.*restant.*$/i,
      seller: SELLER,
    },
  },
  {
    key: "ebay_it",
    host: "www.ebay.it",
    market: ListingMarket.EbayIt,
    country: "it",
    currency: "EUR",
    language: "it",
    words: {
      bids: /^(\d+)\s+offert[ae]$/i,
      bestOffer: /Proposta d'acquisto|Proponi prezzo/i,
      buyNow: /Compralo Subito/i,
      freeShipping: /^Spedizione gratuita/i,
      location: /^(?:da|Oggetto che si trova a:?)\s+(\D{2,40})$/i,
      home: /^Italia$/i,
      listed: /^(?:Messo in vendita|Inserito)\b.*$/i,
      timeLeft: /^(?:Tempo rimanente|Mancano)\s.+$|^\d+\s*g\b.*$/i,
      seller: SELLER,
    },
  },
  {
    key: "ebay_es",
    host: "www.ebay.es",
    market: ListingMarket.EbayEs,
    country: "es",
    currency: "EUR",
    language: "es",
    words: {
      bids: /^(\d+)\s+pujas?$/i,
      bestOffer: /Mejor oferta|Oferta directa/i,
      buyNow: /Cómpralo ya/i,
      freeShipping: /^Envío gratis/i,
      location: /^(?:de|desde|Ubicado en:?)\s+(\D{2,40})$/i,
      home: /^España$/i,
      listed: /^(?:Publicado|Anunciado)\b.*$/i,
      timeLeft: /^Quedan?\s.+$|^\d+\s*d\b.*$/i,
      seller: SELLER,
    },
  },
];

function english(location: RegExp, home: RegExp): EbayWords {
  return {
    home,
    bids: /^(\d+)\s+bids?$/i,
    bestOffer: /or Best Offer/i,
    buyNow: /^Buy It Now$/i,
    freeShipping: /^Free (?:delivery|shipping)\b/i,
    location,
    listed: /^Listed\b.*$/i,
    timeLeft: /^\d+[dhm]( \d+[hms])? left\b.*$/i,
    seller: SELLER,
  };
}

/** The stated result count ("2,341 results", "1.234 Ergebnisse"), if any. */
function totalOf(html: string): number | undefined {
  const at = html.search(/srp-controls__count-heading/);
  return at < 0 ? undefined : count(text(html.slice(at, at + 400).replace(/^[^>]*>/, ""))?.split(" ")[0]);
}

function readSearch(html: string, host: string, words: EbayWords): ReturnType<ShoppingSite["read"]> {
  if (looksBlocked(html) || /\/splashui\/challenge|<title>[^<]*Security Measure/i.test(html)) return { kind: "failed", failure: "blocked", detail: "eBay challenge page" };
  const start = html.search(/class="?srp-results[\s"]/);
  if (start < 0) {
    if (NO_MATCHES.test(html)) return { kind: "empty" };
    return { kind: "failed", failure: "redesigned", detail: "no srp-results list" };
  }
  // The divider can sit above the list (every row is filler) or inside it.
  const fewer = html.search(FEWER_WORDS);
  const river = html.slice(start, fewer < 0 ? html.length : Math.max(start, fewer));
  const labels = hiddenLabels(html);
  const rows = blocks(river, CARD, 300)
    .map((card) => ebayCard(card, host, words, labels))
    .filter((r): r is RawListing => r !== undefined && !!r.title);
  if (rows.length === 0) {
    if (fewer >= 0 || NO_MATCHES.test(html)) return { kind: "empty" };
    return { kind: "failed", failure: "redesigned", detail: "srp-results without s-card rows" };
  }
  const hasMore = /<a\b[^>]*class="?pagination__next\b(?![^>]*aria-disabled="?true)/.test(html);
  return { kind: "results", rows, total: totalOf(html), hasMore };
}

function site(l: EbayLocale): ShoppingSite {
  return {
    key: l.key,
    host: l.host,
    country: l.country,
    currency: l.currency,
    language: l.language,
    kind: SiteKind.Marketplace,
    listingId: ebayItemId,
    // One item number is one listing on every eBay site, priced for each site's buyers.
    listingPool: "ebay",
    search(sq) {
      const price = `${sq.minPrice !== undefined ? `&_udlo=${sq.minPrice}` : ""}${sq.maxPrice !== undefined ? `&_udhi=${sq.maxPrice}` : ""}`;
      return {
        url: `https://${l.host}/sch/i.html?_nkw=${plus(sq.query)}&_sop=${SORTS[sq.sort]}${price}&_ipg=${PAGE_SIZE}&_pgn=${sq.page}&rt=nc`,
        applies: { sort: true, minPrice: true, maxPrice: true },
      };
    },
    read: (page) => readSearch(page.content, l.host, l.words),
    feed: browseFeed({ host: l.host, country: l.country, currency: l.currency }),
    api: ebayListingApi(l.market, l.host, l.words.freeShipping),
  };
}

export const ebaySiteList: readonly ShoppingSite[] = LOCALES.map(site);
