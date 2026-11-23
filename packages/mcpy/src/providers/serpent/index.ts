/**
 * Serpent API (apiserpent.com): Google results as JSON, billed per call.
 * Checked live 2026-11-23 against Firecrawl on the same queries: same
 * organic results with real publisher URLs (no google.com/goto redirects,
 * unlike Bright Data's SERP API), 3-8 s per call.
 *  - Web uses standard search (/api/search/quick): organic rows only, one
 *    flat charge per call at any depth up to num=100. Per-page search
 *    (/api/search) bills every page, so it is not used.
 *  - There is no offset: page N asks for N * limit rows and keeps the last
 *    `limit`, as with Firecrawl. A deeper page costs the same call.
 *  - News goes to Bing: Google news rows link to news.google.com/articles
 *    redirects, Bing's to the publisher (checked live 2026-11-23).
 *  - Pricing risk: its site warns prices may rise 10x from December 2026
 *    ($6 per 1,000, still under Firecrawl). If that happens, compare
 *    Litescrape (about $0.15 per 1,000) as the first search source.
 *  - Errors are JSON with a stable `code`; 402 is insufficient_credits, 429
 *    rate_limit_exceeded, and failed calls are refunded.
 */

import { ErrorCode, Recency, SearchType } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { HttpMethod, type HttpResponse } from "../../http/client.js";
import { ProviderId, type FoundPage, type SearchCapabilities, type SearchProvider, type SearchRequest } from "../types.js";
import { SerpentResponseSchema, type SerpentResponse } from "./schemas.js";

export interface SerpentOptions {
  apiKey: string;
  /** Base URL (default https://apiserpent.com). */
  apiUrl?: string;
  /** USD per call on your tier (default: the Default tier, $0.60 per 1,000). */
  costPerCall?: number;
}

/** Default tier, new credit: $0.60 per 1,000 calls (GET /api/status costPerSearch, 2026-11-23). */
export const SERPENT_DEFAULT_USD_PER_CALL = 0.0006;

const DEFAULT_API = "https://apiserpent.com";
/** Serpent refuses q over 2,048 characters. */
const MAX_QUERY_CHARS = 2_048;
/** Its `timeout` parameter is in seconds and floored at 5. */
const MIN_TIMEOUT_S = 5;

const ENDPOINT: Partial<Record<SearchType, string>> = {
  [SearchType.Web]: "/api/search/quick",
  [SearchType.News]: "/api/news",
  [SearchType.Images]: "/api/images",
};

/** Deepest num each endpoint takes. */
const MAX_NUM: Partial<Record<SearchType, number>> = { [SearchType.Web]: 100, [SearchType.News]: 50, [SearchType.Images]: 100 };

/** Web and news: the `freshness` parameter. */
const FRESHNESS: Record<Recency, string> = {
  [Recency.Hour]: "h",
  [Recency.Day]: "d",
  [Recency.Week]: "7d",
  [Recency.Month]: "m",
  [Recency.Year]: "y",
};

/** Images: Google has no date filter; Yahoo's `time` has no hour. */
const IMAGE_TIME: Partial<Record<Recency, string>> = { [Recency.Day]: "day", [Recency.Week]: "week", [Recency.Month]: "month", [Recency.Year]: "year" };

export const SERPENT_SEARCH_CAPABILITIES: SearchCapabilities = {
  types: [SearchType.Web, SearchType.News, SearchType.Images],
  recency: true,
  sites: true,
  country: true,
  language: true,
  device: false,
  maxDepth: 100,
};

function query(req: SearchRequest): string {
  let q = req.query;
  if (req.sites?.length) q += ` (${req.sites.map((s) => `site:${s}`).join(" OR ")})`;
  if (req.excludeSites?.length) q += ` ${req.excludeSites.map((s) => `-site:${s}`).join(" ")}`;
  return q.slice(0, MAX_QUERY_CHARS);
}

function params(req: SearchRequest, num: number, timeoutMs: number): URLSearchParams {
  const p = new URLSearchParams({ q: query(req), num: String(num), timeout: String(Math.max(MIN_TIMEOUT_S, Math.floor(timeoutMs / 1000))) });
  if (req.country) p.set("country", req.country.toLowerCase());
  if (req.language) p.set("language", req.language.toLowerCase().slice(0, 2));
  if (req.type === SearchType.News) p.set("engine", "bing");
  if (req.recency && req.type === SearchType.Images) {
    const time = IMAGE_TIME[req.recency];
    // Asking for a wider window than the caller set would return results it excluded.
    if (!time) throw new ProviderFailure(ErrorCode.InvalidInput, "image search cannot be limited to the last hour");
    p.set("engine", "yahoo");
    p.set("time", time);
  } else if (req.recency) p.set("freshness", FRESHNESS[req.recency]);
  return p;
}

function check(response: HttpResponse, body: SerpentResponse): void {
  if (response.status >= 400 || !body.success) {
    throw new ProviderFailure(ErrorCode.UpstreamFailed, `${body.code ?? `HTTP ${response.status}`}: ${body.message ?? "request failed"}`, response.status);
  }
}

const webUrl = (u: string | null | undefined): u is string => typeof u === "string" && /^https?:\/\//i.test(u);
const optional = (v: string | null | undefined) => v ?? undefined;

function rows(type: SearchType, body: SerpentResponse): FoundPage[] {
  const r = body.results;
  if (type === SearchType.News) {
    return (r?.articles ?? []).flatMap((a) =>
      webUrl(a.url) ? [{ url: a.url, title: a.title || a.url, snippet: a.snippet ?? "", date: optional(a.publishedTime), publisher: optional(a.source), image: optional(a.image) }] : [],
    );
  }
  if (type === SearchType.Images) {
    return (r?.images ?? []).flatMap((i) => {
      const page = webUrl(i.pageUrl) ? i.pageUrl : webUrl(i.original) ? i.original : undefined;
      return page ? [{ url: page, title: i.title || page, snippet: "", image: webUrl(i.original) ? i.original : optional(i.thumbnail), publisher: optional(i.source) }] : [];
    });
  }
  return (r?.organic ?? []).flatMap((o) =>
    webUrl(o.url) ? [{ url: o.url, title: o.title || o.url, snippet: o.snippet ?? "", date: optional(o.publishedTime), publisher: optional(o.publisher) }] : [],
  );
}

/** Serpent web, news and image search. */
export function serpentSearch(options: SerpentOptions): SearchProvider {
  const base = (options.apiUrl ?? DEFAULT_API).replace(/\/+$/, "");
  return {
    id: ProviderId.Serpent,
    costPerCall: options.costPerCall ?? SERPENT_DEFAULT_USD_PER_CALL,
    capabilities: SERPENT_SEARCH_CAPABILITIES,
    // The quick endpoint's own budget is 20 s, news and images 30 s.
    attemptTimeoutMs: 35_000,
    async search(req, call) {
      const path = ENDPOINT[req.type];
      if (!path) throw new ProviderFailure(ErrorCode.InvalidInput, `search type ${req.type} is not supported`);
      const num = Math.min(req.page * req.limit, MAX_NUM[req.type] ?? 100);
      const { response, data } = await call.http.json(
        { url: `${base}${path}?${params(req, num, call.timeoutMs).toString()}`, method: HttpMethod.Get, headers: { "X-API-Key": options.apiKey } },
        SerpentResponseSchema,
        call.context,
      );
      check(response, data);
      // A success without `results` is a soft failure, not "no results": do not cache it as such.
      if (!data.results) throw new ProviderFailure(ErrorCode.BadResponse, "search succeeded without results", response.status);
      return rows(req.type, data).slice((req.page - 1) * req.limit, req.page * req.limit);
    },
  };
}
