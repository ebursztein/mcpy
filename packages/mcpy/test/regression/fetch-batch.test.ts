/**
 * Regression (2026-11-27, deepmine): a coin's live read is many requests: ZEC's 114 block headers,
 * Monero's window pages, 7 price sources. Each one was its own call to mcpy (a round trip each),
 * so deepmine kept its own store to avoid repeating them. A batch of up to 64 sends them in one
 * call (each still counts against the per-key rate limit, on the server): each request is a fetch of its own (cache, max_age, free_only,
 * spending cap) and answers on its own, in order; one failing never fails the others.
 * Never delete these.
 */

import { describe, expect, it } from "vitest";
import { CacheStatus, ErrorCode, FETCH_BATCH_CONCURRENCY, FETCH_BATCH_MAX_REQUESTS, FETCH_BATCH_PER_SITE, HttpMethod, runFetchBatch } from "mcpy";
import { direct } from "mcpy/providers";
import { fakePages, page, responseAt, stubFetch, testMcpy } from "../helpers.js";

const NODE = "https://node.example.org/rpc";
const header = (height: number) => ({ url: NODE, method: HttpMethod.Post, body: JSON.stringify({ method: "getblockheader", params: [height] }), max_age: 86_400 });

function site() {
  const { fetch, calls } = stubFetch((url, n, init) => {
    if (url.includes("down.example.org")) throw new TypeError("fetch failed");
    return responseAt(url, JSON.stringify({ asked: init?.body ?? url, n }), { headers: { "content-type": "application/json" } });
  });
  const { mcpy } = testMcpy({ pages: [direct()], fetch });
  return { mcpy, calls };
}

describe("fetch_batch", () => {
  it("answers every request in order, each a fetch of its own", async () => {
    const { mcpy, calls } = site();
    const heights = Array.from({ length: FETCH_BATCH_MAX_REQUESTS }, (_, i) => 3_100_000 + i);
    const out = await mcpy.fetchBatch({ requests: heights.map(header) });
    expect(FETCH_BATCH_MAX_REQUESTS).toBe(64);
    expect(out.results).toHaveLength(64);
    expect(calls).toHaveLength(64);
    out.results.forEach((r, i) => {
      if (!("result" in r)) throw new Error(`request ${i} failed`);
      expect(JSON.parse(JSON.parse(r.result.content).asked).params).toEqual([heights[i]]);
    });
    expect(out.meta).toMatchObject({ cost_usd: 0, cache_hits: 0, failed: 0 });
  });

  it("serves each request from the cache within its own max_age", async () => {
    const { mcpy, calls } = site();
    await mcpy.fetchBatch({ requests: [header(1), header(2)] });
    const again = await mcpy.fetchBatch({ requests: [header(1), header(2), { url: `${NODE}?tip`, max_age: 0 }] });
    expect(calls).toHaveLength(3);
    expect(again.results.map((r) => ("result" in r ? r.result.meta.cache : r.error.code))).toEqual([CacheStatus.Hit, CacheStatus.Hit, CacheStatus.Bypass]);
    expect(again.meta.cache_hits).toBe(2);
  });

  it("answers a failing request with its error, and the others as usual", async () => {
    const { mcpy } = site();
    const out = await mcpy.fetchBatch({ requests: [{ url: "https://down.example.org/x" }, { url: `${NODE}?ok` }] });
    expect(out.results[0]).toEqual({ error: expect.objectContaining({ code: ErrorCode.UpstreamFailed }) });
    expect(out.results[1]).toMatchObject({ result: { status: 200 } });
    expect(out.meta.failed).toBe(1);
  });

  it("keeps free_only per request: a refused one fails alone", async () => {
    const browser = fakePages("cloudflare_browser", page(), 0.0005);
    (browser as { capabilities?: object }).capabilities = { render: true };
    const { mcpy } = testMcpy({ pages: [fakePages("direct", page()), browser] });
    const out = await mcpy.fetchBatch({ requests: [{ url: "https://a.example.org/", render: true, free_only: true }, { url: "https://b.example.org/" }] });
    expect(out.results[0]).toMatchObject({ error: { code: ErrorCode.NoProviders } });
    expect(out.results[1]).toMatchObject({ result: { status: 200 } });
    expect(browser.calls).toHaveLength(0);
  });

  it("totals what its requests cost", async () => {
    const browser = fakePages("cloudflare_browser", page(), 0.0005);
    (browser as { capabilities?: object }).capabilities = { render: true };
    const { mcpy } = testMcpy({ pages: [browser] });
    const out = await mcpy.fetchBatch({ requests: [{ url: "https://a.example.org/", render: true }, { url: "https://b.example.org/", render: true }] });
    expect(out.meta.cost_usd).toBe(0.001);
  });

  it("refuses an empty batch, one too large, and an invalid request, naming it", async () => {
    const { mcpy } = site();
    await expect(mcpy.fetchBatch({ requests: [] })).rejects.toMatchObject({ code: ErrorCode.InvalidInput });
    const many = Array.from({ length: FETCH_BATCH_MAX_REQUESTS + 1 }, () => ({ url: NODE }));
    await expect(mcpy.fetchBatch({ requests: many })).rejects.toMatchObject({ code: ErrorCode.InvalidInput });
    await expect(mcpy.fetchBatch({ requests: [{ url: NODE }, { url: "not a url" }] })).rejects.toMatchObject({
      code: ErrorCode.InvalidInput,
      details: [expect.stringContaining("requests.1.url")],
    });
  });
});

/**
 * Regression (2026-11-27, owner): a batch must not overwhelm a site, nor queue requests in the
 * Worker runtime (it starts at most 6 at once, and a queued request's timeout runs while it waits).
 * At most 6 in flight, 4 per site (a browser opens 6 per host); identical reads fetched once; a
 * request not started by the batch's deadline answers timeout without being sent.
 */
describe("fetch_batch pacing", () => {
  /** A fetch that records how many requests are in flight, overall and per host. */
  function tracked(delayMs = 5) {
    const inFlight = new Map<string, number>();
    let overall = 0;
    const peak = { overall: 0, perHost: new Map<string, number>() };
    const seen: string[] = [];
    const fetch = async (input: { url: string; id?: string }) => {
      const host = new URL(input.url).host;
      seen.push(input.url);
      overall++;
      inFlight.set(host, (inFlight.get(host) ?? 0) + 1);
      peak.overall = Math.max(peak.overall, overall);
      peak.perHost.set(host, Math.max(peak.perHost.get(host) ?? 0, inFlight.get(host)!));
      await new Promise((r) => setTimeout(r, delayMs));
      overall--;
      inFlight.set(host, inFlight.get(host)! - 1);
      return { url: input.url, content: input.url, meta: { cache: CacheStatus.Miss, cost_usd: 0 } } as never;
    };
    return { fetch, peak, seen };
  }

  it("keeps at most 6 requests in flight, 4 to any one site", async () => {
    const { fetch, peak } = tracked();
    const node = Array.from({ length: 30 }, (_, i) => ({ url: `https://node.example.org/h/${i}` }));
    const prices = ["a", "b", "c", "d", "e", "f", "g"].map((x) => ({ url: `https://${x}.example.com/ticker` }));
    const out = await runFetchBatch(fetch, { requests: [...node, ...prices] });
    expect(out.results).toHaveLength(37);
    expect(peak.overall).toBe(FETCH_BATCH_CONCURRENCY);
    expect(FETCH_BATCH_CONCURRENCY).toBe(6);
    expect(peak.perHost.get("node.example.org")).toBe(FETCH_BATCH_PER_SITE);
    expect(FETCH_BATCH_PER_SITE).toBe(4);
  });

  it("fetches identical reads once and answers each, but sends every write", async () => {
    const { fetch, seen } = tracked();
    const read = { url: "https://node.example.org/tip" };
    const write = { url: "https://node.example.org/w", method: HttpMethod.Post, body: "{}" };
    const out = await runFetchBatch(fetch, { requests: [read, { ...read, id: "again" }, write, write] });
    expect(seen.filter((u) => u.endsWith("/tip"))).toHaveLength(1);
    expect(seen.filter((u) => u.endsWith("/w"))).toHaveLength(2);
    expect(out.results).toHaveLength(4);
    expect(out.meta).toMatchObject({ fetched: 3, deduplicated: 1, failed: 0 });
  });

  it("echoes each request's id", async () => {
    const { fetch } = tracked();
    const out = await runFetchBatch(fetch, { requests: [{ url: "https://a.example.com/", id: "btc" }, { url: "https://b.example.com/" }] });
    expect(out.results[0]).toMatchObject({ id: "btc", result: { url: "https://a.example.com/" } });
    expect(out.results[1]).not.toHaveProperty("id");
  });

  it("answers timeout, unsent, a request not started by the batch's deadline", async () => {
    const { fetch, seen } = tracked(40);
    const requests = Array.from({ length: 6 }, (_, i) => ({ url: `https://node.example.org/${i}` }));
    const out = await runFetchBatch(fetch, { requests }, { deadlineMs: 20 });
    expect(seen).toHaveLength(4);
    expect(out.results.slice(4)).toEqual([
      { error: expect.objectContaining({ code: ErrorCode.Timeout }) },
      { error: expect.objectContaining({ code: ErrorCode.Timeout }) },
    ]);
    expect(out.meta).toMatchObject({ fetched: 4, failed: 2 });
  });
});
