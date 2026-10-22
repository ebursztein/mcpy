import { htmlTitle, htmlToMarkdown } from "../../content/extract.js";
import { ErrorCode, PageFormat } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { HttpMethod, type HttpResponse } from "../../http/client.js";
import { ProviderId, type PageProvider, type SearchProvider } from "../types.js";
import { SerpSchema, UnlockerEnvelopeSchema } from "./schemas.js";

export interface BrightDataOptions {
  apiKey: string;
  /** Web Unlocker zone (pages) or SERP API zone (search). */
  zone: string;
  costPerCall?: number;
}

const API = "https://api.brightdata.com/request";
const MAX_SERP_RESULTS = 100;

function fail(response: HttpResponse): never {
  throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}: ${response.text.slice(0, 200)}`, response.status);
}

/**
 * Bright Data Web Unlocker: residential proxies + anti-bot handling. The
 * most robust and most expensive step, last in the default chain. Fetches
 * HTML and extracts locally so the target status and extraction match the
 * other providers.
 */
export function brightData(options: BrightDataOptions): PageProvider {
  return {
    id: ProviderId.BrightData,
    costPerCall: options.costPerCall ?? 0.0015,
    async fetchPage(req, call) {
      const response = await call.http.send(
        {
          url: API,
          method: HttpMethod.Post,
          headers: { Authorization: `Bearer ${options.apiKey}` },
          // Web Unlocker picks its own browser fingerprint and user agent.
          json: { zone: options.zone, url: req.url, format: "json" },
        },
        { ...call.context, maxBytes: call.context.maxBytes * 2 },
      );
      if (response.status >= 400) fail(response);
      const parsed = UnlockerEnvelopeSchema.safeParse(safeJson(response.text));
      if (!parsed.success) throw new ProviderFailure(ErrorCode.BadResponse, "unexpected Web Unlocker envelope", response.status);

      const envelope = parsed.data;
      const body = envelope.body ?? "";
      const headers = new Headers(envelope.headers ?? {});
      const contentType = headers.get("content-type") ?? "text/html";
      const base = { url: req.url, finalUrl: req.url, status: envelope.status_code ?? 0, contentType };
      if (req.format === PageFormat.Html || !/html/i.test(contentType)) {
        return { ...base, title: htmlTitle(body), content: body, format: req.format };
      }
      const { title, markdown } = htmlToMarkdown(body, req.url);
      return { ...base, title, content: markdown, format: PageFormat.Markdown };
    },
  };
}

/** Bright Data SERP API (Google), parsed to JSON. */
export function brightDataSearch(options: BrightDataOptions): SearchProvider {
  return {
    id: ProviderId.BrightData,
    costPerCall: options.costPerCall ?? 0.0015,
    async search(req, call) {
      const target = new URL("https://www.google.com/search");
      target.searchParams.set("q", req.query);
      target.searchParams.set("num", String(Math.min(req.limit, MAX_SERP_RESULTS)));
      target.searchParams.set("brd_json", "1");

      const response = await call.http.send(
        {
          url: API,
          method: HttpMethod.Post,
          headers: { Authorization: `Bearer ${options.apiKey}` },
          json: { zone: options.zone, url: target.toString(), format: "raw" },
        },
        call.context,
      );
      if (response.status >= 400) fail(response);

      let serp = SerpSchema.safeParse(safeJson(response.text));
      // Some zone configs wrap the SERP in the unlocker envelope.
      if (serp.success && !serp.data.organic && serp.data.body) serp = SerpSchema.safeParse(safeJson(serp.data.body));
      if (!serp.success) {
        throw new ProviderFailure(ErrorCode.BadResponse, "SERP response was not JSON (is brd_json enabled for this zone?)", response.status);
      }
      return (serp.data.organic ?? []).slice(0, req.limit).map((r) => ({ url: r.link, title: r.title ?? r.link, snippet: r.description ?? "" }));
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
