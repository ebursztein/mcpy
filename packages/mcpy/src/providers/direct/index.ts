import { htmlTitle, htmlToMarkdown, splitFrontmatter } from "../../content/extract.js";
import { contentKindOf } from "../../content/kind.js";
import { PageFormat, UserAgentProfile } from "../../enums.js";
import type { HttpResponse } from "../../http/client.js";
import { isHtml, isMarkdown, isTextual } from "../../http/url.js";
import { ProviderId, type FetchedPage, type PageProvider, type PageRequest, type ProviderCall } from "../types.js";

export interface DirectOptions {
  /**
   * When the honest user agent gets 401/403, retry once with this browser
   * profile before the engine escalates to a paid provider. `null` disables.
   */
  blockedRetryProfile?: UserAgentProfile | null;
  costPerCall?: number;
}

const BLOCKED = new Set([401, 403]);

function accept(format: PageFormat): string {
  return format === PageFormat.Markdown ? "text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.5" : "text/html, */*;q=0.5";
}

function toPage(req: PageRequest, res: HttpResponse): FetchedPage {
  // Binary types never get here: the HttpClient refuses them before download.
  const contentType = res.headers.get("content-type") ?? "";
  const base = { url: req.url, finalUrl: res.url, status: res.status, contentType, kind: contentKindOf(contentType) };
  if (isHtml(contentType)) {
    if (req.format === PageFormat.Html) return { ...base, title: htmlTitle(res.text), content: res.text, format: PageFormat.Html };
    const { title, markdown } = htmlToMarkdown(res.text, res.url);
    return { ...base, title, content: markdown, format: PageFormat.Markdown };
  }
  if (isMarkdown(contentType)) {
    const { title, body } = splitFrontmatter(res.text);
    return { ...base, title, content: body, format: req.format };
  }
  return { ...base, content: res.text, format: req.format };
}

/**
 * Plain HTTP fetch plus local extraction (mdream). Free and
 * fast; asks for markdown first so sites that serve markdown to agents skip
 * extraction. Fails on JS-rendered pages and datacenter blocks, which is
 * what the fallback chain is for.
 */
export function direct(options: DirectOptions = {}): PageProvider {
  const retryProfile = options.blockedRetryProfile === undefined ? UserAgentProfile.Chrome : options.blockedRetryProfile;

  /** The caller's own headers win over ours, User-Agent and Accept included. */
  async function send(req: PageRequest, profile: UserAgentProfile, call: ProviderCall): Promise<HttpResponse> {
    const headers = { "User-Agent": call.userAgent(profile), Accept: accept(req.format), ...req.headers };
    return call.http.send({ url: req.url, method: req.method, body: req.body, headers, acceptContentType: isTextual }, call.context);
  }

  return {
    id: ProviderId.Direct,
    costPerCall: options.costPerCall ?? 0,
    // A failing direct fetch means the target is down or blocking, not that
    // fetch is unhealthy: never open its circuit.
    circuitBreaker: false,
    capabilities: { post: true, headers: true },
    async fetchPage(req, call) {
      let res = await send(req, req.userAgent, call);
      const ownAgent = Object.keys(req.headers ?? {}).some((name) => name.toLowerCase() === "user-agent");
      if (BLOCKED.has(res.status) && retryProfile && retryProfile !== req.userAgent && !ownAgent) {
        res = await send(req, retryProfile, call);
      }
      return toPage(req, res);
    },
  };
}
