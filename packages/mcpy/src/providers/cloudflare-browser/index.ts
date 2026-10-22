import { htmlTitle, splitFrontmatter } from "../../content/extract.js";
import { ContentKind, ErrorCode, PageFormat } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { HttpMethod } from "../../http/client.js";
import { ProviderId, type PageProvider } from "../types.js";
import { BrowserRunResponseSchema } from "./schemas.js";

export interface CloudflareBrowserOptions {
  accountId: string;
  /** API token with Browser Run edit permission. */
  apiToken: string;
  /** Override the API base; "{account}" is substituted. */
  apiBase?: string;
  costPerCall?: number;
}

// Browser Run (formerly Browser Rendering) quick actions.
const DEFAULT_BASE = "https://api.cloudflare.com/client/v4/accounts/{account}/browser-run";
const MAX_GOTO_TIMEOUT_MS = 60_000;

/** Cloudflare Browser Run: a real headless browser, for JS-rendered pages. */
export function cloudflareBrowser(options: CloudflareBrowserOptions): PageProvider {
  const base = (options.apiBase || DEFAULT_BASE).replace("{account}", options.accountId);
  return {
    id: ProviderId.CloudflareBrowser,
    costPerCall: options.costPerCall ?? 0.0005,
    async fetchPage(req, call) {
      const endpoint = req.format === PageFormat.Html ? "content" : "markdown";
      const { response, data } = await call.http.json(
        {
          url: `${base}/${endpoint}`,
          method: HttpMethod.Post,
          headers: { Authorization: `Bearer ${options.apiToken}` },
          json: {
            url: req.url,
            userAgent: call.userAgent(req.userAgent),
            gotoOptions: { waitUntil: "networkidle2", timeout: Math.min(call.timeoutMs, MAX_GOTO_TIMEOUT_MS) },
          },
        },
        BrowserRunResponseSchema,
        call.context,
      );
      if (response.status >= 400 || !data.success || typeof data.result !== "string") {
        const msg = data.errors?.map((e) => `${e.code} ${e.message}`).join("; ") || `HTTP ${response.status}`;
        throw new ProviderFailure(ErrorCode.UpstreamFailed, msg, response.status);
      }

      const meta = data.meta ?? {};
      // Rendered from HTML by a real browser; status 0 when Browser Run does not report it.
      const common = { url: req.url, finalUrl: meta.finalUrl ?? req.url, status: meta.status ?? 0, kind: ContentKind.Html };
      if (req.format === PageFormat.Html) {
        return { ...common, contentType: "text/html", title: meta.title ?? htmlTitle(data.result), content: data.result, format: PageFormat.Html };
      }
      const { title, body } = splitFrontmatter(data.result);
      return { ...common, contentType: "text/markdown", title: meta.title ?? title, content: body.trim(), format: PageFormat.Markdown };
    },
  };
}
