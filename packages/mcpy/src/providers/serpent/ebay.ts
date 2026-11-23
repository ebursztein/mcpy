/**
 * Serpent's eBay search API (/api/ebay/search): active listings on ten eBay
 * markets, one page of up to 60 rows per call, $0.40 per 1,000 calls on the
 * default tier. Checked live 2026-11-23, 5 calls: 2 answered (EBAY_US
 * plain, 60 rows in 31 s; EBAY_DE with a 50 EUR floor and newest sort, 60
 * rows in 40 s, all >= 50), 3 failed at Serpent's own 45 s budget
 * (`request_failed`, refunded). Rows carry no bids, format, location or
 * seller, so the eBay sites use this only when every page source failed.
 */

import { ErrorCode } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { HttpMethod, type HttpResponse } from "../../http/client.js";
import { ListingMarket, ListingSort, type FoundListing, type ListingPage, type ListingProvider, type ListingRequest } from "../listing-types.js";
import { ProviderId } from "../types.js";
import { EbaySearchResponseSchema, type EbaySearchResponse } from "./schemas.js";

export interface SerpentListingsOptions {
  apiKey: string;
  /** Base URL (default https://apiserpent.com). */
  apiUrl?: string;
  /** USD per call on your tier (default: the Default tier, $0.40 per 1,000 eBay calls). */
  costPerCall?: number;
}

/** Default tier: $0.40 per 1,000 standard eBay calls (apiserpent.com/docs, 2026-11-23). */
export const SERPENT_EBAY_USD_PER_CALL = 0.0004;

const DEFAULT_API = "https://apiserpent.com";
/** The API pages 1-20. */
const MAX_PAGE = 20;

const SORT: Record<ListingSort, string> = {
  [ListingSort.BestMatch]: "best_match",
  [ListingSort.PriceLow]: "price_asc",
  [ListingSort.PriceHigh]: "price_desc",
  [ListingSort.Newest]: "newly_listed",
  [ListingSort.EndingSoon]: "ending_soon",
};

/** Amounts take at most two decimals; a bound is rounded outward so no listing inside it is lost. */
const floorCents = (n: number) => (Math.floor(n * 100) / 100).toString();
const ceilCents = (n: number) => (Math.ceil(n * 100) / 100).toString();

function params(req: ListingRequest): URLSearchParams {
  const p = new URLSearchParams({ q: req.query, marketplace_id: req.market, page: String(req.page), sort: SORT[req.sort] });
  if (req.minPrice !== undefined) p.set("min_price", floorCents(req.minPrice));
  if (req.maxPrice !== undefined) p.set("max_price", ceilCents(req.maxPrice));
  return p;
}

function check(response: HttpResponse, body: EbaySearchResponse): void {
  if (response.status >= 400 || !body.success) {
    throw new ProviderFailure(ErrorCode.UpstreamFailed, `${body.code ?? `HTTP ${response.status}`}: ${body.message ?? "request failed"}`, response.status);
  }
}

const sellerName = (s: NonNullable<EbaySearchResponse["results"]>[number]["seller"]): string | undefined =>
  typeof s === "string" ? s : (s?.username ?? s?.name ?? undefined);

function rows(body: EbaySearchResponse): FoundListing[] {
  return (body.results ?? []).flatMap((r) => {
    if (typeof r.url !== "string" || !/^https:\/\//i.test(r.url)) return [];
    return [
      {
        url: r.url,
        id: r.item_id == null ? undefined : String(r.item_id),
        title: r.title ?? undefined,
        price: r.price ? { amount: r.price.value, currency: r.price.currency } : undefined,
        condition: r.condition ?? undefined,
        shipping: r.shipping ?? undefined,
        seller: sellerName(r.seller),
        images: (r.images ?? []).filter((i) => /^https:\/\//i.test(i)),
      },
    ];
  });
}

/** Serpent eBay search as a listing source. */
export function serpentListings(options: SerpentListingsOptions): ListingProvider {
  const base = (options.apiUrl ?? DEFAULT_API).replace(/\/+$/, "");
  return {
    id: ProviderId.Serpent,
    costPerCall: options.costPerCall ?? SERPENT_EBAY_USD_PER_CALL,
    markets: Object.values(ListingMarket),
    // Measured live: 30-45 s per call. Serpent stops at 45 s and answers a
    // refunded error; waiting a little longer gets that answer, not our timeout.
    attemptTimeoutMs: 50_000,
    async searchListings(req, call): Promise<ListingPage> {
      if (req.page > MAX_PAGE) return { rows: [], hasMore: false };
      const { response, data } = await call.http.json(
        { url: `${base}/api/ebay/search?${params(req).toString()}`, method: HttpMethod.Get, headers: { "X-API-Key": options.apiKey } },
        EbaySearchResponseSchema,
        call.context,
      );
      check(response, data);
      if (!data.results) throw new ProviderFailure(ErrorCode.BadResponse, "eBay search succeeded without results", response.status);
      return { rows: rows(data), hasMore: !!data.next_page_url && req.page < MAX_PAGE, ...(data.total_results != null ? { total: data.total_results } : {}) };
    },
  };
}
