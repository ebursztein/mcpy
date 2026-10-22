import { ErrorCode, PageFormat } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { HttpMethod, type HttpResponse } from "../../http/client.js";
import { ProviderId, type PageProvider, type SearchProvider } from "../types.js";
import { ScrapeResponseSchema, SearchResponseSchema } from "./schemas.js";

export interface FirecrawlOptions {
  apiKey: string;
  /** Self-hosted Firecrawl base URL. */
  apiUrl?: string;
  costPerCall?: number;
}

const DEFAULT_API = "https://api.firecrawl.dev";
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_QUERY_CHARS = 500;

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
  return {
    id: ProviderId.Firecrawl,
    costPerCall: options.costPerCall ?? 0.001,
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
            headers: { "User-Agent": call.userAgent(req.userAgent) },
            // The engine's cache owns freshness; never serve Firecrawl's stale copy.
            maxAge: 0,
          },
        },
        ScrapeResponseSchema,
        { ...call.context, maxBytes: call.context.maxBytes * 2 },
      );
      check(response, data);
      const page = data.data ?? {};
      const meta = page.metadata ?? {};
      const title = Array.isArray(meta.title) ? meta.title[0] : meta.title;
      return {
        url: req.url,
        finalUrl: meta.url ?? meta.sourceURL ?? req.url,
        status: meta.statusCode ?? 0,
        contentType: meta.contentType ?? (html ? "text/html" : "text/markdown"),
        title: title || undefined,
        content: (html ? page.rawHtml : page.markdown) ?? "",
        format: req.format,
      };
    },
  };
}

/** Firecrawl v2 search. */
export function firecrawlSearch(options: FirecrawlOptions): SearchProvider {
  return {
    id: ProviderId.Firecrawl,
    costPerCall: options.costPerCall ?? 0.002,
    async search(req, call) {
      const { response, data } = await call.http.json(
        {
          url: endpoint(options, "/v2/search"),
          method: HttpMethod.Post,
          headers: { Authorization: `Bearer ${options.apiKey}` },
          json: { query: req.query.slice(0, MAX_QUERY_CHARS), limit: req.limit, timeout: call.timeoutMs },
        },
        SearchResponseSchema,
        call.context,
      );
      check(response, data);
      return (data.data?.web ?? []).map((r) => ({ url: r.url, title: r.title ?? r.url, snippet: r.description ?? "" }));
    },
  };
}
