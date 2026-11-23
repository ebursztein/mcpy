import { contentKindOf } from "../../content/kind.js";
import { ErrorCode, PageFormat, Recency, SearchType, UserAgentProfile } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { HttpMethod, type HttpResponse } from "../../http/client.js";
import { forwardedUserAgent, ProviderId, type PageProvider, type PageRequest, type ProviderCall, type SearchCapabilities, type SearchProvider } from "../types.js";
import { ScrapeResponseSchema, SearchResponseSchema } from "./schemas.js";

export interface FirecrawlOptions {
  apiKey: string;
  /** Self-hosted Firecrawl base URL. */
  apiUrl?: string;
  /** What one credit costs on your plan (default: Hobby, $19 for 5,000 credits). Costs below are estimated from it. */
  usdPerCredit?: number;
  /** Flat estimate per call, overriding the credit-based one. */
  costPerCall?: number;
}

/** Hobby plan: $19 a month for 5,000 credits (firecrawl.dev/pricing, Nov 2026). */
export const FIRECRAWL_HOBBY_USD_PER_CREDIT = 19 / 5_000;

/**
 * Credits Firecrawl bills (firecrawl.dev billing docs; checked live
 * 2026-11-21 from `creditsUsed`): a scrape is 1, a search is 2 per 10
 * results asked for, rounded up (10 results: 2, 25: 6).
 */
const SCRAPE_CREDITS = 1;
const searchCredits = (results: number) => Math.ceil(results / 10) * 2;

const DEFAULT_API = "https://api.firecrawl.dev";
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_QUERY_CHARS = 500;

/** Headers for Firecrawl's browser to send: a forwarded user agent, then the caller's own. */
function targetHeaders(ua: string | undefined, extra: Record<string, string> | undefined) {
  const headers = { ...(ua ? { "User-Agent": ua } : {}), ...extra };
  return Object.keys(headers).length ? { headers } : {};
}

/**
 * Firecrawl runs its own fingerprinted browser: a desktop browser agent sent
 * on top of it no longer matches the fingerprint. Forwarding chrome made
 * Cardmarket time out past 20 s; without it the same page came back in 13 s
 * (2026-11-22). So desktop profiles are not forwarded, mobile is asked for
 * with Firecrawl's own mobile emulation, and only a crawler identity
 * (googlebot) is sent as a header.
 */
function agentOptions(req: PageRequest, call: ProviderCall): { mobile?: true; ua?: string } {
  if (req.userAgent === UserAgentProfile.Mobile) return { mobile: true };
  if (req.userAgent === UserAgentProfile.Googlebot) return { ua: forwardedUserAgent(req, call) };
  return {};
}

function endpoint(options: FirecrawlOptions, path: string): string {
  return `${(options.apiUrl || DEFAULT_API).replace(/\/$/, "")}${path}`;
}

function check(response: HttpResponse, body: { success: boolean; error?: string; code?: string }): void {
  if (response.status >= 400 || !body.success) {
    throw new ProviderFailure(ErrorCode.UpstreamFailed, `${body.code ?? `HTTP ${response.status}`}: ${body.error ?? "request failed"}`, response.status);
  }
}

/** Firecrawl v2 scrape. */
export function firecrawl(options: FirecrawlOptions): PageProvider {
  const usdPerCredit = options.usdPerCredit ?? FIRECRAWL_HOBBY_USD_PER_CREDIT;
  return {
    id: ProviderId.Firecrawl,
    costPerCall: options.costPerCall ?? SCRAPE_CREDITS * usdPerCredit,
    // Every scrape runs in a browser.
    capabilities: { render: true, headers: true },
    async fetchPage(req, call) {
      const html = req.format === PageFormat.Html;
      const { response, data } = await call.http.json(
        {
          url: endpoint(options, "/v2/scrape"),
          method: HttpMethod.Post,
          headers: { Authorization: `Bearer ${options.apiKey}` },
          json: {
            url: req.url,
            formats: [html ? "rawHtml" : "markdown"],
            onlyMainContent: !html,
            timeout: Math.min(Math.max(call.timeoutMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS),
            ...(req.waitMs ? { waitFor: req.waitMs } : {}),
            ...(agentOptions(req, call).mobile ? { mobile: true } : {}),
            ...(req.country ? { location: { country: req.country.toUpperCase() } } : {}),
            ...targetHeaders(agentOptions(req, call).ua, req.headers),
            // The engine's cache owns freshness; never serve Firecrawl's stale copy.
            maxAge: 0,
          },
        },
        ScrapeResponseSchema,
        { ...call.context, maxBytes: call.context.maxBytes * 2 },
      );
      check(response, data);
      if (!data.data) throw new ProviderFailure(ErrorCode.BadResponse, "scrape succeeded without data", response.status);
      const page = data.data;
      const meta = page.metadata ?? {};
      const title = Array.isArray(meta.title) ? meta.title[0] : meta.title;
      return {
        url: req.url,
        finalUrl: meta.url ?? meta.sourceURL ?? req.url,
        status: meta.statusCode ?? 0,
        contentType: meta.contentType ?? "text/html",
        kind: contentKindOf(meta.contentType ?? "text/html"),
        title: title || undefined,
        content: (html ? page.rawHtml : page.markdown) ?? "",
        format: req.format,
      };
    },
  };
}

/** Firecrawl's search API returns at most this many results per request. */
const MAX_SEARCH_DEPTH = 100;

const SOURCE: Partial<Record<SearchType, string>> = {
  [SearchType.Web]: "web",
  [SearchType.News]: "news",
  [SearchType.Images]: "images",
};

const RECENCY: Record<Recency, string> = {
  [Recency.Hour]: "qdr:h",
  [Recency.Day]: "qdr:d",
  [Recency.Week]: "qdr:w",
  [Recency.Month]: "qdr:m",
  [Recency.Year]: "qdr:y",
};

export const FIRECRAWL_SEARCH_CAPABILITIES: SearchCapabilities = {
  types: [SearchType.Web, SearchType.News, SearchType.Images],
  recency: true,
  sites: true,
  country: true,
  language: false,
  device: false,
  maxDepth: MAX_SEARCH_DEPTH,
};

/**
 * Firecrawl v2 search (web, news, images). There is no offset parameter, so
 * page N asks for N * limit results and keeps the last `limit`.
 */
export function firecrawlSearch(options: FirecrawlOptions): SearchProvider {
  const usdPerCredit = options.usdPerCredit ?? FIRECRAWL_HOBBY_USD_PER_CREDIT;
  const depthOf = (req: { page: number; limit: number }) => Math.min(req.page * req.limit, MAX_SEARCH_DEPTH);
  return {
    id: ProviderId.Firecrawl,
    costPerCall: options.costPerCall ?? searchCredits(10) * usdPerCredit,
    costOf: (req) => options.costPerCall ?? searchCredits(depthOf(req)) * usdPerCredit,
    capabilities: FIRECRAWL_SEARCH_CAPABILITIES,
    async search(req, call) {
      const source = SOURCE[req.type] ?? "web";
      const depth = depthOf(req);
      const { response, data } = await call.http.json(
        {
          url: endpoint(options, "/v2/search"),
          method: HttpMethod.Post,
          headers: { Authorization: `Bearer ${options.apiKey}` },
          json: {
            query: req.query.slice(0, MAX_QUERY_CHARS),
            limit: depth,
            sources: [{ type: source }],
            timeout: call.timeoutMs,
            ...(req.recency ? { tbs: RECENCY[req.recency] } : {}),
            ...(req.country ? { country: req.country.toUpperCase() } : {}),
            ...(req.sites?.length ? { includeDomains: req.sites } : {}),
            ...(req.excludeSites?.length ? { excludeDomains: req.excludeSites } : {}),
          },
        },
        SearchResponseSchema,
        call.context,
      );
      check(response, data);
      // A success without `data` is a soft failure, not "no results": do not cache it as such.
      if (!data.data) throw new ProviderFailure(ErrorCode.BadResponse, "search succeeded without data", response.status);
      const list = (source === "news" ? data.data.news : source === "images" ? data.data.images : data.data.web) ?? [];
      return list.slice((req.page - 1) * req.limit, req.page * req.limit).map((r) => ({
        url: r.url,
        title: r.title ?? r.url,
        snippet: r.description ?? r.snippet ?? "",
        date: r.date,
        image: r.imageUrl,
      }));
    },
  };
}
