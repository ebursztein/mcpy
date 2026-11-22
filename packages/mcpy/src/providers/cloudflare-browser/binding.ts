import { htmlTitle, htmlToMarkdown } from "../../content/extract.js";
import { ContentKind, ErrorCode, PageFormat } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { forwardedUserAgent, ProviderId, type PageProvider } from "../types.js";

/** One page for the host's browser to open. */
export interface BrowserRenderRequest {
  url: string;
  /** Undefined: the browser's own user agent. */
  userAgent?: string;
  headers?: Record<string, string>;
  /** Extra time after the page loads, in ms. */
  waitMs: number;
  /** Time left for the whole attempt, in ms. */
  timeoutMs: number;
  signal: AbortSignal;
}

/** What the browser rendered. */
export interface RenderedPage {
  /** HTTP status of the main document (0 when the browser did not get one). */
  status: number;
  finalUrl: string;
  title?: string;
  html: string;
}

/**
 * Opens a page in a real browser. The host supplies it, e.g. a Worker with
 * the Browser Rendering binding and @cloudflare/puppeteer, so the SDK itself
 * depends on no browser library.
 */
export type BrowserRender = (req: BrowserRenderRequest) => Promise<RenderedPage>;

export interface CloudflareBrowserBindingOptions {
  render: BrowserRender;
  costPerCall?: number;
}

/**
 * Cloudflare Browser Rendering through a Workers binding: the same browser as
 * the REST API, with no API token. Like the other hosted browsers, it follows
 * redirects on its own side, outside mcpy's address guard.
 */
export function cloudflareBrowserBinding(options: CloudflareBrowserBindingOptions): PageProvider {
  return {
    id: ProviderId.CloudflareBrowser,
    // About 7 s of browser time a page (measured 2026-11-21) at $0.09 an hour, after 10 free hours a month.
    costPerCall: options.costPerCall ?? 0.0005,
    capabilities: { render: true, headers: true },
    async fetchPage(req, call) {
      let page: RenderedPage;
      try {
        page = await options.render({
          url: req.url,
          userAgent: forwardedUserAgent(req, call),
          headers: req.headers,
          waitMs: req.waitMs ?? 0,
          timeoutMs: call.timeoutMs,
          signal: call.context.signal,
        });
      } catch (err) {
        if (err instanceof ProviderFailure) throw err;
        throw new ProviderFailure(ErrorCode.UpstreamFailed, `browser: ${err instanceof Error ? err.message : String(err)}`);
      }
      const base = { url: req.url, finalUrl: page.finalUrl || req.url, status: page.status, contentType: "text/html", kind: ContentKind.Html };
      if (req.format === PageFormat.Html) {
        return { ...base, title: page.title || htmlTitle(page.html), content: page.html, format: PageFormat.Html };
      }
      const { title, markdown } = htmlToMarkdown(page.html, base.finalUrl);
      return { ...base, title: page.title || title, content: markdown, format: PageFormat.Markdown };
    },
  };
}
