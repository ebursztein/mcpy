/**
 * Regressions for the reliability findings of the Fable review (2026-10-22).
 * Numbers match the review. Never delete one.
 */

import { describe, expect, it } from "vitest";
import { CacheStatus, ContentKind, EMPTY_SEARCH_TTL_SECONDS, ErrorCode, KvCache, MemoryCache, type Cache } from "mcpy";
import { direct } from "mcpy/providers";
import { fakePages, fakeSearch, LONG_TEXT, page, responseAt, stubFetch, testMcpy } from "../helpers.js";

const URL_A = "https://example.com/a";

describe("#3 short but valid pages are served, not escalated to failure", () => {
  it.each([
    ["text/plain", "User-agent: *\nDisallow:\n"],
    ["application/json", '{"ok":true}'],
  ])("serves a short %s response from the free provider", async (contentType, body) => {
    const { fetch } = stubFetch((url) => responseAt(url, body, { headers: { "content-type": contentType } }));
    const paid = fakePages("paid", page(), 0.01);
    const { mcpy } = testMcpy({ pages: [direct(), paid], fetch });
    const r = await mcpy.fetch({ url: "https://example.com/robots.txt" });
    expect(r.content).toBe(body);
    expect(paid.calls).toHaveLength(0);
  });

  it("returns a thin HTML page when no provider does better, without caching it", async () => {
    const thin = fakePages("thin", page({ kind: ContentKind.Html, content: "Hello." }));
    const alsoThin = fakePages("also", page({ kind: ContentKind.Html, content: "Hello!" }));
    const { mcpy } = testMcpy({ pages: [thin, alsoThin] });
    const first = await mcpy.fetch({ url: URL_A });
    expect(first.content).toBe("Hello.");
    const second = await mcpy.fetch({ url: URL_A });
    expect(second.meta.cache).toBe(CacheStatus.Miss);
  });
});

describe("#4 target problems never open a provider's circuit", () => {
  it("keeps using the free provider after many blocked sites", async () => {
    const free = fakePages("free", (req) => (req.url.includes("blocked") ? page({ status: 403 }) : page()));
    const paid = fakePages("paid", page(), 0.01);
    const { mcpy } = testMcpy({ pages: [free, paid], breaker: { failureThreshold: 1, cooldownMs: 60_000 } });
    for (let i = 0; i < 5; i++) await mcpy.fetch({ url: `https://blocked${i}.example/` });
    paid.calls.length = 0;
    await mcpy.fetch({ url: "https://fine.example/" });
    expect(free.calls.at(-1)?.url).toBe("https://fine.example/");
    expect(paid.calls).toHaveLength(0);
  });

  it("never opens the direct provider's circuit, even on thrown errors", async () => {
    const { fetch } = stubFetch((url) => {
      if (url.includes("down")) throw new TypeError("fetch failed");
      return responseAt(url, `<html><title>ok</title><body><article>${LONG_TEXT}</article></body></html>`, { headers: { "content-type": "text/html" } });
    });
    const paid = fakePages("paid", page(), 0.01);
    const { mcpy } = testMcpy({ pages: [direct(), paid], fetch, breaker: { failureThreshold: 1, cooldownMs: 60_000 }, retry: { retries: 0 } });
    await mcpy.fetch({ url: "https://down.example/" });
    paid.calls.length = 0;
    await mcpy.fetch({ url: "https://up.example/" });
    expect(paid.calls).toHaveLength(0);
  });
});

describe("#5 challenge detection uses structure, not keywords", () => {
  it("does not escalate an article about bot detection", async () => {
    const article = `# How DataDome and PerimeterX work\n\nAccess denied\n\nSites ask you to verify you are human. ${LONG_TEXT}`;
    const paid = fakePages("paid", page(), 0.01);
    const { mcpy } = testMcpy({ pages: [fakePages("free", page({ content: article, title: "Bot detection explained" })), paid] });
    await mcpy.fetch({ url: URL_A });
    expect(paid.calls).toHaveLength(0);
  });

  it("escalates a real Cloudflare challenge going through direct -> markdown", async () => {
    const challenge = `<!DOCTYPE html><html><head><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></head><body><noscript>Enable JavaScript and cookies to continue</noscript></body></html>`;
    const { fetch } = stubFetch((url) => responseAt(url, challenge, { status: 200, headers: { "content-type": "text/html" } }));
    const paid = fakePages("paid", page(), 0.01);
    const { mcpy } = testMcpy({ pages: [direct(), paid], fetch });
    await mcpy.fetch({ url: URL_A });
    expect(paid.calls).toHaveLength(1);
  });
});

describe("#10 attempt timeouts hold even when a provider ignores its signal", () => {
  it("moves on from a provider that never settles", async () => {
    const stuck = { id: "stuck", costPerCall: 0, fetchPage: () => new Promise<never>(() => {}) };
    const backup = fakePages("backup", page());
    const { mcpy } = testMcpy({ pages: [stuck, backup], limits: { attemptTimeoutMs: 1_000, deadlineMs: 5_000 } });
    const t = Date.now();
    const r = await mcpy.fetch({ url: URL_A });
    expect(Date.now() - t).toBeLessThan(2_500);
    expect(r.meta.attempts).toBe(2);
  });
});

describe("#11 cache writes stay off the request path when deferral is available", () => {
  it("returns before a slow cache write completes", async () => {
    let release!: () => void;
    const slow: Cache = { get: async () => null, put: () => new Promise<void>((r) => (release = r)) };
    const deferred: Promise<unknown>[] = [];
    const { mcpy } = testMcpy({ pages: [fakePages("p", page())], cache: slow });
    const r = await mcpy.with({ defer: (w) => deferred.push(w) }).fetch({ url: URL_A });
    expect(r.meta.cache).toBe(CacheStatus.Miss);
    expect(deferred).toHaveLength(1);
    release();
    await Promise.all(deferred);
  });
});

describe("#12 empty search results are not cached as long-lived answers", () => {
  it("caches zero hits briefly", async () => {
    const ttls: number[] = [];
    const recording: Cache = { get: async () => null, put: async (_k, _v, ttl) => void ttls.push(ttl) };
    const { mcpy } = testMcpy({ search: [fakeSearch("s", [])], cache: recording });
    await mcpy.search({ query: "nothing" });
    expect(ttls).toEqual([EMPTY_SEARCH_TTL_SECONDS]);
  });
});

describe("#15 cache implementations", () => {
  it("MemoryCache evicts the least recently used entry", async () => {
    const c = new MemoryCache(2);
    await c.put("a", 1, 60);
    await c.put("b", 2, 60);
    await c.get("a"); // a is now most recent
    await c.put("c", 3, 60);
    expect(await c.get("a")).toBe(1);
    expect(await c.get("b")).toBeNull();
  });

  it("KvCache enforces KV's minimum TTL, measures bytes, and never throws", async () => {
    const puts: { key: string; ttl?: number }[] = [];
    const kv = {
      get: async () => {
        throw new Error("kv down");
      },
      put: async (key: string, _v: string, o?: { expirationTtl?: number }) => void puts.push({ key, ttl: o?.expirationTtl }),
    };
    const c = new KvCache(kv);
    await c.put("k", { a: 1 }, 5);
    expect(puts).toEqual([{ key: "k", ttl: 60 }]);
    expect(await c.get("k")).toBeNull();
    // 7M three-byte characters: ~21 MB in UTF-8, under 20 MB as UTF-16 units.
    await c.put("big", "€".repeat(7_000_000), 60);
    expect(puts).toHaveLength(1);
  });

  it("records the target host on operation spans", async () => {
    const { mcpy, sink } = testMcpy({ pages: [fakePages("p", page())] });
    await mcpy.fetch({ url: "https://host.example/x" });
    const op = sink.spans.find((s) => s.name === "mcpy.operation");
    expect(op?.attributes["mcpy.target.host"]).toBe("host.example");
  });

  it("maps unsupported content to its own error code", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("p", new (await import("mcpy/providers")).ProviderFailure(ErrorCode.UnsupportedContent, "pdf"))] });
    expect((await mcpy.fetch({ url: URL_A }).catch((e) => e)).code).toBe(ErrorCode.UnsupportedContent);
  });
});
