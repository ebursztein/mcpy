/**
 * shopping_search: service -> site -> engine (fetcher, cache) -> site reader
 * -> normalize. Sites run in parallel (a few at a time); each reports ok,
 * empty, unsupported, over_budget or failed with its reason, and a failed
 * site never fails the call. Paging is per site (see paging.ts).
 */

import { CacheStatus, ErrorCode } from "../../enums.js";
import { McpyError } from "../../errors.js";
import type { CallScope, Engine, Served } from "../../engine/engine.js";
import { normalize, onSiteHost } from "../../sites/normalize.js";
import { SITES } from "../../sites/registry.js";
import type { ProductLink, RawListing, ShoppingSite, SiteQuery } from "../../sites/types.js";
import { RequestPart, SiteStatus } from "../common.js";
import { fetchAndRead, fetchFromApi, type SiteFetch } from "./fetch-site.js";
import { applyFilters, interleave } from "./filters.js";
import type { Marketplace } from "./marketplace.js";
import { advance, encodeCursor, positionsOf, type Positions, type SitePosition, type SiteProgress } from "./paging.js";
import { ShoppingSearchResultSchema, type Listing, type MarketplaceReport, type ShoppingSearchQuery, type ShoppingSearchResult } from "./schema.js";

/** Sites fetched at once, and product pages opened in one call across all sites: bounds cost and Worker subrequests. */
const SITE_CONCURRENCY = 4;
const MAX_PRODUCT_PAGES_PER_CALL = 20;
/** Whole-call deadline: a site still working then is reported as timed out and keeps its place for the next call. */
const OPERATION_DEADLINE_MS = 90_000;
/** Continuation calls read the cached copy of the page they continue, so row and product offsets still point at the same rows. */
const CONTINUATION_MAX_AGE_SECONDS = 3_600;

export type Op<R> = Promise<{ result: R; served: Served<unknown>; outputChars: number }>;

interface SiteResult {
  key: Marketplace;
  rows: Listing[];
  report: MarketplaceReport;
  progress: Omit<SiteProgress, "returned">;
  served: Served<unknown>[];
}

/** Up to `size` at once, the next one starting as soon as one finishes. */
async function pool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

async function readOffers(engine: Engine, site: ShoppingSite, links: ProductLink[], input: ShoppingSearchQuery, scope: CallScope) {
  const reader = site.product!;
  // A product link off the site is not opened.
  const onSite = links.filter((l) => {
    try {
      return onSiteHost(site, new URL(l.url).hostname);
    } catch {
      return false;
    }
  });
  return pool(onSite, 3, async (link) => ({ link, got: await fetchAndRead(engine, site, reader.request(link), (p) => reader.read(p, link), scope, input.max_age) }));
}

function siteQuery(input: ShoppingSearchQuery, at: SitePosition): SiteQuery {
  return { query: input.query, sort: input.sort, minPrice: input.min_price, maxPrice: input.max_price, page: at.p, cursor: at.c, game: input.game };
}

/** Where a failed site goes: kept for a retry only when it was already past its first page (one rule for every failure). */
function failed(key: Marketplace, at: SitePosition, report: MarketplaceReport, served: Served<unknown>[], transient: boolean): SiteResult {
  return transient && (at.p > 1 || at.o > 0 || at.x > 0 || at.c) ? retryLater(key, at, report, served) : stopped(key, at, report, served);
}

/** The site's price bounds are whole units in most URLs: a fractional bound is applied by mcpy instead. */
function honestApplies(req: ReturnType<ShoppingSite["search"]>, sq: SiteQuery) {
  const applies = { ...req.applies };
  if (sq.minPrice !== undefined && !Number.isInteger(sq.minPrice)) applies.minPrice = false;
  if (sq.maxPrice !== undefined && !Number.isInteger(sq.maxPrice)) applies.maxPrice = false;
  return { ...req, applies };
}

function stopped(key: Marketplace, at: SitePosition, report: MarketplaceReport, served: Served<unknown>[]): SiteResult {
  return { key, rows: [], report, served, progress: { at, available: 0, hasMore: false, stop: true } };
}

/** A failure may be transient (a timeout, a blocked attempt): the site keeps its place and is asked again next call. */
function retryLater(key: Marketplace, at: SitePosition, report: MarketplaceReport, served: Served<unknown>[]): SiteResult {
  return { key, rows: [], report, served, progress: { at, available: 0, hasMore: false, stop: false, retry: true } };
}

async function searchSite(engine: Engine, key: Marketplace, at: SitePosition, query: ShoppingSearchQuery, productBudget: number, scope: CallScope): Promise<SiteResult> {
  const continuing = at.o > 0 || at.x > 0;
  const input = continuing ? { ...query, max_age: Math.max(query.max_age, CONTINUATION_MAX_AGE_SECONDS) } : query;
  const site = SITES[key];
  if (!site) throw new McpyError(ErrorCode.Internal, `no reader for ${key}`);
  const observed_at = new Date().toISOString();
  const sq = siteQuery(input, at);
  const base = { marketplace: key, results: 0, observed_at };
  if (input.game && site.games && !site.games.includes(input.game)) {
    return stopped(key, at, { ...base, status: SiteStatus.Unsupported, search_url: site.search({ ...sq, game: undefined }).url, ignored: [RequestPart.Game] }, []);
  }
  let req = honestApplies(site.search(sq), sq);
  let got: SiteFetch = await fetchAndRead(engine, site, req, (p) => site.read(p, sq), scope, input.max_age);
  const viaApi = await fetchFromApi(engine, site, sq, got, scope, input.max_age);
  // The listing API applies its own filters; the report keeps the site's search URL.
  if (viaApi) [got, req] = [viaApi.got, honestApplies({ ...req, applies: viaApi.applies }, sq)];
  const served: Served<unknown>[] = got.served ? [got.served] : [];
  const report: MarketplaceReport = { ...base, status: SiteStatus.Ok, search_url: req.url };
  if (got.httpStatus) report.http_status = got.httpStatus;
  if (got.finalUrl && got.finalUrl !== req.url) report.final_url = got.finalUrl;
  const outcome = got.outcome;
  if (outcome.kind === "failed") {
    const status = got.error === ErrorCode.BudgetExceeded ? SiteStatus.OverBudget : SiteStatus.Failed;
    const failedReport = { ...report, status, ...(status === SiteStatus.Failed ? { failure: outcome.failure } : {}), ...(got.error ? { error: got.error } : {}) };
    // Not every failure is worth another call: a redesigned page or a redirect away will be the same next time.
    const transient = status === SiteStatus.OverBudget || outcome.failure === "timeout" || outcome.failure === "upstream_failed";
    return failed(key, at, failedReport, served, transient);
  }
  if (outcome.kind === "empty") return stopped(key, at, { ...report, status: SiteStatus.Empty }, served);

  let raw: RawListing[] = outcome.rows;
  let products: number | undefined;
  let opened: number | undefined;
  if (outcome.products?.length && site.product) {
    products = outcome.products.length;
    const batch = outcome.products.slice(at.x, at.x + Math.min(input.max_products, productBudget));
    opened = batch.length;
    const offers = await readOffers(engine, site, batch, input, scope);
    for (const { link, got: o } of offers) {
      if (o.served) served.push(o.served);
      if (o.outcome.kind === "results") raw = raw.concat(o.outcome.rows.map((r) => ({ ...r, product: r.product ?? link })));
    }
    const firstFailure = offers.find((o) => o.got.outcome.kind === "failed");
    // Product pages that failed are not "no offers": with nothing read, the site failed (or ran out of budget).
    if (!raw.length && firstFailure && firstFailure.got.outcome.kind === "failed") {
      const overBudget = firstFailure.got.error === ErrorCode.BudgetExceeded;
      const r = { ...report, status: overBudget ? SiteStatus.OverBudget : SiteStatus.Failed, ...(overBudget ? {} : { failure: firstFailure.got.outcome.failure }), ...(firstFailure.got.error ? { error: firstFailure.got.error } : {}) };
      return failed(key, at, r, served, true);
    }
  }
  if (site.enrich && raw.length) {
    const follow = site.enrich.request(raw);
    if (follow) {
      const before = raw;
      const more = await fetchAndRead(engine, site, follow, (p) => ({ kind: "results", rows: site.enrich!.read(p, before) }), scope, input.max_age);
      if (more.served) served.push(more.served);
      if (more.outcome.kind === "results" && more.outcome.rows.length === before.length) raw = more.outcome.rows;
    }
  }
  const seen = new Set<string>();
  const rows: Listing[] = [];
  for (const r of raw) {
    const listing = normalize(site, r, got.finalUrl ?? req.url);
    if (listing && !seen.has(listing.id)) {
      seen.add(listing.id);
      rows.push(listing);
    }
  }
  const { rows: kept, ignored } = applyFilters(rows, input, req);
  // A site that sells several games but cannot narrow to one: its rows are not filtered by game.
  if (input.game && !site.games) ignored.push(RequestPart.Game);
  const available = kept.slice(at.o);
  const hasMore = site.pagesByCursor ? outcome.nextCursor !== undefined : (outcome.hasMore ?? false);
  return {
    key,
    rows: available,
    served,
    report: { ...report, status: available.length ? SiteStatus.Ok : SiteStatus.Empty, ...(outcome.total !== undefined ? { total: outcome.total } : {}), ...(ignored.length ? { ignored } : {}) },
    progress: { at, available: available.length, products, opened, hasMore, nextToken: site.pagesByCursor ? outcome.nextCursor : undefined, stop: false },
  };
}

/**
 * The site's result, or a timed-out report keeping its place, whichever comes
 * first. A site whose turn comes after the deadline is not started at all.
 * Work still running at the deadline is not cancelled (the engine has no
 * abort for a whole site): it finishes in the background and its result is dropped.
 */
function withDeadline(start: () => Promise<SiteResult>, deadline: number, key: Marketplace, at: SitePosition, input: ShoppingSearchQuery): Promise<SiteResult> {
  const timedOut = () => {
    const site = SITES[key];
    const search_url = site ? site.search(siteQuery(input, at)).url : "https://invalid.example/";
    return failed(key, at, { marketplace: key, status: SiteStatus.Failed, failure: "timeout", results: 0, search_url, observed_at: new Date().toISOString() }, [], true);
  };
  if (Date.now() >= deadline) return Promise.resolve(timedOut());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<SiteResult>((resolve) => {
    timer = setTimeout(() => resolve(timedOut()), Math.max(0, deadline - Date.now()));
  });
  return Promise.race([start(), late]).finally(() => clearTimeout(timer));
}

export function combined(served: Served<unknown>[]): Served<unknown> {
  const attempts = served.reduce((n, s) => n + s.attempts, 0);
  const cache = served.length && served.every((s) => s.cache === CacheStatus.Hit) ? CacheStatus.Hit : served.some((s) => s.cache === CacheStatus.Bypass) ? CacheStatus.Bypass : CacheStatus.Miss;
  return { value: null, cache, attempts, provider: served.map((s) => s.provider).find(Boolean) ?? "none" } as Served<unknown>;
}

export async function shoppingSearchOp(engine: Engine, input: ShoppingSearchQuery, scope: CallScope): Op<ShoppingSearchResult> {
  const startedAt = Date.now();
  const positions = await positionsOf(input);
  const keys = input.marketplaces.filter((k) => positions[k]);
  const productSites = keys.filter((k) => SITES[k]?.product).length;
  const productBudget = Math.max(1, Math.floor(MAX_PRODUCT_PAGES_PER_CALL / Math.max(1, productSites)));
  const deadline = Date.now() + OPERATION_DEADLINE_MS;
  const sites = await pool(keys, SITE_CONCURRENCY, (key) => withDeadline(() => searchSite(engine, key, positions[key]!, input, productBudget, scope), deadline, key, positions[key]!, input));
  const served = combined(sites.flatMap((s) => s.served));
  const results = interleave(sites.map((s) => s.rows), input.max_results);
  const returned = new Map<string, number>();
  for (const l of results) returned.set(l.marketplace, (returned.get(l.marketplace) ?? 0) + 1);
  const next: Positions = {};
  for (const s of sites) {
    const n = returned.get(s.key) ?? 0;
    s.report.results = n;
    const pos = advance({ ...s.progress, returned: n });
    if (pos) next[s.key] = pos;
  }
  const result = ShoppingSearchResultSchema.parse({
    query: input.query,
    results,
    marketplaces: sites.map((s) => s.report),
    next_cursor: await encodeCursor(input, next),
    meta: { cache: served.cache, latency_ms: Date.now() - startedAt, attempts: served.attempts },
  });
  return { result, served, outputChars: JSON.stringify(result).length };
}

export function siteForUrl(url: string): ShoppingSite | undefined {
  const host = new URL(url).hostname;
  return Object.values(SITES).find((s): s is ShoppingSite => !!s && onSiteHost(s, host));
}
