/**
 * Every kind of entry mcpy caches, with its version. This table is the whole
 * inventory: a key is `v<version>:<name>:<id>` (`v2:page:markdown:default:<hash>`),
 * so a key read off a log says what it holds and which code wrote it.
 *
 * Bump a space's version when what it stores changes shape or meaning: entries
 * written under the old version are then never read again, and expire.
 */
import { z } from "zod";
import { enumOf } from "../enums.js";

const cacheName = enumOf({
  /** A fetched page, as fetched (scripts run on it afterwards). */
  Page: "page",
  /** One exact copy of a page read in parts, under its version. */
  Pin: "pin",
  Search: "search",
  Papers: "papers",
  /** A marketplace's results from listing APIs. */
  Listings: "listings",
  /** A crypto_market answer. */
  CryptoMarket: "crypto:market",
  /** A crypto_coin answer. */
  CryptoCoin: "crypto:coin",
  /** A whole-table crypto source's table, shared by every call. */
  CryptoTable: "crypto:table",
  /** The page provider that last served a site. */
  SiteRoute: "route",
  /** A site whose paid page sources all just failed. */
  PaidFailure: "paid-failed",
} as const);
export const CacheName = cacheName.values;
export const CacheNameSchema = cacheName.schema;
export type CacheName = z.infer<typeof CacheNameSchema>;

/** The version of each space. Page, search, papers, listings and crypto kept the versions their keys always had. */
export const CACHE_VERSIONS: Readonly<Record<CacheName, number>> = {
  [CacheName.Page]: 2,
  [CacheName.Pin]: 1,
  [CacheName.Search]: 2,
  [CacheName.Papers]: 2,
  [CacheName.Listings]: 2,
  [CacheName.CryptoMarket]: 3,
  [CacheName.CryptoCoin]: 3,
  [CacheName.CryptoTable]: 1,
  [CacheName.SiteRoute]: 1,
  [CacheName.PaidFailure]: 1,
};

/**
 * A space's handle: its name, its version and the schema every value read
 * back must pass (one that fails is reported `invalid` and missed). The
 * schema is required: nothing comes out of the cache unchecked.
 */
export interface CacheSpace<T> {
  readonly name: CacheName;
  readonly version: number;
  readonly schema: z.ZodType<T>;
}

export function cacheSpace<T>(name: CacheName, schema: z.ZodType<T>): CacheSpace<T> {
  return { name, version: CACHE_VERSIONS[name], schema };
}

/** The key of entry `id` in `space`. */
export function cacheKey(space: CacheSpace<unknown>, id: string): string {
  return `v${space.version}:${space.name}:${id}`;
}

/**
 * A schema that checks the fields a value cannot do without and keeps every
 * other field as stored. For values typed by interfaces rather than schemas
 * (search hits, papers, listings, crypto sources): an entry missing one of
 * these fields is invalid, and an optional field added later is never dropped.
 */
export function requiredFields<T>(shape: z.ZodRawShape): z.ZodType<T> {
  return z.looseObject(shape) as unknown as z.ZodType<T>;
}
