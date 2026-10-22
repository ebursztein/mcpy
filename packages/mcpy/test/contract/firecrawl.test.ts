import { describe, expect, it } from "vitest";
import { ErrorCode, PageFormat, USER_AGENTS, UserAgentProfile } from "mcpy";
import { firecrawl, firecrawlSearch, ProviderId } from "mcpy/providers";
import { fixtureJson, stubFetch } from "../helpers.js";
import { failureOf, json, providerCall, TIMEOUT_MS } from "./call.js";

const KEY = "fc-test-key";
const TARGET = "https://example.com/blog/circuit-breakers";
type Scrape = { success: boolean; data: { markdown: string; rawHtml?: string; metadata: Record<string, unknown> } };
const scrape = () => fixtureJson<Scrape>("firecrawl-scrape.json");
const req = (format: PageFormat = PageFormat.Markdown) => ({ url: TARGET, format, userAgent: UserAgentProfile.Default });

describe("firecrawl scrape contract", () => {
  it("identifies itself", () => {
    expect(firecrawl({ apiKey: KEY }).id).toBe(ProviderId.Firecrawl);
  });

  it("POSTs /v2/scrape with Bearer auth and a markdown request that bypasses Firecrawl's cache", async () => {
    const { fetch, calls } = stubFetch(() => json(scrape()));
    await firecrawl({ apiKey: KEY }).fetchPage(req(), providerCall(fetch));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(calls[0].body).toMatchObject({ url: TARGET, formats: ["markdown"], onlyMainContent: true, timeout: TIMEOUT_MS, maxAge: 0 });
    expect(calls[0].body).toMatchObject({ headers: { "User-Agent": USER_AGENTS[UserAgentProfile.Default] } });
  });

  it("asks for rawHtml of the whole page in HTML mode", async () => {
    const body = scrape();
    body.data.rawHtml = "<html><body>raw</body></html>";
    const { fetch, calls } = stubFetch(() => json(body));
    const page = await firecrawl({ apiKey: KEY }).fetchPage(req(PageFormat.Html), providerCall(fetch));
    expect(calls[0].body).toMatchObject({ formats: ["rawHtml"], onlyMainContent: false });
    expect(page.content).toBe("<html><body>raw</body></html>");
    expect(page.format).toBe(PageFormat.Html);
  });

  it("clamps the timeout to Firecrawl's 1 s .. 300 s range", async () => {
    const { fetch, calls } = stubFetch(() => json(scrape()));
    const p = firecrawl({ apiKey: KEY });
    await p.fetchPage(req(), { ...providerCall(fetch), timeoutMs: 10 });
    await p.fetchPage(req(), { ...providerCall(fetch), timeoutMs: 900_000 });
    expect(calls.map((c) => (c.body as { timeout: number }).timeout)).toEqual([1_000, 300_000]);
  });

  it("uses a self-hosted apiUrl without a double slash", async () => {
    const { fetch, calls } = stubFetch(() => json(scrape()));
    await firecrawl({ apiKey: KEY, apiUrl: "https://fc.internal.example.com/" }).fetchPage(req(), providerCall(fetch));
    expect(calls[0].url).toBe("https://fc.internal.example.com/v2/scrape");
  });

  it("parses the page: final URL from metadata.url, target status, content type and title", async () => {
    const { fetch } = stubFetch(() => json(scrape()));
    const page = await firecrawl({ apiKey: KEY }).fetchPage(req(), providerCall(fetch));
    expect(page).toEqual({
      url: TARGET,
      finalUrl: "https://www.example.com/blog/circuit-breakers",
      status: 200,
      contentType: "text/html; charset=utf-8",
      kind: "html",
      title: "Understanding Circuit Breakers | Example Engineering Blog",
      content: scrape().data.markdown,
      format: PageFormat.Markdown,
    });
  });

  it("normalizes an array title to its first entry", async () => {
    const body = scrape();
    body.data.metadata.title = ["Understanding Circuit Breakers", "Example Engineering Blog"];
    const { fetch } = stubFetch(() => json(body));
    const page = await firecrawl({ apiKey: KEY }).fetchPage(req(), providerCall(fetch));
    expect(page.title).toBe("Understanding Circuit Breakers");
  });

  it("falls back to sourceURL, status 0 and a default content type when metadata is sparse", async () => {
    const body = { success: true, data: { markdown: "hi", metadata: { sourceURL: TARGET, title: "" } } };
    const { fetch } = stubFetch(() => json(body));
    const page = await firecrawl({ apiKey: KEY }).fetchPage(req(), providerCall(fetch));
    // Without metadata the source is assumed to be a web page (HTML).
    expect(page).toMatchObject({ finalUrl: TARGET, status: 0, contentType: "text/html", content: "hi" });
    expect(page.title).toBeUndefined();
  });

  it("reports the target's status (e.g. 404) without failing", async () => {
    const body = scrape();
    body.data.metadata = { ...body.data.metadata, statusCode: 404, error: "Not Found" };
    const { fetch } = stubFetch(() => json(body));
    const page = await firecrawl({ apiKey: KEY }).fetchPage(req(), providerCall(fetch));
    expect(page.status).toBe(404);
  });

  it("maps 402 (out of credits) to upstream_failed with the status and message", async () => {
    const { fetch } = stubFetch(() => json(fixtureJson("firecrawl-error-402.json"), 402));
    const failure = await failureOf(firecrawl({ apiKey: KEY }).fetchPage(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.UpstreamFailed);
    expect(failure.status).toBe(402);
    expect(failure.message).toMatch(/^HTTP 402: Insufficient credits/);
  });

  it.each([429, 500])("maps a JSON error body with HTTP %i to upstream_failed, keeping the code", async (status) => {
    const { fetch } = stubFetch(() => json({ success: false, error: "boom", code: "SCRAPE_FAILED" }, status));
    const failure = await failureOf(firecrawl({ apiKey: KEY }).fetchPage(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.UpstreamFailed);
    expect(failure.status).toBe(status);
    expect(failure.message).toBe("SCRAPE_FAILED: boom");
  });

  // Regression (fixed): firecrawl/index.ts:396 uses http.json(), which throws bad_response on a non-JSON body
  // (http/client.ts:603) before check() sees the status, so an HTML 502 from a proxy or load balancer
  // in front of Firecrawl is reported as bad_response instead of upstream_failed. Fix: check
  // response.status >= 400 before strict parsing (as brightdata/index.ts:138 does).
  it("maps a non-JSON HTTP 502 error page to upstream_failed", async () => {
    const { fetch } = stubFetch(() => new Response("<html><h1>502 Bad Gateway</h1></html>", { status: 502 }));
    const failure = await failureOf(firecrawl({ apiKey: KEY }).fetchPage(req(), providerCall(fetch)));
    expect([failure.code, failure.status]).toEqual([ErrorCode.UpstreamFailed, 502]);
  });

  it("maps success:false on HTTP 200 to upstream_failed", async () => {
    const { fetch } = stubFetch(() => json({ success: false, error: "All scraping engines failed" }));
    const failure = await failureOf(firecrawl({ apiKey: KEY }).fetchPage(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.UpstreamFailed);
  });

  it.each([
    ["non-JSON", "upstream connect error"],
    ["wrong shape", { success: true, data: { markdown: 42 } }],
    ["missing success", { data: { markdown: "x" } }],
  ])("maps a %s body to bad_response", async (_name, body) => {
    const { fetch } = stubFetch(() => json(body));
    const failure = await failureOf(firecrawl({ apiKey: KEY }).fetchPage(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.BadResponse);
  });
});

describe("firecrawl search contract", () => {
  it("POSTs /v2/search with the query, limit and timeout", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("firecrawl-search.json")));
    await firecrawlSearch({ apiKey: KEY }).search({ query: "circuit breaker pattern", type: "web", limit: 3, page: 1 }, providerCall(fetch));
    expect(calls[0].url).toBe("https://api.firecrawl.dev/v2/search");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(calls[0].body).toEqual({ query: "circuit breaker pattern", limit: 3, sources: [{ type: "web" }], timeout: TIMEOUT_MS });
  });

  it("truncates very long queries to 500 characters", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("firecrawl-search.json")));
    await firecrawlSearch({ apiKey: KEY }).search({ query: "q".repeat(800), type: "web", limit: 5, page: 1 }, providerCall(fetch));
    expect((calls[0].body as { query: string }).query).toHaveLength(500);
  });

  it("maps web results, defaulting a missing title to the URL", async () => {
    const { fetch } = stubFetch(() => json(fixtureJson("firecrawl-search.json")));
    const hits = await firecrawlSearch({ apiKey: KEY }).search({ query: "circuit breaker", type: "web", limit: 10, page: 1 }, providerCall(fetch));
    expect(hits).toEqual([
      {
        url: "https://example.com/blog/circuit-breakers",
        title: "Understanding Circuit Breakers",
        snippet: "A circuit breaker stops a client from hammering a dependency that is already failing.",
      },
      {
        url: "https://martinfowler.com/bliki/CircuitBreaker.html",
        title: "CircuitBreaker",
        snippet: "It is common for software systems to make remote calls to software running in different processes.",
      },
      { url: "https://example.org/patterns/no-title", title: "https://example.org/patterns/no-title", snippet: "A catalog of resilience patterns." },
    ]);
  });

  it("returns no hits when data.web is absent", async () => {
    const { fetch } = stubFetch(() => json({ success: true, data: {} }));
    expect(await firecrawlSearch({ apiKey: KEY }).search({ query: "x", type: "web", limit: 5, page: 1 }, providerCall(fetch))).toEqual([]);
  });

  it("maps 402 to upstream_failed and malformed hits to bad_response", async () => {
    const credits = stubFetch(() => json(fixtureJson("firecrawl-error-402.json"), 402));
    const f1 = await failureOf(firecrawlSearch({ apiKey: KEY }).search({ query: "x", type: "web", limit: 5, page: 1 }, providerCall(credits.fetch)));
    expect([f1.code, f1.status]).toEqual([ErrorCode.UpstreamFailed, 402]);

    const bad = stubFetch(() => json({ success: true, data: { web: [{ title: "no url" }] } }));
    const f2 = await failureOf(firecrawlSearch({ apiKey: KEY }).search({ query: "x", type: "web", limit: 5, page: 1 }, providerCall(bad.fetch)));
    expect(f2.code).toBe(ErrorCode.BadResponse);
  });
});
