/**
 * MercadoLibre / MercadoLivre, one site per country. Probed 2026-11-22.
 *  - Plain fetch (Cloudflare IPs, any user agent): the listing host
 *    (lista.mercadolivre.com.br/<q>, listado.mercadolibre.com.ar|.mx/<q>)
 *    redirects to www.<site>/gz/account-verification ("acesse sua conta"),
 *    a 200 login wall; from a residential IP it 302s to /captcha/wall.
 *    Firecrawl (chrome-cdp) failed outright.
 *  - The public API api.mercadolibre.com/sites/MLB/search?q= (and MLA) is
 *    closed: 403 {"message":"forbidden"} without an OAuth token, from every
 *    source.
 *  - Bright Data Web Unlocker serves the real search page (no render): the
 *    state assigned to _n.ctx.r holds the rows (see meli-cards.ts), 48 a
 *    page. Because the plain fetch "succeeds" with a 200 wall on another
 *    host, the engine does not escalate to Bright Data today and the service
 *    reports `redirected`; read() calls the wall `blocked`.
 * URL grammar, taken from the page's own sort and price links:
 * _OrderId_PRICE / _OrderId_PRICE*DESC, _PriceRange_<from>BRL-<to>BRL (0 =
 * open), _Desde_<first row>, _NoIndex_True. There is no newest-first sort.
 * The price range could not be checked against live rows (Bright Data then
 * answered 402), so `applies` claims only the sort.
 */

import type { Country, Currency, Language } from "../../services/common.js";
import type { Marketplace } from "../../services/shopping/marketplace.js";
import { looksBlocked } from "../readers/html.js";
import { dash } from "../readers/values.js";
import { ShoppingSort } from "../../services/shopping/schema.js";
import { SiteKind, type RawListing, type ReadOutcome, type ShoppingSite, type SitePage } from "../types.js";
import { meliRow, meliState } from "./meli-cards.js";

const PAGE_SIZE = 48;
const WALL = /\/gz\/account-verification|\/captcha\/wall|acesse sua conta|ingresa a tu cuenta|account-verification/i;

interface MeliCountry {
  key: Marketplace;
  /** e.g. mercadolivre.com.br */
  domain: string;
  /** The search host's first label: lista (Brazil) or listado. */
  list: string;
  /** The item host's first label: produto (Brazil) or articulo. */
  item: string;
  country: Country;
  currency: Currency;
  language: Language;
}

const COUNTRIES: readonly MeliCountry[] = [
  { key: "mercadolivre_br", domain: "mercadolivre.com.br", list: "lista", item: "produto", country: "br", currency: "BRL", language: "pt" },
  { key: "mercadolibre_ar", domain: "mercadolibre.com.ar", list: "listado", item: "articulo", country: "ar", currency: "ARS", language: "es" },
  { key: "mercadolibre_mx", domain: "mercadolibre.com.mx", list: "listado", item: "articulo", country: "mx", currency: "MXN", language: "es" },
  { key: "mercadolibre_cl", domain: "mercadolibre.cl", list: "listado", item: "articulo", country: "cl", currency: "CLP", language: "es" },
  { key: "mercadolibre_co", domain: "mercadolibre.com.co", list: "listado", item: "articulo", country: "co", currency: "COP", language: "es" },
];

const SORTS: Partial<Record<ShoppingSort, string>> = { [ShoppingSort.PriceLow]: "_OrderId_PRICE", [ShoppingSort.PriceHigh]: "_OrderId_PRICE*DESC" };

export function readMeli(page: SitePage, itemHost: string): ReadOutcome {
  const wall = { kind: "failed", failure: "blocked", detail: "MercadoLibre account verification / captcha wall" } as const;
  if (WALL.test(page.finalUrl) || looksBlocked(page.content)) return wall;
  const state = meliState(page.content);
  if (!state) return WALL.test(page.content) ? wall : { kind: "failed", failure: "redesigned", detail: "no search results in _n.ctx.r" };
  if (state.results.length === 0) return { kind: "empty" };
  const rows = state.results.map((r) => meliRow(r, itemHost, state.pictureTemplate)).filter((r): r is RawListing => r !== undefined);
  return { kind: "results", rows, total: state.total, hasMore: state.hasMore };
}

function site(c: MeliCountry): ShoppingSite {
  return {
    key: c.key,
    host: `${c.list}.${c.domain}`,
    listingHosts: [`produto.${c.domain}`, `articulo.${c.domain}`, `www.${c.domain}`],
    country: c.country,
    currency: c.currency,
    language: c.language,
    kind: SiteKind.Marketplace,
    listingId: (url) => /\/(?:p\/)?(ML[A-Z]-?\d{6,13})\b/.exec(url.pathname)?.[1]?.replace("-", ""),
    search(sq) {
      const sort = SORTS[sq.sort] ?? "";
      const from = sq.minPrice !== undefined ? `${Math.floor(sq.minPrice)}${c.currency}` : `0${c.currency}`;
      const to = sq.maxPrice !== undefined ? `${Math.ceil(sq.maxPrice)}${c.currency}` : `0${c.currency}`;
      const price = sq.minPrice !== undefined || sq.maxPrice !== undefined ? `_PriceRange_${from}-${to}` : "";
      const page = sq.page > 1 ? `_Desde_${(sq.page - 1) * PAGE_SIZE + 1}` : "";
      return {
        url: `https://${c.list}.${c.domain}/${dash(sq.query)}${sort}${price}${page}_NoIndex_True`,
        applies: { sort: sort !== "" || sq.sort === ShoppingSort.Relevance },
      };
    },
    read: (page) => readMeli(page, `${c.item}.${c.domain}`),
  };
}

export const mercadoLibreSites: readonly ShoppingSite[] = COUNTRIES.map(site);
