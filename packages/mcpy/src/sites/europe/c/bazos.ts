/**
 * Bazoš (bazos.cz, bazos.sk): one platform, two countries. Probed 2026-11-22
 * through tools.ly.tl: a plain fetch serves /search.php with server-rendered
 * cards (div.inzeraty), 40 a page (crz = offset). There is no JSON or JSON-LD
 * on the page. The default order is newest first; order=1 is price
 * ascending, order=2 descending. cenaod/cenado are applied by the site
 * (checked: every row >= the floor, unpriced rows dropped). Listings live on
 * category subdomains (deti.bazos.cz, pc.bazos.sk...). A search without
 * results is HTTP 200 with "Žádný inzerát nenalezen" / "Hľadaniu nevyhovujú
 * žiadne inzeráty".
 */

import type { Country, Currency, Language } from "../../../services/common.js";
import type { Marketplace } from "../../../services/shopping/marketplace.js";
import { ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../../readers/html.js";
import { amount, plus, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";
import { cetTime, dottedDate } from "./cet.js";

const PAGE_SIZE = 40;
const ORDERS: Partial<Record<string, string>> = { [ShoppingSort.PriceLow]: "1", [ShoppingSort.PriceHigh]: "2" };

interface BazosSettings {
  key: Marketplace;
  domain: "bazos.cz" | "bazos.sk";
  country: Country;
  currency: Currency;
  language: Language;
  /** The site's own "no results" sentence. */
  empty: RegExp;
  /** Price words that state no amount, and the one that invites offers. */
  offer: RegExp;
  /** Buyer posts start with these words. */
  wanted: RegExp;
}

function row(card: string, s: BazosSettings): RawListing | undefined {
  const link = attr(first(card, /<h2 class=["']?nadpis["']?>([\s\S]*?)<\/h2>/i) ?? "", "href") ?? attr(card, "href");
  const title = text(first(card, /<h2 class=["']?nadpis["']?>([\s\S]*?)<\/h2>/i));
  if (!link || !title) return undefined;
  const priceText = text(first(card, /class="inzeratycena"[^>]*>([\s\S]*?)<\/div>/i));
  const meta = text(first(card, /class=["']?velikost10["']?>([\s\S]*?)<br/i));
  const day = dottedDate(first(meta, /\[([^\]]+)\]/));
  const location = text(first(card, /class="inzeratylok"[^>]*>([\s\S]*?)<\/div>/i)?.replace(/<br\s*\/?>/gi, " "));
  const views = text(first(card, /class="inzeratyview"[^>]*>([\s\S]*?)<\/div>/i));
  const priced = amount(priceText);
  return {
    url: link,
    title,
    description: text(first(card, /class=["']?popis["']?>([\s\S]*?)<\/div>/i)),
    price: priced,
    currency: priced !== undefined ? s.currency : undefined,
    format: s.wanted.test(title) ? ListingFormat.Wanted : priced !== undefined ? ListingFormat.FixedPrice : priceText && s.offer.test(priceText) ? ListingFormat.BestOffer : undefined,
    postedAt: day ? cetTime(day) : undefined,
    location,
    country: s.country,
    promoted: /class="ztop"/.test(card),
    image: attr(card.match(/<img[^>]*class="obrazek"[^>]*>/i)?.[0], "src"),
    details: { Price: priced === undefined ? str(priceText) : undefined, Views: str(views?.replace(/\s*x$/, "")) },
  };
}

function bazos(s: BazosSettings): ShoppingSite {
  const host = `www.${s.domain}`;
  const sub = new RegExp(`^[a-z]+\\.${s.domain.replace(".", "\\.")}$`);
  return {
    key: s.key,
    host,
    listingHosts: sub,
    country: s.country,
    currency: s.currency,
    language: s.language,
    kind: SiteKind.Classifieds,
    listingId: (url) => /^\/inzerat\/(\d+)\//.exec(url.pathname)?.[1],
    search(sq) {
      const order = ORDERS[sq.sort] ?? "";
      const min = sq.minPrice !== undefined ? String(Math.floor(sq.minPrice)) : "";
      const max = sq.maxPrice !== undefined ? String(Math.ceil(sq.maxPrice)) : "";
      const offset = (sq.page - 1) * PAGE_SIZE;
      return {
        url: `https://${host}/search.php?hledat=${plus(sq.query)}&rubriky=www&hlokalita=&humkreis=25&cenaod=${min}&cenado=${max}&order=${order}${offset ? `&crz=${offset}` : ""}`,
        // Bazoš has no relevance order: its default is newest first.
        applies: { sort: sq.sort !== ShoppingSort.EndingSoon && sq.sort !== ShoppingSort.Relevance, minPrice: true, maxPrice: true },
      };
    },
    read(page) {
      if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
      const cards = blocks(page.content, /<div class="inzeraty inzeratyflex">/);
      if (cards.length === 0) {
        if (s.empty.test(page.content)) return { kind: "empty" };
        return { kind: "failed", failure: "redesigned", detail: "no div.inzeraty cards and no empty-result notice" };
      }
      const rows = cards.map((c) => row(c, s)).filter((r): r is RawListing => r !== undefined);
      // "Zobrazeno 1-40 inzerátů z 1 703" / "Zobrazených 1-40 inzerátov z 1 631"
      const shown = /Zobrazen\S*\s+\d+-(\d+)\s+\S+\s+z\s+(\d[\d\s]*)</.exec(page.content);
      const total = shown ? Number(shown[2]!.replace(/\s/g, "")) : undefined;
      return { kind: "results", rows, total, hasMore: shown ? Number(shown[1]) < total! : cards.length === PAGE_SIZE };
    },
  };
}

export const bazosCz = bazos({
  key: "bazos_cz",
  domain: "bazos.cz",
  country: "cz",
  currency: "CZK",
  language: "cs",
  empty: /Žádný inzerát nenalezen/,
  offer: /Nabídněte/i,
  wanted: /^\s*(koupím|koupim|sháním|shanim|poptávám)\b/i,
});

export const bazosSk = bazos({
  key: "bazos_sk",
  domain: "bazos.sk",
  country: "sk",
  currency: "EUR",
  language: "sk",
  empty: /Hľadaniu nevyhovujú žiadne inzeráty/,
  offer: /Ponúknite/i,
  wanted: /^\s*(kúpim|kupim|hľadám|hladam|zháňam)\b/i,
});
