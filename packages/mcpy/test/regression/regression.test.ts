/**
 * One test per bug found so far. Each names the bug; never delete one.
 */

import { describe, expect, it } from "vitest";
import { CacheStatus, ErrorCode, MAX_SNIPPET_CHARS, McpyError, PageFormat, UserAgentProfile } from "mcpy";
import { brightData, direct } from "mcpy/providers";
import { Telemetry } from "mcpy/telemetry";
import { HttpClient } from "../../src/http/client.js";
import { USER_AGENTS } from "../../src/http/user-agents.js";
import { fakePages, fakeSearch, LONG_TEXT, page, responseAt, stubFetch, testMcpy } from "../helpers.js";

function call(fetch: typeof globalThis.fetch) {
  return {
    http: new HttpClient({ fetch, retry: { retries: 0, baseDelayMs: 1, maxDelayMs: 1 } }),
    context: { signal: new AbortController().signal, deadlineAt: Date.now() + 10_000, maxBytes: 1_000_000, telemetry: Telemetry.noop() },
    userAgent: (p: UserAgentProfile) => USER_AGENTS[p],
    timeoutMs: 5_000,
  };
}

const req = { url: "https://example.com/post", format: PageFormat.Markdown, userAgent: UserAgentProfile.Mcpy };

describe("regressions", () => {
  it("#1 title is read from frontmatter when a site serves markdown directly", async () => {
    const { fetch } = stubFetch((url) =>
      responseAt(url, "---\ntitle: Cloudflare Blog\n---\n\n# Posts", { headers: { "content-type": "text/markdown" } }),
    );
    const result = await direct().fetchPage(req, call(fetch));
    expect(result.title).toBe("Cloudflare Blog");
    expect(result.content).toBe("# Posts");
  });

  it("#2 relative links in extracted markdown are made absolute", async () => {
    const html = `<html><head><title>T</title></head><body><article><p>${LONG_TEXT}</p><a href="/next">next</a></article></body></html>`;
    const { fetch } = stubFetch((url) => responseAt(url, html, { headers: { "content-type": "text/html" } }));
    const result = await direct().fetchPage(req, call(fetch));
    expect(result.content).toContain("](https://example.com/next)");
  });

  it("#3 search snippets that are whole markdown sections are collapsed and clipped", async () => {
    const huge = `# Heading\n\n${"word ".repeat(2_000)}`;
    const { mcpy } = testMcpy({ search: [fakeSearch("s", [{ url: "https://a.example", title: "A", snippet: huge }])] });
    const result = await mcpy.search({ query: "q" });
    expect(result.results[0].snippet.length).toBeLessThanOrEqual(MAX_SNIPPET_CHARS);
    expect(result.results[0].snippet).not.toContain("\n");
  });

  it("#4 a private URL is the caller's error (invalid_target), not an upstream failure", async () => {
    const provider = fakePages("p", page());
    const { mcpy } = testMcpy({ pages: [provider] });
    const err = await mcpy.fetch({ url: "http://127.0.0.1/admin" }).catch((e) => e);
    expect(err).toBeInstanceOf(McpyError);
    expect(err.code).toBe(ErrorCode.InvalidTarget);
    expect(err.httpStatus).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it("#5 Bright Data requests carry no undocumented `headers` field", async () => {
    const { fetch, calls } = stubFetch((url) => responseAt(url, JSON.stringify({ status_code: 200, headers: {}, body: "<html></html>" })));
    await brightData({ apiKey: "k", zone: "z" }).fetchPage(req, call(fetch));
    expect(calls[0].body).toEqual({ zone: "z", url: req.url, format: "json" });
  });

  it("#6 a definitive 404 does not pay for a fallback provider", async () => {
    const free = fakePages("free", page({ status: 404 }));
    const paid = fakePages("paid", page(), 0.01);
    const { mcpy } = testMcpy({ pages: [free, paid] });
    const result = await mcpy.fetch({ url: "https://example.com/missing" });
    expect(result.status).toBe(404);
    expect(paid.calls).toHaveLength(0);
  });

  it("#7 blocked pages are never cached", async () => {
    let blocked = true;
    const flaky = fakePages("flaky", () => (blocked ? page({ status: 403 }) : page()));
    const { mcpy } = testMcpy({ pages: [flaky] });
    await expect(mcpy.fetch({ url: "https://example.com/a" })).rejects.toThrow();
    blocked = false;
    const result = await mcpy.fetch({ url: "https://example.com/a" });
    expect(result.meta.cache).toBe(CacheStatus.Miss);
    expect(flaky.calls).toHaveLength(2);
  });

  it("#8 failures never reveal provider names to callers", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("firecrawl", new Error("firecrawl exploded"))] });
    const err = (await mcpy.fetch({ url: "https://example.com/a" }).catch((e) => e)) as McpyError;
    expect(JSON.stringify(err.toJSON())).not.toMatch(/firecrawl/);
  });
});
