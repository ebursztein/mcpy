import { describe, expect, it } from "vitest";
import { ContentKind, ErrorCode, PageFormat, USER_AGENTS, UserAgentProfile } from "mcpy";
import { cloudflareBrowser, ProviderId } from "mcpy/providers";
import { fixture, fixtureJson, stubFetch } from "../helpers.js";
import { failureOf, json, providerCall, TIMEOUT_MS } from "./call.js";

const ACCOUNT = "023e105f4ecef8ad9ca31a8372d0c353";
const TOKEN = "cf-test-token";
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/browser-run`;
const TARGET = "https://example.com/blog/circuit-breakers";
const provider = () => cloudflareBrowser({ accountId: ACCOUNT, apiToken: TOKEN });
const req = (format: PageFormat = PageFormat.Markdown, userAgent: UserAgentProfile = UserAgentProfile.Default) => ({ url: TARGET, format, userAgent });

describe("cloudflare browser run contract", () => {
  it("identifies itself", () => {
    expect(provider().id).toBe(ProviderId.CloudflareBrowser);
    expect(provider().costPerCall).toBeGreaterThan(0);
  });

  it("POSTs to /markdown with Bearer auth, the user agent and goto options", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("browser-run-markdown.json")));
    await provider().fetchPage(req(PageFormat.Markdown, UserAgentProfile.Safari), providerCall(fetch));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/markdown`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(calls[0].body).toEqual({
      url: TARGET,
      userAgent: USER_AGENTS[UserAgentProfile.Safari],
      gotoOptions: { waitUntil: "networkidle2", timeout: TIMEOUT_MS },
    });
  });

  it("caps the goto timeout at 60 s", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("browser-run-markdown.json")));
    await provider().fetchPage(req(), { ...providerCall(fetch), timeoutMs: 120_000 });
    expect((calls[0].body as { gotoOptions: { timeout: number } }).gotoOptions.timeout).toBe(60_000);
  });

  it("strips YAML frontmatter and takes the title from it", async () => {
    const { fetch } = stubFetch(() => json(fixtureJson("browser-run-markdown.json")));
    const page = await provider().fetchPage(req(), providerCall(fetch));
    // No `meta` in the fixture: the target status is unknown (0), not assumed 200.
    expect(page).toMatchObject({ url: TARGET, finalUrl: TARGET, status: 0, contentType: "text/markdown", kind: ContentKind.Html, format: PageFormat.Markdown });
    expect(page.title).toBe("Understanding Circuit Breakers");
    expect(page.content.startsWith("# Understanding Circuit Breakers")).toBe(true);
    expect(page.content).not.toContain("---");
    expect(page.content).not.toMatch(/^title:/m);
  });

  it("prefers meta (final URL, status, title) when Browser Run reports it", async () => {
    const body = { ...fixtureJson<object>("browser-run-markdown.json"), meta: { finalUrl: "https://www.example.com/x", status: 203, title: "Meta title" } };
    const { fetch } = stubFetch(() => json(body));
    const page = await provider().fetchPage(req(), providerCall(fetch));
    expect(page).toMatchObject({ finalUrl: "https://www.example.com/x", status: 203, title: "Meta title" });
  });

  it("uses /content for HTML and reads the title from <title>", async () => {
    const html = fixture("article.html");
    const { fetch, calls } = stubFetch(() => json({ success: true, result: html, errors: [] }));
    const page = await provider().fetchPage(req(PageFormat.Html), providerCall(fetch));
    expect(calls[0].url).toBe(`${BASE}/content`);
    expect(page).toMatchObject({ format: PageFormat.Html, contentType: "text/html", content: html });
    expect(page.title).toBe("Understanding Circuit Breakers | Example Engineering Blog");
  });

  it("honors a custom apiBase with {account} substitution", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("browser-run-markdown.json")));
    await cloudflareBrowser({ accountId: "acc", apiToken: TOKEN, apiBase: "https://proxy.example.net/{account}/br" }).fetchPage(req(), providerCall(fetch));
    expect(calls[0].url).toBe("https://proxy.example.net/acc/br/markdown");
  });

  it("maps a 429 rate limit (code 2001) to upstream_failed with the status and error text", async () => {
    const { fetch } = stubFetch(() => json(fixtureJson("browser-run-error.json"), 429));
    const failure = await failureOf(provider().fetchPage(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.UpstreamFailed);
    expect(failure.status).toBe(429);
    expect(failure.message).toContain("2001 Rate limit exceeded");
  });

  // Regression (fixed): cloudflare-browser/index.ts:248 parses with BrowserRunResponseSchema before checking the status, and
  // schemas.ts:283 types `result` as string|undefined. The standard Cloudflare v4 error envelope carries
  // `"result": null`, so a real 429 surfaces as bad_response (status kept) instead of upstream_failed.
  // Fix: `result: z.string().nullish()` (and check the status before strict parsing).
  it("maps a 429 with the standard v4 envelope (result: null) to upstream_failed", async () => {
    const body = { ...fixtureJson<object>("browser-run-error.json"), messages: [], result: null };
    const { fetch } = stubFetch(() => json(body, 429));
    const failure = await failureOf(provider().fetchPage(req(), providerCall(fetch)));
    expect([failure.code, failure.status]).toEqual([ErrorCode.UpstreamFailed, 429]);
  });

  // Regression (fixed): same root cause: http.json() (http/client.ts:603) throws bad_response for any non-JSON body before
  // the provider sees the status, so a gateway error page (HTTP 502/503 HTML) is not reported as upstream_failed.
  it("maps a non-JSON HTTP 503 error page to upstream_failed", async () => {
    const { fetch } = stubFetch(() => new Response("<html>503 Service Unavailable</html>", { status: 503 }));
    const failure = await failureOf(provider().fetchPage(req(), providerCall(fetch)));
    expect([failure.code, failure.status]).toEqual([ErrorCode.UpstreamFailed, 503]);
  });

  it("treats success:false on HTTP 200 as upstream_failed", async () => {
    const { fetch } = stubFetch(() => json({ success: false, errors: [{ code: 5006, message: "navigation timeout" }] }));
    const failure = await failureOf(provider().fetchPage(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.UpstreamFailed);
    expect(failure.message).toContain("navigation timeout");
  });

  it("treats a success without a result as upstream_failed", async () => {
    const { fetch } = stubFetch(() => json({ success: true }));
    const failure = await failureOf(provider().fetchPage(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.UpstreamFailed);
    expect(failure.message).toBe("HTTP 200");
  });

  it.each([
    ["non-JSON", "<html>502 Bad Gateway</html>"],
    ["wrong shape", { success: "yes", result: 42 }],
  ])("maps a %s body to bad_response", async (_name, body) => {
    const { fetch } = stubFetch(() => json(body));
    const failure = await failureOf(provider().fetchPage(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.BadResponse);
  });
});
