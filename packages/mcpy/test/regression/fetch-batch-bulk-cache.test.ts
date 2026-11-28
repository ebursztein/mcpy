/**
 * Regression (2026-11-27, deepmine): a batch started at most 6 requests at once, its pacing
 * limit, and each lookup reached KV on its own: a batch of 64 cached headers made 64 KV
 * round trips before it could answer, though nothing needed the site. The batch now looks
 * every request up at once (KV reads issued together share one bulk get), and only the
 * requests the cache cannot answer wait for a slot (6 at once, 4 per site).
 * Never delete these.
 */

import { describe, expect, it } from "vitest";
import { CacheStatus, FETCH_BATCH_MAX_REQUESTS, LayeredCache } from "mcpy";
import { direct } from "mcpy/providers";
import { fakeKv, responseAt, stubFetch, testMcpy } from "../helpers.js";

const urls = Array.from({ length: FETCH_BATCH_MAX_REQUESTS }, (_, i) => `https://node.example.org/header/${i}`);

function cachedSite() {
  const kv = fakeKv();
  const { fetch, calls } = stubFetch((url) => responseAt(url, JSON.stringify({ url }), { headers: { "content-type": "application/json" } }));
  // memory: false, so every lookup goes to KV, as it does on a fresh isolate.
  const { mcpy } = testMcpy({ pages: [direct()], fetch, cache: new LayeredCache({ kv, memory: false }) });
  return { mcpy, kv, calls };
}

describe("fetch_batch reads the cache in bulk", () => {
  it("answers 64 cached requests with one bulk KV get, sending nothing", async () => {
    const { mcpy, kv, calls } = cachedSite();
    await mcpy.fetchBatch({ requests: urls.map((url) => ({ url })) });
    expect(calls).toHaveLength(64);
    kv.bulkGets.length = 0;

    const out = await mcpy.fetchBatch({ requests: urls.map((url) => ({ url })) });
    expect(out.meta.cache_hits).toBe(64);
    expect(calls).toHaveLength(64);
    expect(kv.bulkGets).toHaveLength(1);
    expect(kv.bulkGets[0]).toHaveLength(64);
  });

  it("answers the hits at once while the misses wait for a slot", async () => {
    const { mcpy, kv, calls } = cachedSite();
    await mcpy.fetchBatch({ requests: urls.slice(0, 32).map((url) => ({ url })) });
    kv.bulkGets.length = 0;
    const out = await mcpy.fetchBatch({ requests: urls.map((url) => ({ url })) });
    expect(out.results.map((r) => ("result" in r ? r.result.meta.cache : "error"))).toEqual([...Array(32).fill(CacheStatus.Hit), ...Array(32).fill(CacheStatus.Miss)]);
    expect(calls).toHaveLength(64);
    // The 64 page lookups share the first bulk get; the misses' later reads (site routes) come after.
    expect(kv.bulkGets[0]).toHaveLength(64);
  });
});

/**
 * Regression (2026-11-27, owner): the cache is one per isolate, shared by every request it
 * serves, and gathering reads over a few turns of the event loop let one request's reads join
 * another's bulk get. A Worker's I/O belongs to the request that started it and is cancelled
 * when that request ends, so the joining read could fail or hang. Reads are gathered per
 * request (its request id), never across.
 */
describe("bulk KV gets stay within one request", () => {
  it("never puts two requests' reads in one get, and still gathers each one's", async () => {
    const { mcpy, kv } = cachedSite();
    const [a, b] = [mcpy.with({ requestId: "request-a" }), mcpy.with({ requestId: "request-b" })];
    await Promise.all([
      a.fetchBatch({ requests: urls.slice(0, 3).map((url) => ({ url })) }),
      b.fetchBatch({ requests: urls.slice(3, 5).map((url) => ({ url })) }),
    ]);
    const pageGets = kv.bulkGets.filter((keys) => keys.some((k) => k.includes(":page:")));
    expect(pageGets.map((keys) => keys.length).sort()).toEqual([2, 3]);
  });

  it("reads alone for the admin's cache inspection", async () => {
    const kv = fakeKv();
    const { mcpy } = testMcpy({ cache: new LayeredCache({ kv, memory: false }) });
    await Promise.all([mcpy.inspectCache("v2:page:x"), mcpy.inspectCache("v2:page:y")]);
    expect(kv.bulkGets).toEqual([["v2:page:x"], ["v2:page:y"]]);
  });
});
