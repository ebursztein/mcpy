/**
 * The contract every shopping site implements. A site knows its own URLs,
 * filters and page shapes; it never fetches. The shopping service fetches
 * through the engine (cache, fallback chain, render) and hands the page back.
 *
 *   service -> site.search() -> engine.page() -> site.read() -> normalize()
 *
 * Sites whose result rows are products (card marketplaces, shops with a page
 * per card) return `products`; the service opens up to max_products of them
 * with site.product and every seller's offer becomes a listing.
 */

import type { HttpMethod, PageFormat } from "../enums.js";
import type { ListingPage, ListingRequest } from "../providers/listing-types.js";
import type { Country, Currency, Language, SiteFailure } from "../services/common.js";
import type { Marketplace } from "../services/shopping/marketplace.js";
import type { CardCondition, Condition, Facets, Game, ListingFormat, ListingStatus, ShoppingSort } from "../services/shopping/schema.js";

/** What a site is asked for, already validated. */
export interface SiteQuery {
  query: string;
  sort: ShoppingSort;
  minPrice?: number;
  maxPrice?: number;
  /** 1-based result page. */
  page: number;
  /** The site's own next-page token from the previous call, for sites that page by cursor. */
  cursor?: string;
  /** Trading-card game asked for; unset: the site's first game. */
  game?: Game;
  /**
   * The listing filters, for a site that can apply them on its side. A site
   * claims each one it applied in SiteRequest.applies; mcpy filters the rest
   * on the rows, or reports them ignored.
   */
  condition?: readonly Condition[];
  format?: readonly ListingFormat[];
  language?: readonly Language[];
  sellerCountry?: readonly Country[];
  seller?: string;
  category?: string;
  attributes?: Readonly<Record<string, readonly string[]>>;
  /** Ask the site for its categories and item specifics with counts. */
  facets?: boolean;
}

/** Parts of a query a request applies on the site's side. Unset: not applied. */
export interface Applied {
  sort?: boolean;
  minPrice?: boolean;
  maxPrice?: boolean;
  game?: boolean;
  condition?: boolean;
  format?: boolean;
  language?: boolean;
  sellerCountry?: boolean;
  seller?: boolean;
  category?: boolean;
  attributes?: boolean;
}

/** One page fetch the site wants, and which requested parts its URL applies. */
export interface SiteRequest {
  url: string;
  /** Default html: the raw body (JSON APIs come back as their JSON text). */
  format?: PageFormat;
  render?: boolean;
  waitMs?: number;
  method?: HttpMethod;
  body?: string;
  headers?: Record<string, string>;
  /** Fetch as a visitor from this country, for sites that localize prices by IP (a hint to render providers). */
  country?: Country;
  /** Parts of the query this request applies on the site's side. */
  applies?: Applied;
}

/** The fetched page as a site sees it. */
export interface SitePage {
  url: string;
  finalUrl: string;
  status: number;
  content: string;
}

/** A row as the page states it. Loose on purpose: normalize() validates every field. */
export interface RawListing {
  url?: string | null;
  id?: string | null;
  title?: string | null;
  titleOriginal?: string | null;
  description?: string | null;
  price?: number | string | null;
  currency?: string | null;
  format?: ListingFormat | null;
  bids?: number | string | null;
  endsAt?: string | number | null;
  buyNow?: number | string | null;
  shipping?: number | string | null;
  shippingCurrency?: string | null;
  condition?: Condition | null;
  cardCondition?: CardCondition | null;
  language?: Language | string | null;
  quantity?: number | string | null;
  product?: { id: string; url: string; title?: string } | null;
  status?: ListingStatus | null;
  postedAt?: string | number | null;
  postedText?: string | null;
  location?: string | null;
  country?: Country | string | null;
  seller?: string | null;
  sellerFeedbackCount?: number | string | null;
  sellerFeedbackPercent?: number | string | null;
  promoted?: boolean | null;
  /** The site showed a listing from abroad in its own currency or with its own taxes. */
  priceConverted?: boolean | null;
  image?: string | null;
  /** Item pages only: every photo. */
  images?: string[];
  details?: Record<string, string | number | boolean | null | undefined>;
}

/** A product page to open for its offers. */
export interface ProductLink {
  id: string;
  url: string;
  title?: string;
}

export type ReadOutcome =
  | { kind: "results"; rows: RawListing[]; total?: number; products?: ProductLink[]; hasMore?: boolean; nextCursor?: string; facets?: Facets }
  | { kind: "empty" }
  | { kind: "failed"; failure: SiteFailure; detail: string };

export const SiteKind = { Marketplace: "marketplace", Classifieds: "classifieds", Auction: "auction", Shop: "shop" } as const;
export type SiteKind = (typeof SiteKind)[keyof typeof SiteKind];

export interface ShoppingSite {
  key: Marketplace;
  /** The host search pages are served from. */
  host: string;
  /** Hosts whose listing URLs belong to this site (category subdomains, a mirror's original). Default: host. */
  listingHosts?: readonly string[] | RegExp;
  country: Country;
  currency: Currency;
  language: Language;
  kind: SiteKind;
  /** Listing id from a listing URL on a listing host; rows without one are not listings. */
  listingId(url: URL): string | undefined;
  /** HTTP statuses that mean "no results" when the page is still the site's result page. */
  emptyStatuses?: readonly number[];
  /** Card sites: the games it sells, main one first. A request for another game is reported unsupported, not searched. */
  games?: readonly Game[];
  /**
   * Sites that show the same listings under the same ids (eBay's country
   * sites) name one pool: a call returns each listing once, from its home site.
   */
  listingPool?: string;
  /** The site matches a query loosely (any word, the description, n-grams): title_match auto filters its rows. */
  matchesLoosely?: boolean;
  /** The site pages with its own token (ReadOutcome.nextCursor, SiteQuery.cursor) instead of page numbers. */
  pagesByCursor?: boolean;
  search(q: SiteQuery): SiteRequest;
  read(page: SitePage, q: SiteQuery): ReadOutcome;
  /**
   * A source tried before the search page, when it is free and fuller (eBay:
   * its Browse API). When it fails for any reason the search page is read as
   * usual; an empty answer stands.
   */
  feed?: { search(q: SiteQuery): SiteRequest; read(page: SitePage, q: SiteQuery): ReadOutcome };
  /** Sites whose search rows are products: how to read a product page's offers. */
  product?: { request(link: ProductLink): SiteRequest; read(page: SitePage, link: ProductLink): ReadOutcome };
  /**
   * One follow-up request that fills in fields the search rows lack (e.g.
   * Catawiki's bids and end times come from a second API). Rows keep their
   * order; enrich returns the same rows with fields added. A failed follow-up
   * leaves the rows as they were.
   */
  enrich?: { request(rows: RawListing[]): SiteRequest | undefined; read(page: SitePage, rows: RawListing[]): RawListing[] };
  /**
   * A marketplace listing API that can stand in for the search page when no
   * page source could fetch it (blocked, timed out). Its rows are thinner
   * than the page's, so it is only the last resort.
   */
  api?: { request(q: SiteQuery): { listing: ListingRequest; applies: NonNullable<SiteRequest["applies"]> }; read(page: ListingPage): ReadOutcome };
  /** How the item page reads, for shopping_item; default: JSON-LD Product. */
  item?: { request(url: string): SiteRequest; read(page: SitePage): ReadOutcome };
}
