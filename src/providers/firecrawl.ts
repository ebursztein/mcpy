import { num } from "../config";
import { readTextCapped } from "../lib/http";
import { ProviderError, type FetchProvider, type ProviderDeps, type ProviderFactory, type SearchProvider } from "./types";

const DEFAULT_API = "https://api.firecrawl.dev";

interface FirecrawlEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

interface ScrapeData {
  markdown?: string;
  rawHtml?: string;
  metadata?: { title?: string | string[]; url?: string; sourceURL?: string; statusCode?: number; contentType?: string; error?: string | null };
}

interface SearchData {
  web?: { url: string; title?: string; description?: string }[];
}

function client({ env, config, fetch }: ProviderDeps) {
  const key = env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const api = (env.FIRECRAWL_API_URL || DEFAULT_API).replace(/\/$/, "");

  return async function call<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
    const res = await fetch(`${api}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const text = await readTextCapped(res, config.maxResponseBytes * 2);
    let data: FirecrawlEnvelope<T>;
    try {
      data = JSON.parse(text) as FirecrawlEnvelope<T>;
    } catch {
      throw new ProviderError("firecrawl", `non-JSON response (HTTP ${res.status})`, res.status);
    }
    if (!res.ok || !data.success || !data.data) {
      throw new ProviderError("firecrawl", `${data.code ?? `HTTP ${res.status}`}: ${data.error ?? "request failed"}`, res.status);
    }
    return data.data;
  };
}

export const firecrawlFetch: ProviderFactory<FetchProvider> = {
  id: "firecrawl",
  create(deps) {
    const call = client(deps);
    if (!call) return null;
    return {
      id: "firecrawl",
      costPerCall: num(deps.env.COST_FIRECRAWL_FETCH, 0.001),
      async fetch(req, signal) {
        const data = await call<ScrapeData>(
          "/v2/scrape",
          {
            url: req.url,
            formats: [req.format === "html" ? "rawHtml" : "markdown"],
            onlyMainContent: req.format === "markdown",
            timeout: Math.min(Math.max(req.timeoutMs, 1_000), 300_000),
            // Our own cache handles freshness; do not serve Firecrawl's stale copy.
            maxAge: 0,
          },
          signal,
        );
        const meta = data.metadata ?? {};
        const title = Array.isArray(meta.title) ? meta.title[0] : meta.title;
        const content = (req.format === "html" ? data.rawHtml : data.markdown) ?? "";
        return {
          url: req.url,
          finalUrl: meta.url ?? meta.sourceURL ?? req.url,
          status: meta.statusCode ?? 0,
          contentType: meta.contentType ?? (req.format === "html" ? "text/html" : "text/markdown"),
          title: title || undefined,
          content,
          format: req.format,
        };
      },
    };
  },
};

export const firecrawlSearch: ProviderFactory<SearchProvider> = {
  id: "firecrawl",
  create(deps) {
    const call = client(deps);
    if (!call) return null;
    return {
      id: "firecrawl",
      costPerCall: num(deps.env.COST_FIRECRAWL_SEARCH, 0.002),
      async search(req, signal) {
        const data = await call<SearchData>(
          "/v2/search",
          { query: req.query.slice(0, 500), limit: req.limit, timeout: req.timeoutMs },
          signal,
        );
        return (data.web ?? []).map((r) => ({ url: r.url, title: r.title ?? r.url, snippet: r.description ?? "" }));
      },
    };
  },
};
