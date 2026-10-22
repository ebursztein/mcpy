import { describe, expect, it } from "vitest";
import { ErrorCode, PageFormat, USER_AGENTS, UserAgentProfile } from "mcpy";
import { direct, ProviderId } from "mcpy/providers";
import { fixture, responseAt, stubFetch } from "../helpers.js";
import { failureOf, providerCall } from "./call.js";

const URL_IN = "https://example.com/blog/circuit-breakers";
const URL_FINAL = "https://www.example.com/blog/circuit-breakers";
const ARTICLE = fixture("article.html");
const HTML = { "content-type": "text/html; charset=utf-8" };

const req = (format: PageFormat = PageFormat.Markdown, userAgent: UserAgentProfile = UserAgentProfile.Mcpy) => ({ url: URL_IN, format, userAgent });

describe("direct provider contract", () => {
  it("identifies itself and is free", () => {
    const p = direct();
    expect(p.id).toBe(ProviderId.Direct);
    expect(p.costPerCall).toBe(0);
  });

  it("sends a GET with the profile's user agent and a markdown-first Accept", async () => {
    const { fetch, calls } = stubFetch(() => responseAt(URL_FINAL, ARTICLE, { headers: HTML }));
    await direct().fetchPage(req(), providerCall(fetch));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(URL_IN);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.get("user-agent")).toBe(USER_AGENTS[UserAgentProfile.Mcpy]);
    expect(calls[0].headers.get("accept")).toMatch(/^text\/markdown/);
    expect(calls[0].headers.get("authorization")).toBeNull();
    expect(calls[0].body).toBeUndefined();
  });

  it("extracts HTML into markdown with the title, final URL and target status", async () => {
    const { fetch } = stubFetch(() => responseAt(URL_FINAL, ARTICLE, { headers: HTML }));
    const page = await direct().fetchPage(req(), providerCall(fetch));
    expect(page).toMatchObject({ url: URL_IN, finalUrl: URL_FINAL, status: 200, contentType: HTML["content-type"], format: PageFormat.Markdown });
    expect(page.title).toContain("Understanding Circuit Breakers");
    expect(page.content).toContain("## Why fail fast");
    expect(page.content).toContain("Count only failures that a retry would not fix.");
    // Relative links are made absolute against the final URL; chrome is dropped.
    expect(page.content).toContain("https://www.example.com/blog/retries");
    expect(page.content).not.toContain("window.analytics");
    expect(page.content).not.toContain("<p>");
  });

  it("returns the raw HTML when asked for HTML, with an HTML Accept header", async () => {
    const { fetch, calls } = stubFetch(() => responseAt(URL_FINAL, ARTICLE, { headers: HTML }));
    const page = await direct().fetchPage(req(PageFormat.Html), providerCall(fetch));
    expect(calls[0].headers.get("accept")).toMatch(/^text\/html/);
    expect(page.format).toBe(PageFormat.Html);
    expect(page.content).toBe(ARTICLE);
    expect(page.title).toBe("Understanding Circuit Breakers | Example Engineering Blog");
  });

  it("passes markdown through, stripping YAML frontmatter into the title", async () => {
    const md = '---\ntitle: "Agents welcome"\ndescription: served as markdown\n---\n\n# Agents welcome\n\nBody text.\n';
    const { fetch } = stubFetch(() => responseAt(URL_IN, md, { headers: { "content-type": "text/markdown; charset=utf-8" } }));
    const page = await direct().fetchPage(req(), providerCall(fetch));
    expect(page.title).toBe("Agents welcome");
    expect(page.content).toBe("# Agents welcome\n\nBody text.\n");
    expect(page.format).toBe(PageFormat.Markdown);
  });

  it("passes plain text and JSON through untouched", async () => {
    const { fetch } = stubFetch(() => responseAt(URL_IN, '{"ok":true}', { headers: { "content-type": "application/json" } }));
    const page = await direct().fetchPage(req(), providerCall(fetch));
    expect(page.content).toBe('{"ok":true}');
    expect(page.title).toBeUndefined();
  });

  it.each([401, 403])("retries once with the chrome_desktop profile on HTTP %i", async (status) => {
    const { fetch, calls } = stubFetch((_u, n) =>
      n === 1 ? responseAt(URL_IN, "denied", { status, headers: { "content-type": "text/plain" } }) : responseAt(URL_FINAL, ARTICLE, { headers: HTML }),
    );
    const page = await direct().fetchPage(req(), providerCall(fetch));
    expect(calls.map((c) => c.headers.get("user-agent"))).toEqual([USER_AGENTS[UserAgentProfile.Mcpy], USER_AGENTS[UserAgentProfile.ChromeDesktop]]);
    expect(page.status).toBe(200);
  });

  it("returns the blocked page when the browser retry is blocked too (the engine escalates)", async () => {
    const { fetch, calls } = stubFetch(() => responseAt(URL_IN, "<html><title>Forbidden</title></html>", { status: 403, headers: HTML }));
    const page = await direct().fetchPage(req(), providerCall(fetch));
    expect(calls).toHaveLength(2);
    expect(page.status).toBe(403);
  });

  it("does not retry when the caller already uses the retry profile", async () => {
    const { fetch, calls } = stubFetch(() => responseAt(URL_IN, "denied", { status: 403, headers: { "content-type": "text/plain" } }));
    await direct().fetchPage(req(PageFormat.Markdown, UserAgentProfile.ChromeDesktop), providerCall(fetch));
    expect(calls).toHaveLength(1);
  });

  it("does not retry when blockedRetryProfile is null, and honors a custom profile", async () => {
    const blocked = () => responseAt(URL_IN, "denied", { status: 401, headers: { "content-type": "text/plain" } });
    const off = stubFetch(blocked);
    await direct({ blockedRetryProfile: null }).fetchPage(req(), providerCall(off.fetch));
    expect(off.calls).toHaveLength(1);

    const custom = stubFetch(blocked);
    await direct({ blockedRetryProfile: UserAgentProfile.FirefoxDesktop }).fetchPage(req(), providerCall(custom.fetch));
    expect(custom.calls[1].headers.get("user-agent")).toBe(USER_AGENTS[UserAgentProfile.FirefoxDesktop]);
  });

  it("does not retry other client errors and reports 404 as the target status", async () => {
    const { fetch, calls } = stubFetch(() => responseAt(URL_IN, "<html><title>Not Found</title><body>gone</body></html>", { status: 404, headers: HTML }));
    const page = await direct().fetchPage(req(), providerCall(fetch));
    expect(calls).toHaveLength(1);
    expect(page.status).toBe(404);
  });

  it("rejects binary content as unsupported_content with the status", async () => {
    const { fetch } = stubFetch(() => responseAt(URL_IN, new Uint8Array([0x25, 0x50, 0x44, 0x46]), { headers: { "content-type": "application/pdf" } }));
    const failure = await failureOf(direct().fetchPage(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.UnsupportedContent);
    expect(failure.status).toBe(200);
  });

  it("maps a network failure to upstream_failed", async () => {
    const { fetch } = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const failure = await failureOf(direct().fetchPage(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.UpstreamFailed);
  });
});
