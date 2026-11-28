import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LayeredCache } from "mcpy";
import { MemorySink, Telemetry } from "mcpy/telemetry";
import { CacheEvent, CacheReads, SharedCache, type CacheContext } from "../../src/cache/shared.js";
import { CACHE_VERSIONS, CacheName, cacheKey, cacheSpace } from "../../src/cache/spaces.js";
import { fakeKv } from "../helpers.js";

const Routes = cacheSpace(CacheName.SiteRoute, z.string().min(1));
const Counts = cacheSpace(CacheName.Search, z.object({ n: z.number() }));

function setup(store: LayeredCache = new LayeredCache()) {
  const sink = new MemorySink();
  const ctx: CacheContext = { telemetry: new Telemetry([sink], {}, "debug") };
  const events = () => sink.logs.map((l) => l.attributes["mcpy.cache.event"]);
  return { cache: new SharedCache(store), store, sink, ctx, events };
}

describe("cache keys", () => {
  it("are v<version>:<name>:<id>, with the version from the inventory", () => {
    expect(cacheKey(Routes, "html:shop.example")).toBe(`v${CACHE_VERSIONS.route}:route:html:shop.example`);
  });

  it("every space has a positive integer version", () => {
    for (const name of Object.values(CacheName)) expect(Number.isInteger(CACHE_VERSIONS[name]) && CACHE_VERSIONS[name] > 0, name).toBe(true);
  });
});

describe("SharedCache", () => {
  afterEach(() => vi.useRealTimers());

  it("returns what it stored, with its provider and write time, and reports miss, stored, hit", async () => {
    const { cache, ctx, events, sink } = setup();
    expect(await cache.read(Routes, "a", ctx)).toBeUndefined();
    await cache.write(Routes, "a", "paid", 60, ctx, "src");
    const hit = await cache.read(Routes, "a", ctx);
    expect(hit).toMatchObject({ value: "paid", provider: "src" });
    expect(typeof hit?.storedAt).toBe("number");
    expect(events()).toEqual([CacheEvent.Miss, CacheEvent.Stored, CacheEvent.Hit]);
    expect(sink.logs[1].attributes).toMatchObject({ "mcpy.cache.name": "route", "mcpy.cache.key": cacheKey(Routes, "a"), "mcpy.cache.ttl_s": 60 });
    expect(sink.logs[2].attributes["mcpy.cache.age_s"]).toBe(0);
  });

  it("misses an entry older than max_age, and skips the read at 0", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T00:00:00Z") });
    const { cache, ctx, events, sink } = setup();
    await cache.write(Routes, "a", "paid", 3_600, ctx);
    vi.setSystemTime(new Date("2026-11-27T00:10:00Z"));
    expect(await cache.read(Routes, "a", ctx, 300)).toBeUndefined();
    expect(sink.logs.at(-1)?.attributes["mcpy.cache.age_s"]).toBe(600);
    expect(await cache.read(Routes, "a", ctx, 0)).toBeUndefined();
    expect(await cache.read(Routes, "a", ctx, 900)).toMatchObject({ value: "paid" });
    expect(events()).toEqual([CacheEvent.Stored, CacheEvent.Stale, CacheEvent.Bypass, CacheEvent.Hit]);
  });

  it("serves an entry written before write times were recorded at any max_age", async () => {
    const { cache, store, ctx } = setup();
    await store.write(cacheKey(Counts, "old"), { value: { n: 1 }, provider: "p" }, 60);
    expect(await cache.read(Counts, "old", ctx, 1)).toMatchObject({ value: { n: 1 }, provider: "p" });
  });

  it("misses, with a warning, a value its space's schema rejects or a raw non-envelope value", async () => {
    const { cache, store, ctx, sink } = setup();
    await store.write(cacheKey(Routes, "bad"), { value: "", storedAt: Date.now() }, 60);
    await store.write(cacheKey(Routes, "raw"), "paid", 60);
    expect(await cache.read(Routes, "bad", ctx)).toBeUndefined();
    expect(await cache.read(Routes, "raw", ctx)).toBeUndefined();
    expect(sink.logs.map((l) => [l.level, l.attributes["mcpy.cache.event"]])).toEqual([
      ["warn", CacheEvent.Invalid],
      ["warn", CacheEvent.Invalid],
    ]);
  });

  it("never throws: a backend failure is a reported miss or a reported lost write", async () => {
    const { cache, ctx, sink } = setup(new LayeredCache({ kv: fakeKv({ failing: true }), memory: false }));
    expect(await cache.read(Routes, "a", ctx)).toBeUndefined();
    await expect(cache.write(Routes, "a", "p", 60, ctx)).resolves.toBeUndefined();
    expect(sink.logs.map((l) => [l.level, l.attributes["mcpy.cache.event"], l.attributes["exception.message"]])).toEqual([
      ["warn", CacheEvent.Failed, "kv down"],
      ["warn", CacheEvent.Failed, "kv down"],
    ]);
  });

  it("hands the write to defer when the context has one, and awaits it otherwise", async () => {
    const { cache, ctx, store } = setup();
    const deferred: Promise<unknown>[] = [];
    await cache.write(Routes, "a", "p", 60, { ...ctx, defer: (w) => deferred.push(w) });
    expect(deferred).toHaveLength(1);
    await deferred[0];
    expect((await store.read(cacheKey(Routes, "a")))?.value).toMatchObject({ value: "p" });
  });

  it("names the layer behind each hit, and counts a call's reads by layer", async () => {
    const kv = fakeKv();
    const { cache, ctx, sink } = setup(new LayeredCache({ kv }));
    const reads = new CacheReads();
    const counted = { ...ctx, reads };
    await new SharedCache(new LayeredCache({ kv })).write(Routes, "a", "p", 60);
    await cache.read(Routes, "a", counted); // from KV, then kept in memory
    await cache.read(Routes, "a", counted); // from memory
    await cache.read(Routes, "none", counted);
    await cache.read(Routes, "a", counted, 0); // bypass: not a read
    expect(sink.logs.filter((l) => l.attributes["mcpy.cache.event"] === "hit").map((l) => l.attributes["mcpy.cache.tier"])).toEqual(["kv", "memory"]);
    expect(reads.attributes()).toEqual({ "mcpy.cache.reads.memory": 1, "mcpy.cache.reads.kv": 1, "mcpy.cache.reads.missed": 1 });
  });

  it("reports nothing without a context", async () => {
    const { cache, sink } = setup();
    await cache.write(Routes, "a", "p", 60);
    expect(await cache.read(Routes, "a")).toMatchObject({ value: "p" });
    expect(sink.logs).toEqual([]);
  });
});

describe("cache inspection", () => {
  it("names a key's space and version, longest name first, and whether the code still reads it", async () => {
    const { parseCacheKey } = await import("../../src/cache/inspect.js");
    expect(parseCacheKey("v3:crypto:coin:abc")).toEqual({ name: "crypto:coin", version: 3 });
    expect(parseCacheKey("v1:route:html:a.example")).toEqual({ name: "route", version: 1 });
    expect(parseCacheKey("route:v1:html:a.example")).toBeUndefined();
    expect(parseCacheKey("v1:unknown:x")).toBeUndefined();
  });

  it("shows an entry's provider, age and value, truncated past INSPECT_MAX_CHARS, and flags an old version", async () => {
    const { INSPECT_MAX_CHARS } = await import("../../src/cache/inspect.js");
    const { cache, ctx } = setup();
    await cache.write(Counts, "a", { n: 1 }, 60, ctx, "src");
    expect(await cache.inspect(cacheKey(Counts, "a"))).toMatchObject({ name: "search", current: true, found: true, envelope: true, provider: "src", age_s: 0, value_json: '{"n":1}', truncated: false });
    await cache.write(Routes, "big", "x".repeat(INSPECT_MAX_CHARS + 10), 60, ctx);
    const big = await cache.inspect(cacheKey(Routes, "big"));
    expect([big.truncated, big.value_json?.length]).toEqual([true, INSPECT_MAX_CHARS]);
    expect((await cache.inspect("v1:page:old")).current).toBe(false);
  });

  it("reports a backend failure instead of throwing", async () => {
    const { cache } = setup(new LayeredCache({ kv: fakeKv({ failing: true }), memory: false }));
    expect(await cache.inspect("v2:page:x")).toMatchObject({ found: false, error: "kv down" });
  });
});
