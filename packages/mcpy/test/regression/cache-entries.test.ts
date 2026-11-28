/**
 * 2026-11-27, cache refactor: the engine served whatever its cache returned
 * under a page key, unchecked. A malformed entry (a bad write, an older
 * shape under the same key) was handed to callers as a page. Every entry is
 * now read through cache/shared.ts, which validates the envelope and, for
 * every space, the fields its values cannot do without. Never delete these.
 */
import { describe, expect, it } from "vitest";
import { CacheStatus, LayeredCache, PageFormat, UserAgentProfile } from "mcpy";
import { cacheKey } from "../../src/cache/spaces.js";
import { pageCacheId } from "../../src/engine/page-request.js";
import { PageSpace, SearchSpace, SiteRouteSpace } from "../../src/engine/spaces.js";
import { fakeKv, fakePages, fakeSearch, page, testMcpy } from "../helpers.js";

const URL = "https://shop.example/a";
const KEY = async () => cacheKey(PageSpace, await pageCacheId({ url: URL, format: PageFormat.Markdown, userAgent: UserAgentProfile.Default }));

describe("cache entries are checked on the way out", () => {
  it("refetches, with a warning, a page entry missing page fields instead of serving it", async () => {
    const kv = fakeKv();
    kv.data.set(await KEY(), JSON.stringify({ value: { content: "half a page" }, provider: "p", storedAt: Date.now() }));
    const cache = new LayeredCache({ kv });
    const direct = fakePages("direct", page({ content: "the real page ".repeat(40) }));
    const { mcpy, sink } = testMcpy({ pages: [direct], cache });
    const r = await mcpy.fetch({ url: URL });
    expect(r.meta.cache).toBe(CacheStatus.Miss);
    expect(r.content).toContain("the real page");
    expect(direct.calls.length).toBe(1);
    expect(sink.logs.some((l) => l.level === "warn" && l.attributes["mcpy.cache.event"] === "invalid")).toBe(true);
  });

  it("still serves page entries written before the refactor (same key, same envelope)", async () => {
    const kv = fakeKv();
    const old = page({ content: "cached copy ".repeat(40) });
    kv.data.set(await KEY(), JSON.stringify({ value: old, provider: "p", storedAt: Date.now() }));
    const cache = new LayeredCache({ kv });
    const direct = fakePages("direct", page());
    const { mcpy } = testMcpy({ pages: [direct], cache });
    const r = await mcpy.fetch({ url: URL });
    expect(r.meta.cache).toBe(CacheStatus.Hit);
    expect(direct.calls.length).toBe(0);
  });

  it("searches again, instead of serving, a search entry whose hits lack required fields", async () => {
    const search = fakeSearch("s", [{ url: "https://a.example", title: "A", snippet: "a" }]);
    const kv = fakeKv();
    // No memory layer: the corrupted KV entry below must be what the second call reads.
    const { mcpy } = testMcpy({ search: [search], cache: new LayeredCache({ kv, memory: false }) });
    await mcpy.search({ query: "rust" });
    const key = kv.puts.find((k) => k.startsWith(cacheKey(SearchSpace, "")));
    expect(key).toBeDefined();
    // Same key, hits without `sources`: the shape an older or broken write could leave.
    kv.data.set(key!, JSON.stringify({ value: [{ url: "https://a.example", title: "A", snippet: "a" }], provider: "s", storedAt: Date.now() }));
    const again = await mcpy.search({ query: "rust" });
    expect(again.meta.cache).toBe(CacheStatus.Miss);
    expect(search.calls).toBe(2);
  });

  it("keeps a learned site route under the route space", async () => {
    const kv = fakeKv();
    const { mcpy } = testMcpy({ pages: [fakePages("direct", page({ status: 403 })), fakePages("paid", page(), 0.001)], cache: new LayeredCache({ kv }) });
    await mcpy.fetch({ url: URL });
    expect(JSON.parse(kv.data.get(cacheKey(SiteRouteSpace, "markdown:shop.example"))!)).toMatchObject({ value: "paid" });
  });
});
