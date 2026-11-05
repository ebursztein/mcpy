/**
 * 2026-11-05: deepmine read a 65k WooCommerce JSON page in two parts. The
 * first part (fresh) came from a new copy; the second (offset 50000) came
 * from an older 12k copy still in the cache, so the parts did not join.
 * The shared cache entry is written after the response and KV may serve an
 * older copy for a while, so parts now name the copy they come from.
 * Never delete these.
 */

import { describe, expect, it } from "vitest";
import { ErrorCode, MemoryCache, type Cache } from "mcpy";
import { fakePages, page, testMcpy } from "../helpers.js";

const URL = "https://shop.example/wp-json/products?page=3";
const NEW = page({ url: URL, finalUrl: URL, content: "n".repeat(250) });
const OLD = page({ url: URL, finalUrl: URL, content: "o".repeat(120), title: "Old copy" });

/** A cache whose page entries lag: reads keep serving the copy stored first, like a stale KV edge. */
function laggingCache(): Cache {
  const inner = new MemoryCache();
  return {
    get: (key) => inner.get(key),
    put: async (key, value, ttl) => {
      if (key.includes(":page:") && (await inner.get(key))) return;
      await inner.put(key, value, ttl);
    },
  };
}

describe("page part regressions", () => {
  it("later parts come from the same copy as the first, even when the cache still holds an older one", async () => {
    let current = OLD;
    const { mcpy } = testMcpy({ pages: [fakePages("direct", () => current)], cache: laggingCache() });
    await mcpy.fetch({ url: URL, max_chars: 100 }); // the old copy lands in the cache
    current = NEW;
    const first = await mcpy.fetch({ url: URL, fresh: true, max_chars: 100 });
    expect(first.total_chars).toBe(250);
    expect(first.version).toMatch(/^[0-9a-f]{16}$/);
    const second = await mcpy.fetch({ url: URL, offset: first.next_offset, version: first.version, max_chars: 100 });
    expect(second.total_chars).toBe(250);
    expect(second.content).toBe("n".repeat(100));
    expect(second.version).toBe(first.version);
  });

  it("a part whose copy is gone fails clearly instead of mixing copies", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("direct", NEW)] });
    await expect(mcpy.fetch({ url: URL, offset: 100, version: "0123456789abcdef", max_chars: 100 })).rejects.toMatchObject({ code: ErrorCode.VersionExpired });
  });

  it("finds the copy in the shared entry when its pin has not arrived", async () => {
    const pinsLost: Cache = (() => {
      const inner = new MemoryCache();
      return { get: (k) => inner.get(k), put: (k, v, t) => (k.startsWith("pin:") ? Promise.resolve() : inner.put(k, v, t)) };
    })();
    const direct = fakePages("direct", NEW);
    const { mcpy } = testMcpy({ pages: [direct], cache: pinsLost });
    const first = await mcpy.fetch({ url: URL, max_chars: 100 });
    const second = await mcpy.fetch({ url: URL, offset: 100, version: first.version, max_chars: 100 });
    expect(second.total_chars).toBe(250);
    expect(direct.calls.length).toBe(1);
  });

  it("a page that fits in one part carries no version and pins nothing", async () => {
    const keys: string[] = [];
    const inner = new MemoryCache();
    const cache: Cache = { get: (k) => inner.get(k), put: (k, v, t) => (keys.push(k), inner.put(k, v, t)) };
    const { mcpy } = testMcpy({ pages: [fakePages("direct", NEW)], cache });
    const r = await mcpy.fetch({ url: URL, max_chars: 1000 });
    expect(r.version).toBeUndefined();
    expect(keys.filter((k) => k.startsWith("pin:"))).toEqual([]);
  });
});
