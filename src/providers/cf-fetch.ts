import { htmlTitle, htmlToMarkdown, splitFrontmatter } from "../lib/extract";
import { isHtml, isTextual, readTextCapped } from "../lib/http";
import { ProviderError, type FetchProvider, type ProviderFactory } from "./types";

/**
 * Plain fetch from the Worker. Free and fast; fails on JS-rendered pages and
 * on sites that block datacenter traffic, which is what the chain is for.
 * Asks for markdown first: sites that support content negotiation for agents
 * return it directly and skip local extraction.
 */
export const cfFetch: ProviderFactory<FetchProvider> = {
  id: "cf_fetch",
  create({ config, fetch }) {
    return {
      id: "cf_fetch",
      costPerCall: 0,
      async fetch(req, signal) {
        const res = await fetch(req.url, {
          headers: {
            "User-Agent": config.userAgent,
            Accept:
              req.format === "markdown"
                ? "text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.5"
                : "text/html, */*;q=0.5",
          },
          redirect: "follow",
          signal,
        });

        const contentType = res.headers.get("content-type") ?? "";
        if (!isTextual(contentType)) {
          await res.body?.cancel();
          throw new ProviderError("cf_fetch", `unsupported content type: ${contentType}`, res.status);
        }
        const body = await readTextCapped(res, config.maxResponseBytes);
        const base = { url: req.url, finalUrl: res.url || req.url, status: res.status, contentType };

        if (isHtml(contentType)) {
          if (req.format === "html") {
            return { ...base, title: htmlTitle(body), content: body, format: "html" };
          }
          const { title, markdown } = htmlToMarkdown(body, base.finalUrl);
          return { ...base, title, content: markdown, format: "markdown" };
        }
        if (/markdown/i.test(contentType)) {
          const { title, body: md } = splitFrontmatter(body);
          return { ...base, title, content: md, format: req.format };
        }
        // Plain text, JSON, ...: already readable as-is.
        return { ...base, content: body, format: req.format };
      },
    };
  },
};
