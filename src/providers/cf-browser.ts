import { num } from "../config";
import { htmlTitle, splitFrontmatter } from "../lib/extract";
import { readTextCapped } from "../lib/http";
import { ProviderError, type FetchProvider, type ProviderFactory } from "./types";

interface BrowserRunResponse {
  success: boolean;
  result?: string;
  errors?: { code: number; message: string }[];
  meta?: { finalUrl?: string; status?: number; title?: string };
}

// Browser Run (formerly Browser Rendering) quick actions.
const DEFAULT_BASE = "https://api.cloudflare.com/client/v4/accounts/{account}/browser-run";

/**
 * Cloudflare Browser Run: a real headless browser, for JS-rendered pages.
 * Needs an account id and an API token with Browser Run edit permission.
 */
export const cfBrowser: ProviderFactory<FetchProvider> = {
  id: "cf_browser",
  create({ env, config, fetch }) {
    const account = env.CF_ACCOUNT_ID;
    const token = env.CF_BROWSER_API_TOKEN;
    if (!account || !token) return null;
    const base = (env.CF_BROWSER_API_BASE || DEFAULT_BASE).replace("{account}", account);

    return {
      id: "cf_browser",
      costPerCall: num(env.COST_CF_BROWSER, 0.0005),
      async fetch(req, signal) {
        const endpoint = req.format === "html" ? "content" : "markdown";
        const res = await fetch(`${base}/${endpoint}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            url: req.url,
            userAgent: config.userAgent,
            gotoOptions: { waitUntil: "networkidle2", timeout: Math.min(req.timeoutMs, 60_000) },
          }),
          signal,
        });
        const text = await readTextCapped(res, config.maxResponseBytes);
        let data: BrowserRunResponse;
        try {
          data = JSON.parse(text) as BrowserRunResponse;
        } catch {
          throw new ProviderError("cf_browser", `non-JSON response (HTTP ${res.status})`, res.status);
        }
        if (!res.ok || !data.success || typeof data.result !== "string") {
          const msg = data.errors?.map((e) => `${e.code} ${e.message}`).join("; ") || `HTTP ${res.status}`;
          throw new ProviderError("cf_browser", msg, res.status);
        }

        const meta = data.meta ?? {};
        if (endpoint === "content") {
          return {
            url: req.url,
            finalUrl: meta.finalUrl ?? req.url,
            status: meta.status ?? 200,
            contentType: "text/html",
            title: meta.title ?? htmlTitle(data.result),
            content: data.result,
            format: "html",
          };
        }
        const { title, body } = splitFrontmatter(data.result);
        return {
          url: req.url,
          finalUrl: meta.finalUrl ?? req.url,
          status: meta.status ?? 200,
          contentType: "text/markdown",
          title: meta.title ?? title,
          content: body.trim(),
          format: "markdown",
        };
      },
    };
  },
};
