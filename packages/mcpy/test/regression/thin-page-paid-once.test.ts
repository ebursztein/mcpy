/**
 * Regression (2026-11-27, production): every fetch of https://example.com cost $0.0005. The
 * site answered 200 with its real page, but its text is under 200 characters, so mcpy took it
 * for a JavaScript shell and paid a browser to render it; the browser returned the same page.
 * A thin page nothing improved on was never cached, so every call paid the browser again.
 * A 200 is now the site's answer however short: served from the first source and cached.
 * Rendering happens when the caller asks for it (render: true). Never delete these.
 */

import { describe, expect, it } from "vitest";
import { ContentKind } from "mcpy";
import { direct } from "mcpy/providers";
import { fakePages, page, responseAt, stubFetch, testMcpy } from "../helpers.js";

const URL = "https://example.com/";
/** example.com's page as it is served: 528 bytes of HTML, about 130 characters of text. */
const EXAMPLE_HTML = `<!doctype html><html lang="en"><head><title>Example Domain</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{background:#eee;width:60vw;margin:15vh auto;font-family:system-ui,sans-serif}h1{font-size:1.5em}div{opacity:0.8}a:link,a:visited{color:#348}</style></head><body><div><h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission. Avoid use in operations.</p><p><a href="https://iana.org/domains/example">Learn more</a></p></div></body></html>`;

describe("example.com: a short 200 page", () => {
  it("is served by the direct fetch, never paid for, and cached", async () => {
    const { fetch } = stubFetch((url) => responseAt(url, EXAMPLE_HTML, { headers: { "content-type": "text/html; charset=UTF-8" } }));
    const browser = fakePages("cloudflare_browser", page(), 0.0005);
    const { mcpy } = testMcpy({ pages: [direct(), browser], fetch });

    const first = await mcpy.fetch({ url: URL });
    expect(first.title).toBe("Example Domain");
    expect(first.content).toContain("This domain is for use in documentation examples");
    expect(first.meta.cost_usd).toBe(0);
    const again = await mcpy.fetch({ url: URL });
    expect(again.meta).toMatchObject({ cache: "hit", cost_usd: 0 });
    expect(browser.calls).toHaveLength(0);
  });

  it("is rendered only when the caller asks", async () => {
    const browser = fakePages("cloudflare_browser", page({ url: URL, finalUrl: URL }), 0.0005);
    (browser as { capabilities?: object }).capabilities = { render: true };
    const { mcpy } = testMcpy({ pages: [fakePages("direct", page({ kind: ContentKind.Html, content: "Example Domain" })), browser] });
    await mcpy.fetch({ url: URL });
    expect(browser.calls).toHaveLength(0);
    const rendered = await mcpy.fetch({ url: URL, render: true });
    expect(rendered.meta.cost_usd).toBe(0.0005);
  });
});
