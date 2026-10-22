import { htmlTitle, htmlToMarkdown } from "../../content/extract.js";
import { contentKindOf } from "../../content/kind.js";
import { ErrorCode, PageFormat } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { HttpMethod } from "../../http/client.js";
import { ProviderId, type PageProvider } from "../types.js";
import { UnlockerEnvelopeSchema } from "./schemas.js";
import { API, fail, safeJson, type BrightDataOptions } from "./shared.js";

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
    // Measured live: 2-38 s per request. As the last fallback it is worth the wait.
    attemptTimeoutMs: 45_000,
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
      const base = { url: req.url, finalUrl: req.url, status: envelope.status_code ?? 0, contentType, kind: contentKindOf(contentType) };
      if (req.format === PageFormat.Html || !/html/i.test(contentType)) {
        return { ...base, title: htmlTitle(body), content: body, format: req.format };
      }
      const { title, markdown } = htmlToMarkdown(body, req.url);
      return { ...base, title, content: markdown, format: PageFormat.Markdown };
    },
  };
}
