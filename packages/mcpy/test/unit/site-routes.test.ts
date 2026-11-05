import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryCache, PageFormat, type Cache } from "mcpy";
import { routeOrder, siteOf } from "../../src/engine/routes.js";
import { fakePages, page, testMcpy } from "../helpers.js";

const BLOCKED = page({ status: 403 });
const GOOD = page();

/** A cache that records every key written. */
function recordingCache(): Cache & { keys: string[] } {
  const inner = new MemoryCache();
  const keys: string[] = [];
  return {
    keys,
    get: (key) => inner.get(key),
    put: (key, value, ttl) => {
      keys.push(key);
      return inner.put(key, value, ttl);
    },
  };
}

describe("site routes", () => {
  afterEach(() => vi.useRealTimers());

  it("once a paid source serves a blocked site, later pages on it skip the free ones", async () => {
    const direct = fakePages("direct", BLOCKED);
    const paid = fakePages("paid", GOOD, 0.001);
    const { mcpy } = testMcpy({ pages: [direct, paid] });
    await mcpy.fetch({ url: "https://shop.example/a" });
    await mcpy.fetch({ url: "https://shop.example/b" });
    await mcpy.fetch({ url: "https://SHOP.example/c" });
    expect([direct.calls.length, paid.calls.length]).toEqual([1, 3]);
  });

  it("keeps skipped sources as a last resort, and follows a site that unblocks", async () => {
    let paidWorks = true;
    const direct = fakePages("direct", () => (paidWorks ? BLOCKED : GOOD));
    const paid = fakePages("paid", () => (paidWorks ? GOOD : BLOCKED), 0.001);
    const { mcpy } = testMcpy({ pages: [direct, paid] });
    await mcpy.fetch({ url: "https://shop.example/a" });
    paidWorks = false;
    const r = await mcpy.fetch({ url: "https://shop.example/b" });
    expect(r.content).toContain("Lorem");
    await mcpy.fetch({ url: "https://shop.example/c" });
    // a: direct, paid. b: paid (route), then direct. c: direct only.
    expect([direct.calls.length, paid.calls.length]).toEqual([3, 2]);
  });

  it("keeps sites and formats apart", async () => {
    const direct = fakePages("direct", (req) => (req.url.includes("shop.example") && req.format === PageFormat.Markdown ? BLOCKED : GOOD));
    const paid = fakePages("paid", GOOD, 0.001);
    const { mcpy } = testMcpy({ pages: [direct, paid] });
    await mcpy.fetch({ url: "https://shop.example/a" });
    await mcpy.fetch({ url: "https://blog.example/a" });
    await mcpy.fetch({ url: "https://shop.example/b", format: PageFormat.Html });
    expect([direct.calls.length, paid.calls.length]).toEqual([3, 1]);
  });

  it("forgets a route after its TTL, so free sources get another chance", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
    const direct = fakePages("direct", BLOCKED);
    const paid = fakePages("paid", GOOD, 0.001);
    const { mcpy } = testMcpy({ pages: [direct, paid], limits: { siteRouteTtlSeconds: 3_600 } });
    await mcpy.fetch({ url: "https://shop.example/a" });
    await mcpy.fetch({ url: "https://shop.example/b" });
    expect(direct.calls.length).toBe(1);
    vi.setSystemTime(new Date("2026-11-05T01:00:01Z"));
    await mcpy.fetch({ url: "https://shop.example/c" });
    expect(direct.calls.length).toBe(2);
  });

  it("writes nothing for sites the first source serves", async () => {
    const cache = recordingCache();
    const { mcpy } = testMcpy({ pages: [fakePages("direct", GOOD), fakePages("paid", GOOD, 0.001)], cache });
    await mcpy.fetch({ url: "https://blog.example/a" });
    expect(cache.keys.filter((k) => k.startsWith("route:"))).toEqual([]);
  });
});

describe("routeOrder", () => {
  const ps = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("starts at the preferred provider and moves the skipped ones to the end", () => {
    expect(routeOrder(ps, "b").map((p) => p.id)).toEqual(["b", "c", "a"]);
  });
  it("keeps the configured order without a usable preference", () => {
    expect(routeOrder(ps, undefined).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(routeOrder(ps, "gone").map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  it("names sites by format and hostname", () => {
    expect(siteOf("https://Shop.Example:8443/x?y", PageFormat.Html)).toBe("html:shop.example");
    expect(siteOf("not a url", PageFormat.Html)).toBeUndefined();
  });
});
