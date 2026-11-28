import { afterEach, describe, expect, it, vi } from "vitest";
import { CacheTier, LayeredCache } from "mcpy";
import { KV_MAX_BULK_KEYS, MemoryStore } from "../../src/cache/store.js";
import { fakeKv, fakePages, page, testMcpy } from "../helpers.js";

describe("LayeredCache", () => {
  afterEach(() => vi.useRealTimers());

  it("serves what it wrote from memory, without reading KV", async () => {
    const kv = fakeKv();
    const cache = new LayeredCache({ kv });
    await cache.write("k", { n: 1 }, 600);
    expect(await cache.read("k")).toEqual({ value: { n: 1 }, tier: CacheTier.Memory });
    expect([kv.bulkGets.length, kv.puts]).toEqual([0, ["k"]]);
  });

  it("copies a KV hit to memory, and keeps it there only memoryTtlSeconds", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T00:00:00Z") });
    const kv = fakeKv();
    kv.data.set("k", JSON.stringify({ n: 1 }));
    const cache = new LayeredCache({ kv, memoryTtlSeconds: 60 });
    expect((await cache.read("k"))?.tier).toBe(CacheTier.Kv);
    expect((await cache.read("k"))?.tier).toBe(CacheTier.Memory);
    vi.setSystemTime(new Date("2026-11-27T00:01:01Z"));
    expect((await cache.read("k"))?.tier).toBe(CacheTier.Kv);
    expect(kv.bulkGets).toHaveLength(2);
  });

  it("never keeps an entry in memory longer than its own TTL", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T00:00:00Z") });
    const cache = new LayeredCache({ kv: fakeKv({ keep: () => false }) });
    await cache.write("k", 1, 10);
    vi.setSystemTime(new Date("2026-11-27T00:00:11Z"));
    expect(await cache.read("k")).toBeUndefined();
  });

  it("without KV keeps entries in memory for their whole TTL; with memory off too, keeps nothing", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T00:00:00Z") });
    const memoryOnly = new LayeredCache();
    await memoryOnly.write("k", 1, 3_600);
    vi.setSystemTime(new Date("2026-11-27T00:30:00Z"));
    expect(await memoryOnly.read("k")).toEqual({ value: 1, tier: CacheTier.Memory });
    const none = new LayeredCache({ memory: false });
    await none.write("k", 1, 3_600);
    expect(await none.read("k")).toBeUndefined();
  });

  it("keeps a frozen copy: changing what the writer passed or a served value changes nothing kept", async () => {
    const cache = new LayeredCache();
    const written = { rows: [1] };
    await cache.write("k", written, 600);
    written.rows.push(2);
    const served = (await cache.read("k"))!.value as { rows: number[] };
    expect(() => served.rows.push(3)).toThrow(TypeError);
    expect((await cache.read("k"))?.value).toEqual({ rows: [1] });
  });

  it("sends reads issued in the same tick to KV as one bulk get, and later ones separately", async () => {
    const kv = fakeKv();
    kv.data.set("a", "1");
    const cache = new LayeredCache({ kv });
    const [a, b, c] = await Promise.all([cache.read("a"), cache.read("b"), cache.read("c")]);
    expect([a?.value, b, c]).toEqual([1, undefined, undefined]);
    await cache.read("d");
    expect(kv.bulkGets).toEqual([["a", "b", "c"], ["d"]]);
  });

  it("splits a batch over KV's 100-key limit", async () => {
    const kv = fakeKv();
    const cache = new LayeredCache({ kv });
    await Promise.all(Array.from({ length: KV_MAX_BULK_KEYS + 5 }, (_, i) => cache.read(`k${i}`)));
    expect(kv.bulkGets.map((keys) => keys.length)).toEqual([KV_MAX_BULK_KEYS, 5]);
  });

  it("lets a KV failure through for the cache layer to report; memory still keeps the write", async () => {
    const cache = new LayeredCache({ kv: fakeKv({ failing: true }) });
    await expect(cache.read("k")).rejects.toThrow("kv down");
    await expect(cache.write("k", 1, 60)).rejects.toThrow("kv down");
    expect(await cache.read("k")).toEqual({ value: 1, tier: CacheTier.Memory });
  });
});

describe("a fetch's cache reads", () => {
  const opReads = (sink: ReturnType<typeof testMcpy>["sink"]) =>
    sink.spans
      .filter((s) => s.name === "mcpy.operation")
      .map((s) => [s.attributes["mcpy.cache.reads.memory"], s.attributes["mcpy.cache.reads.kv"], s.attributes["mcpy.cache.reads.missed"]]);

  it("reads only the page on a hit, and a missed page's route and paused flag in one KV request; counts each read's layer", async () => {
    const kv = fakeKv();
    const first = testMcpy({ pages: [fakePages("direct", page())], cache: new LayeredCache({ kv }) });
    await first.mcpy.fetch({ url: "https://shop.example/a" });
    await first.mcpy.fetch({ url: "https://shop.example/a" });
    // Another isolate: same KV, empty memory.
    const other = testMcpy({ pages: [fakePages("direct", page())], cache: new LayeredCache({ kv }) });
    await other.mcpy.fetch({ url: "https://shop.example/a" });
    const spaces = (keys: string[]) => keys.map((k) => k.split(":")[1]).sort();
    // The miss: page, then route and paused flag together. The memory hit: no KV at all. The KV hit: the page alone.
    expect(kv.bulkGets.map(spaces)).toEqual([["page"], ["paid-failed", "route"], ["page"]]);
    expect(opReads(first.sink)).toEqual([
      [0, 0, 3],
      [1, 0, 0],
    ]);
    expect(opReads(other.sink)).toEqual([[0, 1, 0]]);
  });
});

describe("the memory layer's bounds", () => {
  it("drops least recently used entries to stay under maxChars", () => {
    const c = new MemoryStore({ maxChars: 25 });
    c.put("a", "x".repeat(10), 10, 60);
    c.put("b", "y".repeat(10), 10, 60);
    c.get("a"); // a is now most recent
    c.put("c", "z".repeat(10), 10, 60);
    expect([c.get("a"), c.get("b"), c.get("c")]).toEqual(["x".repeat(10), undefined, "z".repeat(10)]);
  });

  it("keeps nothing longer than maxEntryChars", () => {
    const c = new MemoryStore({ maxEntryChars: 5 });
    c.put("big", "too long", 8, 60);
    expect(c.get("big")).toBeUndefined();
  });
});
