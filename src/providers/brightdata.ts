import { num } from "../config";
import { htmlTitle, htmlToMarkdown } from "../lib/extract";
import { readTextCapped } from "../lib/http";
import { ProviderError, type FetchProvider, type ProviderFactory, type SearchProvider } from "./types";

const API = "https://api.brightdata.com/request";

/** Envelope returned by `format: "json"`. */
interface UnlockerEnvelope {
  status_code?: number;
  headers?: Record<string, string>;
  body?: string;
}

interface SerpResult {
  organic?: { link: string; title?: string; description?: string }[];
}

/**
 * Bright Data Web Unlocker: residential proxies + anti-bot handling. The most
 * expensive and most robust step, so it sits last in the default chain.
 * We fetch HTML and extract locally so the target status code and the
 * extraction logic stay identical across providers.
 */
export const brightdataFetch: ProviderFactory<FetchProvider> = {
  id: "brightdata",
  create({ env, config, fetch }) {
    const key = env.BRIGHTDATA_API_KEY;
    const zone = env.BRIGHTDATA_UNLOCKER_ZONE;
    if (!key || !zone) return null;
    return {
      id: "brightdata",
      costPerCall: num(env.COST_BRIGHTDATA_FETCH, 0.0015),
      async fetch(req, signal) {
        const res = await fetch(API, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ zone, url: req.url, format: "json" }),
          signal,
        });
        const text = await readTextCapped(res, config.maxResponseBytes * 2);
        if (!res.ok) throw new ProviderError("brightdata", `HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);

        let envelope: UnlockerEnvelope;
        try {
          envelope = JSON.parse(text) as UnlockerEnvelope;
        } catch {
          throw new ProviderError("brightdata", "non-JSON response envelope", res.status);
        }
        const body = envelope.body ?? "";
        const headers = Object.fromEntries(Object.entries(envelope.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
        const contentType = headers["content-type"] ?? "text/html";
        const base = { url: req.url, finalUrl: req.url, status: envelope.status_code ?? 0, contentType };

        if (req.format === "html" || !/html/i.test(contentType)) {
          return { ...base, title: htmlTitle(body), content: body, format: req.format };
        }
        const { title, markdown } = htmlToMarkdown(body, req.url);
        return { ...base, title, content: markdown, format: "markdown" };
      },
    };
  },
};

/** Bright Data SERP API (Google), parsed to JSON. */
export const brightdataSearch: ProviderFactory<SearchProvider> = {
  id: "brightdata",
  create({ env, config, fetch }) {
    const key = env.BRIGHTDATA_API_KEY;
    const zone = env.BRIGHTDATA_SERP_ZONE;
    if (!key || !zone) return null;
    return {
      id: "brightdata",
      costPerCall: num(env.COST_BRIGHTDATA_SEARCH, 0.0015),
      async search(req, signal) {
        const target = new URL("https://www.google.com/search");
        target.searchParams.set("q", req.query);
        target.searchParams.set("num", String(Math.min(req.limit, 100)));
        target.searchParams.set("brd_json", "1");

        const res = await fetch(API, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ zone, url: target.toString(), format: "raw" }),
          signal,
        });
        const text = await readTextCapped(res, config.maxResponseBytes);
        if (!res.ok) throw new ProviderError("brightdata", `HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);

        let parsed: SerpResult & UnlockerEnvelope;
        try {
          parsed = JSON.parse(text) as SerpResult & UnlockerEnvelope;
          // Defensive: some zone configs wrap the SERP in the unlocker envelope.
          if (!parsed.organic && typeof parsed.body === "string") parsed = JSON.parse(parsed.body);
        } catch {
          throw new ProviderError("brightdata", "SERP response was not JSON (is brd_json enabled for this zone?)", res.status);
        }
        return (parsed.organic ?? [])
          .slice(0, req.limit)
          .map((r) => ({ url: r.link, title: r.title ?? r.link, snippet: r.description ?? "" }));
      },
    };
  },
};
