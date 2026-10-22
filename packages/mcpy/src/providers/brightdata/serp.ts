import { Device, ErrorCode, Recency, SearchType } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { HttpMethod } from "../../http/client.js";
import type { FoundPage, ProviderCall, SearchCapabilities, SearchProvider, SearchRequest } from "../types.js";
import { ProviderId } from "../types.js";
import { SerpSchema, type Serp } from "./schemas.js";
import { isEmptyEnvelope, mapSerp } from "./serp-map.js";
import { API, fail, safeJson, type BrightDataOptions } from "./shared.js";

/** Google URL parameters per search type (Bright Data "Google query parameters"). */
const TYPE_PARAMS: Record<SearchType, Record<string, string>> = {
  [SearchType.Web]: {},
  [SearchType.News]: { tbm: "nws" },
  [SearchType.Images]: { udm: "2" },
  [SearchType.Videos]: { tbm: "vid" },
  [SearchType.Shopping]: { udm: "28" },
  [SearchType.Jobs]: { ibp: "htl;jobs" },
  [SearchType.Places]: { udm: "1" },
};

const RECENCY: Record<Recency, string> = {
  [Recency.Hour]: "qdr:h",
  [Recency.Day]: "qdr:d",
  [Recency.Week]: "qdr:w",
  [Recency.Month]: "qdr:m",
  [Recency.Year]: "qdr:y",
};

/** Google no longer honors `num` (2025): each request returns one page of about this many results. */
const GOOGLE_PAGE_SIZE = 10;
const MAX_REQUESTS_PER_SEARCH = 5;
const DEFAULT_COUNTRY = "us";
const DEFAULT_LANGUAGE = "en";

/**
 * Jobs is left out: Google Jobs through the SERP API failed upstream when
 * verified live (2026-10-22: HTTP 502 after 81 s). Re-enable once it works.
 */
export const BRIGHTDATA_SEARCH_CAPABILITIES: SearchCapabilities = {
  types: Object.values(SearchType).filter((t) => t !== SearchType.Jobs),
  recency: true,
  sites: true,
  country: true,
  language: true,
  device: true,
  maxDepth: 300,
};

/** The query with site filters folded in as Google operators. */
export function googleQuery(req: SearchRequest): string {
  let q = req.query;
  if (req.sites?.length) q += ` (${req.sites.map((s) => `site:${s}`).join(" OR ")})`;
  if (req.excludeSites?.length) q += ` ${req.excludeSites.map((s) => `-site:${s}`).join(" ")}`;
  return q;
}

export function googleUrl(req: SearchRequest, start: number): string {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", googleQuery(req));
  for (const [k, v] of Object.entries(TYPE_PARAMS[req.type])) url.searchParams.set(k, v);
  if (req.country) url.searchParams.set("gl", req.country);
  if (req.language) url.searchParams.set("hl", req.language);
  if (req.recency) url.searchParams.set("tbs", RECENCY[req.recency]);
  if (req.device === Device.Mobile) url.searchParams.set("brd_mobile", "1");
  if (start > 0) url.searchParams.set("start", String(start));
  return url.toString();
}

/**
 * One SERP page. Parsed output is requested with `format: "json"` and
 * `data_format: "parsed"` (verified live: `format: "raw"` with `brd_json=1`
 * returned an empty body on a Full-JSON zone). The parsed SERP arrives as a
 * JSON string in the envelope's `body`.
 */
/** Relayed search-engine failures worth one more try (Bright Data bills only successes). */
const TRANSIENT_UPSTREAM = new Set([429, 500, 502, 503, 504]);
const UPSTREAM_TRIES = 2;

async function fetchSerp(options: BrightDataOptions, url: string, call: ProviderCall): Promise<Serp> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchSerpOnce(options, url, call);
    } catch (err) {
      const retry = err instanceof ProviderFailure && err.status !== undefined && TRANSIENT_UPSTREAM.has(err.status) && attempt < UPSTREAM_TRIES;
      if (!retry || Date.now() >= call.context.deadlineAt) throw err;
    }
  }
}

async function fetchSerpOnce(options: BrightDataOptions, url: string, call: ProviderCall): Promise<Serp> {
  const response = await call.http.send(
    {
      url: API,
      method: HttpMethod.Post,
      headers: { Authorization: `Bearer ${options.apiKey}` },
      json: { zone: options.zone, url, format: "json", data_format: "parsed" },
    },
    { ...call.context, maxBytes: call.context.maxBytes * 2 },
  );
  if (response.status >= 400) fail(response);
  let serp = SerpSchema.safeParse(safeJson(response.text));
  // Google's own failure, relayed inside a 200 envelope (seen live: 502 with an empty body).
  const upstream = serp.success ? serp.data.status_code : undefined;
  if (upstream !== undefined && upstream >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `search engine returned HTTP ${upstream}`, upstream);
  if (serp.success && serp.data.body && isEmptyEnvelope(serp.data)) serp = SerpSchema.safeParse(safeJson(serp.data.body));
  if (!serp.success) throw new ProviderFailure(ErrorCode.BadResponse, "SERP response was not JSON (is brd_json enabled for this zone?)", response.status);
  // No section at all and no `general` block is an error envelope, not "no results".
  if (isEmptyEnvelope(serp.data)) throw new ProviderFailure(ErrorCode.BadResponse, "SERP response has no results block", response.status);
  return serp.data;
}

/** Bright Data SERP API (Google), parsed to JSON, every search type. */
export function brightDataSearch(options: BrightDataOptions): SearchProvider {
  return {
    id: ProviderId.BrightData,
    costPerCall: options.costPerCall ?? 0.0015,
    capabilities: BRIGHTDATA_SEARCH_CAPABILITIES,
    // Measured live: 4-26 s per SERP request.
    attemptTimeoutMs: 50_000,
    async search(req, call) {
      const located: SearchRequest = {
        ...req,
        country: req.country ?? options.defaultCountry ?? DEFAULT_COUNTRY,
        language: req.language ?? options.defaultLanguage ?? DEFAULT_LANGUAGE,
      };
      // Google serves about 10 results per page and SERP calls take seconds,
      // so the pages needed are fetched in parallel, then merged in order.
      const skip = (req.page - 1) * req.limit;
      const requests = Math.min(MAX_REQUESTS_PER_SEARCH, Math.ceil(req.limit / GOOGLE_PAGE_SIZE));
      const pages = await Promise.all(
        Array.from({ length: requests }, (_, i) => fetchSerp(options, googleUrl(located, skip + i * GOOGLE_PAGE_SIZE), call)),
      );
      const found: FoundPage[] = [];
      const seen = new Set<string>();
      for (const page of pages) {
        for (const hit of mapSerp(req.type, page)) {
          if (seen.has(hit.url)) continue;
          seen.add(hit.url);
          found.push(hit);
        }
      }
      return found.slice(0, req.limit);
    },
  };
}
