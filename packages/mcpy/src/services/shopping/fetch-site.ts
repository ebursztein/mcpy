/**
 * One site page through the engine (cache, fallback chain, render), turned
 * into a read outcome. Every way a page can fail to be a result page ends
 * as a typed failure here, so the service never guesses.
 */

import { ErrorCode, HttpMethod, PageFormat, UserAgentProfile } from "../../enums.js";
import { McpyError, toMcpyError } from "../../errors.js";
import type { CallScope, Engine, Served } from "../../engine/engine.js";
import { isJson } from "../../api/page-input.js";
import { assertPublicHttpUrl } from "../../http/url.js";
import type { FetchedPage, PageRequest } from "../../providers/types.js";
import { onSiteHost } from "../../sites/normalize.js";
import type { ReadOutcome, ShoppingSite, SitePage, SiteQuery, SiteRequest } from "../../sites/types.js";
import type { SiteFailure } from "../common.js";

export interface SiteFetch {
  outcome: ReadOutcome;
  /** What served it (a page, or a listing API's records): cache and attempts for the result's meta. */
  served?: Served<unknown>;
  httpStatus?: number;
  finalUrl?: string;
  error?: ErrorCode;
}

/**
 * Why the chain gave up. Its error code is generic ("every source failed"),
 * so the per-attempt reasons decide: any bot challenge or 401/403/429 means
 * the site blocked us.
 */
export function failureOf(code: ErrorCode, details: readonly string[] = []): SiteFailure {
  if (code === ErrorCode.Forbidden || code === ErrorCode.RateLimited || code === ErrorCode.Unauthorized) return "blocked";
  if (details.some((d) => /challenge|bot check|HTTP (401|403|429|247)\b/i.test(d))) return "blocked";
  if (code === ErrorCode.Timeout) return "timeout";
  return "upstream_failed";
}

/** A JSON body goes out as JSON unless the site typed it, as with web_fetch (TCGplayer answers 415 otherwise). */
function headersFor(req: SiteRequest): Record<string, string> | undefined {
  const headers = { ...req.headers };
  const typed = Object.keys(headers).some((n) => n.toLowerCase() === "content-type");
  if (req.method === HttpMethod.Post && req.body !== undefined && !typed && isJson(req.body)) headers["Content-Type"] = "application/json";
  return Object.keys(headers).length ? headers : undefined;
}

export function pageRequest(req: SiteRequest): PageRequest {
  assertPublicHttpUrl(req.url);
  const headers = headersFor(req);
  return {
    url: req.url,
    format: req.format ?? PageFormat.Html,
    userAgent: UserAgentProfile.Chrome,
    ...(req.method && req.method !== HttpMethod.Get ? { method: req.method, body: req.body } : {}),
    ...(headers ? { headers } : {}),
    ...(req.render ? { render: true, ...(req.waitMs ? { waitMs: req.waitMs } : {}) } : {}),
    ...(req.country ? { country: req.country } : {}),
  };
}

/** Fetch `req` and read it with `read`; any failure becomes a failed outcome with its reason. */
export async function fetchAndRead(
  engine: Engine,
  site: ShoppingSite,
  req: SiteRequest,
  read: (page: SitePage) => ReadOutcome,
  scope: CallScope,
  maxAgeSeconds: number,
): Promise<SiteFetch> {
  let served: Served<FetchedPage>;
  try {
    served = await engine.page(pageRequest(req), scope, maxAgeSeconds);
  } catch (err) {
    const e = toMcpyError(err);
    return { outcome: { kind: "failed", failure: failureOf(e.code, e.details), detail: e.message }, error: e.code };
  }
  const page = served.value;
  const requested = new URL(req.url).hostname;
  let finalHost = "";
  try {
    finalHost = new URL(page.finalUrl).hostname;
  } catch {
    finalHost = "";
  }
  const base = { served, httpStatus: page.status || undefined, finalUrl: page.finalUrl };
  // A redirect within the site (www -> produto., a category subdomain) is still the site.
  if (finalHost !== requested && !onSiteHost(site, finalHost)) return { ...base, outcome: { kind: "failed", failure: "redirected", detail: `redirected to ${finalHost || "an invalid URL"}` } };
  const ok = page.status === 0 || (page.status >= 200 && page.status < 300);
  if (!ok && !site.emptyStatuses?.includes(page.status)) return { ...base, outcome: { kind: "failed", failure: "upstream_failed", detail: `HTTP ${page.status}` } };
  try {
    const outcome = read({ url: page.url, finalUrl: page.finalUrl, status: page.status, content: page.content });
    if (!ok && outcome.kind === "results" && outcome.rows.length) return { ...base, outcome: { kind: "failed", failure: "upstream_failed", detail: `listings with HTTP ${page.status}` } };
    return { ...base, outcome: !ok && outcome.kind !== "failed" ? { kind: "empty" } : outcome };
  } catch (err) {
    const detail = err instanceof McpyError || err instanceof Error ? err.message : String(err);
    return { ...base, outcome: { kind: "failed", failure: "redesigned", detail: `reader failed: ${detail.slice(0, 200)}` } };
  }
}

/** Page failures a listing API can get around; a redesigned or redirected page is the site's answer, not a block. */
const API_RESCUES: readonly SiteFailure[] = ["blocked", "timeout", "upstream_failed"];

/**
 * The last resort for a search page no page source could fetch: the site's
 * listing API, when it has one and a listing source serves its market.
 * Undefined when it does not apply or also fails (the page failure stands).
 */
export async function fetchFromApi(
  engine: Engine,
  site: ShoppingSite,
  sq: SiteQuery,
  page: SiteFetch,
  scope: CallScope,
  maxAgeSeconds: number,
): Promise<{ got: SiteFetch; applies: NonNullable<SiteRequest["applies"]> } | undefined> {
  if (!site.api || page.outcome.kind !== "failed" || !API_RESCUES.includes(page.outcome.failure) || page.error === ErrorCode.BudgetExceeded) return undefined;
  const { listing, applies } = site.api.request(sq);
  if (!engine.servesListings(listing.market)) return undefined;
  try {
    const served = await engine.listings(listing, scope, maxAgeSeconds);
    return { got: { outcome: site.api.read(served.value), served }, applies };
  } catch {
    return undefined;
  }
}

/** The site's price bounds are whole units in most URLs: a fractional bound is applied by mcpy instead. */
export function honestApplies(req: SiteRequest, sq: SiteQuery): SiteRequest {
  const applies = { ...req.applies };
  if (sq.minPrice !== undefined && !Number.isInteger(sq.minPrice)) applies.minPrice = false;
  if (sq.maxPrice !== undefined && !Number.isInteger(sq.maxPrice)) applies.maxPrice = false;
  return { ...req, applies };
}

export interface SearchFetch {
  got: SiteFetch;
  /** The request that answered (its URL is the report's search_url, its applies decide mcpy's own filtering). */
  req: SiteRequest;
  /** Every fetch made, including a feed that failed. */
  served: Served<unknown>[];
}

/**
 * A site's search, cheapest source first: its feed (free, fuller rows) when
 * it has one, then its search page through the fallback chain, then its
 * listing API. A feed that failed in any way hands over to the page; an empty
 * feed answer stands, as the site's own "no results".
 */
export async function searchSource(engine: Engine, site: ShoppingSite, sq: SiteQuery, scope: CallScope, maxAgeSeconds: number): Promise<SearchFetch> {
  const served: Served<unknown>[] = [];
  if (site.feed) {
    const req = honestApplies(site.feed.search(sq), sq);
    const got = await fetchAndRead(engine, site, req, (p) => site.feed!.read(p, sq), scope, maxAgeSeconds);
    if (got.served) served.push(got.served);
    if (got.outcome.kind !== "failed" || got.error === ErrorCode.BudgetExceeded) return { got, req, served };
  }
  let req = honestApplies(site.search(sq), sq);
  let got = await fetchAndRead(engine, site, req, (p) => site.read(p, sq), scope, maxAgeSeconds);
  const viaApi = await fetchFromApi(engine, site, sq, got, scope, maxAgeSeconds);
  // The listing API applies its own filters; the report keeps the site's search URL.
  if (viaApi) [got, req] = [viaApi.got, honestApplies({ ...req, applies: viaApi.applies }, sq)];
  if (got.served) served.push(got.served);
  return { got, req, served };
}
