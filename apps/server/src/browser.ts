/**
 * Renders pages with the Browser Rendering binding (env.BROWSER) and
 * @cloudflare/puppeteer: a real Chrome run by Cloudflare, no API token.
 * One browser per page, closed when the page is read or the attempt ends.
 */

import type { BrowserRender } from "mcpy/providers";

/** The binding as puppeteer.launch takes it (a Fetcher). */
export type BrowserBindingLike = object;

/** Most time the page may spend loading before what it has is read anyway, in ms. */
const MAX_LOAD_MS = 45_000;
/** Kept back from the attempt for reading the page and closing the browser. */
const READ_MARGIN_MS = 2_000;
/** A common laptop window, so sites serve their full desktop layout. */
const DESKTOP = { width: 1366, height: 900 };

export function bindingRenderer(binding: BrowserBindingLike): BrowserRender {
  return async ({ url, userAgent, headers, waitMs, timeoutMs, signal }) => {
    // Loaded on first use: the package only runs inside workerd.
    const { default: puppeteer } = await import("@cloudflare/puppeteer");
    const browser = await puppeteer.launch(binding as Parameters<typeof puppeteer.launch>[0]);
    const close = () => void browser.close().catch(() => undefined);
    signal.addEventListener("abort", close, { once: true });
    try {
      const page = await browser.newPage();
      // Puppeteer's default 800x600 window gets smaller layouts: Goldin showed 41 prices instead of 50 (2026-11-21).
      await page.setViewport(DESKTOP);
      if (userAgent) await page.setUserAgent(userAgent);
      if (headers) await page.setExtraHTTPHeaders(headers);
      const loadMs = Math.max(1_000, Math.min(MAX_LOAD_MS, timeoutMs - waitMs - READ_MARGIN_MS));
      let response = null;
      try {
        response = await page.goto(url, { waitUntil: "networkidle2", timeout: loadMs });
      } catch (err) {
        // App pages that keep polling never go quiet: read what has rendered so far.
        if (!(err instanceof Error && err.name === "TimeoutError")) throw err;
      }
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      // A JSON, text or XML answer is returned as the server sent it: the rendered
      // page is Chrome's viewer around it (Woyouminer's JSON, 2026-11-23).
      const contentType = response?.headers()["content-type"];
      const body = response && contentType && !/text\/html|application\/xhtml/i.test(contentType) ? await response.text().catch(() => undefined) : undefined;
      return { status: response?.status() ?? 0, finalUrl: page.url(), title: await page.title(), html: await page.content(), contentType, body };
    } finally {
      signal.removeEventListener("abort", close);
      close();
    }
  };
}
