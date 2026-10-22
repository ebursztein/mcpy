import { describe, expect, it } from "vitest";
import { CacheStatus, ErrorCode, McpyError, PageFormat, UserAgentProfile } from "mcpy";
import { fakePages, fakeSearch, LONG_TEXT, page, testMcpy } from "../helpers.js";

const URL_A = "https://example.com/a";

describe("engine cache: pages", () => {
  it("misses, then hits without calling the provider again", async () => {
    const p = fakePages("p", page());
    const { mcpy } = testMcpy({ pages: [p] });
    const first = await mcpy.fetch({ url: URL_A });
    const second = await mcpy.fetch({ url: URL_A });
    expect(first.meta).toMatchObject({ cache: CacheStatus.Miss, attempts: 1 });
    expect(second.meta).toMatchObject({ cache: CacheStatus.Hit, attempts: 0 });
    expect(second.content).toBe(first.content);
    expect(p.calls).toHaveLength(1);
  });

  it("fresh: true bypasses the read, calls the provider again and refreshes the entry", async () => {
    let version = 1;
    const p = fakePages("p", () => page({ content: `v${version} ${LONG_TEXT}` }));
    const { mcpy } = testMcpy({ pages: [p] });
    await mcpy.fetch({ url: URL_A });
    version = 2;
    const fresh = await mcpy.fetch({ url: URL_A, fresh: true });
    expect(fresh.meta.cache).toBe(CacheStatus.Bypass);
    expect(fresh.content.startsWith("v2")).toBe(true);
    expect(p.calls).toHaveLength(2);

    const after = await mcpy.fetch({ url: URL_A });
    expect(after.meta.cache).toBe(CacheStatus.Hit);
    expect(after.content.startsWith("v2")).toBe(true);
  });

  it("keys the cache by format", async () => {
    const p = fakePages("p", (req) => page({ format: req.format }));
    const { mcpy } = testMcpy({ pages: [p] });
    await mcpy.fetch({ url: URL_A, format: PageFormat.Markdown });
    const html = await mcpy.fetch({ url: URL_A, format: PageFormat.Html });
    expect(html.meta.cache).toBe(CacheStatus.Miss);
    expect(html.format).toBe(PageFormat.Html);
    expect(p.calls.map((c) => c.format)).toEqual([PageFormat.Markdown, PageFormat.Html]);
  });

  it("keys the cache by user agent", async () => {
    const p = fakePages("p", page());
    const { mcpy } = testMcpy({ pages: [p] });
    await mcpy.fetch({ url: URL_A });
    const chrome = await mcpy.fetch({ url: URL_A, user_agent: UserAgentProfile.ChromeDesktop });
    expect(chrome.meta.cache).toBe(CacheStatus.Miss);
    expect((await mcpy.fetch({ url: URL_A, user_agent: UserAgentProfile.ChromeDesktop })).meta.cache).toBe(CacheStatus.Hit);
    expect(p.calls.map((c) => c.userAgent)).toEqual([UserAgentProfile.Mcpy, UserAgentProfile.ChromeDesktop]);
  });

  it("normalizes the fragment and query order to the same key", async () => {
    const p = fakePages("p", page());
    const { mcpy } = testMcpy({ pages: [p] });
    await mcpy.fetch({ url: "https://example.com/a?b=2&a=1#section" });
    const same = await mcpy.fetch({ url: "https://example.com/a?a=1&b=2" });
    expect(same.meta.cache).toBe(CacheStatus.Hit);
    expect(p.calls).toHaveLength(1);
  });

  it("keeps different paths and query values apart", async () => {
    const p = fakePages("p", page());
    const { mcpy } = testMcpy({ pages: [p] });
    await mcpy.fetch({ url: "https://example.com/a?x=1" });
    expect((await mcpy.fetch({ url: "https://example.com/a?x=2" })).meta.cache).toBe(CacheStatus.Miss);
    expect((await mcpy.fetch({ url: "https://example.com/b?x=1" })).meta.cache).toBe(CacheStatus.Miss);
    expect(p.calls).toHaveLength(3);
  });

  it("never caches a challenge page that ended in failure", async () => {
    const challenge = page({ contentType: "text/html", content: `<html><head><title>Just a moment...</title></head>${LONG_TEXT}</html>` });
    const p = fakePages("p", challenge);
    const { mcpy } = testMcpy({ pages: [p] });
    for (let i = 0; i < 2; i++) {
      const err = await mcpy.fetch({ url: URL_A }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(McpyError);
      expect((err as McpyError).code).toBe(ErrorCode.UpstreamFailed);
    }
    expect(p.calls).toHaveLength(2);
  });

  it("never caches an escalated page even when a later provider succeeds", async () => {
    let blocked = true;
    const first = fakePages("first", () => (blocked ? page({ status: 403 }) : page({ content: `first ${LONG_TEXT}` })));
    const second = fakePages("second", page({ content: `second ${LONG_TEXT}` }));
    const { mcpy } = testMcpy({ pages: [first, second] });
    const served = await mcpy.fetch({ url: URL_A });
    expect(served.content.startsWith("second")).toBe(true);
    expect(served.meta.attempts).toBe(2);
    // The usable page from `second` is what got cached.
    blocked = false;
    const hit = await mcpy.fetch({ url: URL_A });
    expect(hit.meta.cache).toBe(CacheStatus.Hit);
    expect(hit.content.startsWith("second")).toBe(true);
  });

  it("returns a 404 page as a result and caches it", async () => {
    const p = fakePages("p", page({ status: 404, content: "Not found" }));
    const { mcpy } = testMcpy({ pages: [p] });
    const first = await mcpy.fetch({ url: URL_A });
    expect(first.status).toBe(404);
    expect(first.content).toBe("Not found");
    const second = await mcpy.fetch({ url: URL_A });
    expect(second).toMatchObject({ status: 404, meta: { cache: CacheStatus.Hit } });
    expect(p.calls).toHaveLength(1);
  });

  it("shares the page cache between fetch and grep", async () => {
    const p = fakePages("p", page({ content: `alpha\nbeta\n${LONG_TEXT}` }));
    const { mcpy } = testMcpy({ pages: [p] });
    await mcpy.fetch({ url: URL_A });
    const grep = await mcpy.grep({ url: URL_A, pattern: "beta" });
    expect(grep.meta.cache).toBe(CacheStatus.Hit);
    expect(p.calls).toHaveLength(1);
  });
});

describe("engine cache: search", () => {
  const hits = [{ url: "https://a.example/", title: "A", snippet: "about a" }];

  it("caches results per query and limit", async () => {
    const s = fakeSearch("s", hits);
    const { mcpy } = testMcpy({ search: [s] });
    expect((await mcpy.search({ query: "cats" })).meta.cache).toBe(CacheStatus.Miss);
    const hit = await mcpy.search({ query: "cats" });
    expect(hit.meta).toMatchObject({ cache: CacheStatus.Hit, attempts: 0 });
    expect(hit.results).toHaveLength(1);
    expect(s.calls).toBe(1);

    expect((await mcpy.search({ query: "cats", limit: 3 })).meta.cache).toBe(CacheStatus.Miss);
    expect(s.calls).toBe(2);
  });

  it("treats queries case-insensitively", async () => {
    const s = fakeSearch("s", hits);
    const { mcpy } = testMcpy({ search: [s] });
    await mcpy.search({ query: "Cats" });
    expect((await mcpy.search({ query: "cats" })).meta.cache).toBe(CacheStatus.Hit);
  });

  it("caches an empty result list (any search answer is final)", async () => {
    const s = fakeSearch("s", []);
    const { mcpy } = testMcpy({ search: [s] });
    await mcpy.search({ query: "nothing" });
    const again = await mcpy.search({ query: "nothing" });
    expect(again).toMatchObject({ results: [], meta: { cache: CacheStatus.Hit } });
    expect(s.calls).toBe(1);
  });

  it("fresh: true bypasses the search cache", async () => {
    const s = fakeSearch("s", hits);
    const { mcpy } = testMcpy({ search: [s] });
    await mcpy.search({ query: "cats" });
    expect((await mcpy.search({ query: "cats", fresh: true })).meta.cache).toBe(CacheStatus.Bypass);
    expect(s.calls).toBe(2);
  });
});

describe("engine user agents", () => {
  it("uses the mcpy profile by default", async () => {
    const p = fakePages("p", page());
    const { mcpy } = testMcpy({ pages: [p] });
    await mcpy.fetch({ url: URL_A });
    expect(p.calls[0].userAgent).toBe(UserAgentProfile.Mcpy);
  });

  it("takes the default from createMcpy and lets each call override it", async () => {
    const p = fakePages("p", page());
    const { mcpy } = testMcpy({ pages: [p], userAgent: { default: UserAgentProfile.ChromeDesktop } });
    await mcpy.fetch({ url: URL_A });
    await mcpy.fetch({ url: "https://example.com/b", user_agent: UserAgentProfile.Googlebot });
    await mcpy.grep({ url: "https://example.com/c", pattern: "x", user_agent: UserAgentProfile.SafariDesktop });
    expect(p.calls.map((c) => c.userAgent)).toEqual([UserAgentProfile.ChromeDesktop, UserAgentProfile.Googlebot, UserAgentProfile.SafariDesktop]);
  });

  it("resolves profiles to header strings, honoring a custom mcpy string", async () => {
    const seen: string[] = [];
    const p = {
      id: "p",
      costPerCall: 0,
      async fetchPage(_req: unknown, call: { userAgent(profile: UserAgentProfile): string }) {
        seen.push(call.userAgent(UserAgentProfile.Mcpy), call.userAgent(UserAgentProfile.Googlebot));
        return page();
      },
    };
    const { mcpy } = testMcpy({ pages: [p], userAgent: { mcpyString: "acme-bot/1.0 (+https://acme.example)" } });
    await mcpy.fetch({ url: URL_A });
    expect(seen[0]).toBe("acme-bot/1.0 (+https://acme.example)");
    expect(seen[1]).toMatch(/Googlebot/);
  });
});
