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

/** Google no longer honors `num` (2025): pages are fetched with `start` until enough results arrive. */
const MAX_REQUESTS_PER_SEARCH = 5;

export const BRIGHTDATA_SEARCH_CAPABILITIES: SearchCapabilities = {
  types: Object.values(SearchType),
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
  url.searchParams.set("brd_json", "1");
  return url.toString();
}

async function fetchSerp(options: BrightDataOptions, url: string, call: ProviderCall): Promise<Serp> {
  const response = await call.http.send(
    { url: API, method: HttpMethod.Post, headers: { Authorization: `Bearer ${options.apiKey}` }, json: { zone: options.zone, url, format: "raw" } },
    call.context,
  );
  if (response.status >= 400) fail(response);
  let serp = SerpSchema.safeParse(safeJson(response.text));
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
    async search(req, call) {
      const skip = (req.page - 1) * req.limit;
      const found: FoundPage[] = [];
      const seen = new Set<string>();
      let start = skip;
      for (let i = 0; i < MAX_REQUESTS_PER_SEARCH && found.length < req.limit; i++) {
        const batch = mapSerp(req.type, await fetchSerp(options, googleUrl(req, start), call));
        const fresh = batch.filter((hit) => !seen.has(hit.url));
        if (fresh.length === 0) break; // the engine has nothing more (or ignores `start` for this type)
        for (const hit of fresh) seen.add(hit.url);
        found.push(...fresh);
        start += batch.length;
      }
      return found.slice(0, req.limit);
    },
  };
}
