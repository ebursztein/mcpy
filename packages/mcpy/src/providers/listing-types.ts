/**
 * Contract for listing sources: APIs that return a marketplace's search
 * results as records instead of a page (e.g. an eBay search API). The
 * shopping service uses one only when every page source failed for a site
 * that declares an `api` read (sites/types.ts), so the site's own page
 * reader stays the main path.
 */

import { z } from "zod";
import { enumOf } from "../enums.js";
import type { ProviderCall } from "./types.js";

/** A marketplace as the marketplace itself names it: eBay's own marketplace ids. */
const listingMarket = enumOf({
  EbayUs: "EBAY_US",
  EbayGb: "EBAY_GB",
  EbayDe: "EBAY_DE",
  EbayFr: "EBAY_FR",
  EbayIt: "EBAY_IT",
  EbayEs: "EBAY_ES",
  EbayAu: "EBAY_AU",
  EbayCa: "EBAY_CA",
  EbayNl: "EBAY_NL",
  EbayPl: "EBAY_PL",
} as const);
export const ListingMarket = listingMarket.values;
export const ListingMarketSchema = listingMarket.schema;
export type ListingMarket = z.infer<typeof ListingMarketSchema>;

const listingSort = enumOf({ BestMatch: "best_match", PriceLow: "price_low", PriceHigh: "price_high", Newest: "newest", EndingSoon: "ending_soon" } as const);
export const ListingSort = listingSort.values;
export const ListingSortSchema = listingSort.schema;
export type ListingSort = z.infer<typeof ListingSortSchema>;

export interface ListingRequest {
  market: ListingMarket;
  query: string;
  sort: ListingSort;
  /** In the market's currency. */
  minPrice?: number;
  maxPrice?: number;
  /** 1-based result page. */
  page: number;
}

/** One listing as the source reports it. Loose: the site reads it and normalize() validates every field. */
export interface FoundListing {
  url: string;
  id?: string;
  title?: string;
  price?: { amount: number; currency: string };
  /** The marketplace's own condition label ("Pre-Owned", "Neu"). */
  condition?: string;
  /** The marketplace's own shipping text ("+$4.64 delivery", "Free delivery"). */
  shipping?: string;
  seller?: string;
  images: string[];
}

export interface ListingPage {
  rows: FoundListing[];
  hasMore: boolean;
  total?: number;
}

export interface ListingProvider {
  readonly id: string;
  readonly costPerCall: number;
  /** Markets this source can search. */
  readonly markets: readonly ListingMarket[];
  readonly circuitBreaker?: boolean;
  readonly attemptTimeoutMs?: number;
  searchListings(req: ListingRequest, call: ProviderCall): Promise<ListingPage>;
}
