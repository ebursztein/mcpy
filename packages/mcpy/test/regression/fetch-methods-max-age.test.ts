/**
 * Regression (2026-11-27, deepmine): fetch took GET and POST only, and a POST without max_age was
 * served from the cache for an hour, as a GET is. Deepmine's live reads are JSON-RPC POSTs to coin
 * nodes and its writes are PUTs and DELETEs, so it had to send every one of them around mcpy and
 * keep its own cache. Fetch now sends every method (HEAD, PUT, PATCH, DELETE too), each one keyed by
 * what it asked (method, URL, body, headers) and obeying max_age. A write (POST, PUT, PATCH, DELETE)
 * without max_age always reaches the site: only safe methods are cacheable by default (RFC 9110).
 * Never delete these.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CacheStatus, HttpMethod } from "mcpy";
import { direct } from "mcpy/providers";
import { fakePages, page, responseAt, stubFetch, testMcpy } from "../helpers.js";

const RPC = "https://node.example.org/rpc";
const WRITES = [HttpMethod.Post, HttpMethod.Put, HttpMethod.Patch, HttpMethod.Delete];

/** The site counts its calls, so a cached answer shows an old count. */
function site() {
  const { fetch, calls } = stubFetch((url, n) => responseAt(url, JSON.stringify({ n }), { headers: { "content-type": "application/json" } }));
  const { mcpy } = testMcpy({ pages: [direct()], fetch });
  return { mcpy, calls };
}

const later = (seconds: number) => vi.useFakeTimers({ now: Date.now() + seconds * 1000, toFake: ["Date"] });
afterEach(() => vi.useRealTimers());

describe("fetch: every method obeys max_age", () => {
  it.each(WRITES)("sends %s to the site with its body", async (method) => {
    const { mcpy, calls } = site();
    const out = await mcpy.fetch({ url: RPC, method, body: '{"id":1}' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method, body: { id: 1 } });
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(out.content).toBe('{"n":1}');
  });

  it.each(WRITES)("never serves a %s without max_age from the cache", async (method) => {
    const { mcpy, calls } = site();
    await mcpy.fetch({ url: RPC, method, body: "{}" });
    const again = await mcpy.fetch({ url: RPC, method, body: "{}" });
    expect(calls).toHaveLength(2);
    expect(again.meta.cache).toBe(CacheStatus.Bypass);
  });

  it.each([...WRITES, HttpMethod.Get])("serves a %s from the cache within its max_age, and fetches it again past it", async (method) => {
    const { mcpy, calls } = site();
    const body = method === HttpMethod.Get ? {} : { body: '{"method":"getblockcount"}' };
    await mcpy.fetch({ url: RPC, method, ...body, max_age: 60 });
    const hit = await mcpy.fetch({ url: RPC, method, ...body, max_age: 60 });
    expect(hit.meta.cache).toBe(CacheStatus.Hit);
    expect(hit.content).toBe('{"n":1}');
    later(120);
    const stale = await mcpy.fetch({ url: RPC, method, ...body, max_age: 60 });
    expect(stale.meta.cache).toBe(CacheStatus.Miss);
    expect(stale.content).toBe('{"n":2}');
    const skipped = await mcpy.fetch({ url: RPC, method, ...body, max_age: 0 });
    expect(skipped.meta.cache).toBe(CacheStatus.Bypass);
    expect(calls).toHaveLength(3);
  });

  it("keeps a write's answer for the client that sent it; a read is shared by every client", async () => {
    const { mcpy, calls } = site();
    const [a, b] = [mcpy.with({ client: "a" }), mcpy.with({ client: "b" })];
    const put = { url: RPC, method: HttpMethod.Put, body: "{}", max_age: 60 };
    await a.fetch(put);
    expect((await b.fetch(put)).meta.cache).toBe(CacheStatus.Miss);
    expect((await a.fetch(put)).meta.cache).toBe(CacheStatus.Hit);
    expect(calls).toHaveLength(2);
    await a.fetch({ url: RPC, max_age: 60 });
    expect((await b.fetch({ url: RPC, max_age: 60 })).meta.cache).toBe(CacheStatus.Hit);
  });

  it("keeps a GET's default: an hour", async () => {
    const { mcpy, calls } = site();
    await mcpy.fetch({ url: RPC });
    later(1_800);
    expect((await mcpy.fetch({ url: RPC })).meta.cache).toBe(CacheStatus.Hit);
    expect(calls).toHaveLength(1);
  });

  it("keys each answer by its method: a DELETE is never served a PUT's answer", async () => {
    const { mcpy, calls } = site();
    await mcpy.fetch({ url: RPC, method: HttpMethod.Put, body: "{}", max_age: 60 });
    const deleted = await mcpy.fetch({ url: RPC, method: HttpMethod.Delete, body: "{}", max_age: 60 });
    expect(deleted.meta.cache).toBe(CacheStatus.Miss);
    expect(calls.map((c) => c.method)).toEqual([HttpMethod.Put, HttpMethod.Delete]);
  });

  it("sends a HEAD, cached as a GET is, and an empty answer is the site's answer", async () => {
    const { fetch, calls } = stubFetch((url) => responseAt(url, null, { headers: { "content-type": "text/html" } }));
    const browser = fakePages("cloudflare_browser", page(), 0.0005);
    const { mcpy } = testMcpy({ pages: [direct(), browser], fetch });
    const out = await mcpy.fetch({ url: RPC, method: HttpMethod.Head });
    expect(calls[0].method).toBe(HttpMethod.Head);
    expect(out).toMatchObject({ status: 200, content: "" });
    expect((await mcpy.fetch({ url: RPC, method: HttpMethod.Head })).meta.cache).toBe(CacheStatus.Hit);
    expect(browser.calls).toHaveLength(0);
  });

  it("gives a write only to sources that can send it", async () => {
    const browser = fakePages("cloudflare_browser", page(), 0.0005);
    const { mcpy } = testMcpy({ pages: [browser] });
    await expect(mcpy.fetch({ url: RPC, method: HttpMethod.Delete })).rejects.toMatchObject({ code: "no_providers" });
    expect(browser.calls).toHaveLength(0);
  });

  it("resends a PUT or DELETE after a 503, never a POST or PATCH (they may have been processed)", async () => {
    for (const [method, sent] of [[HttpMethod.Put, 2], [HttpMethod.Delete, 2], [HttpMethod.Post, 1], [HttpMethod.Patch, 1]] as const) {
      const { fetch, calls } = stubFetch((url, n) => responseAt(url, n === 1 ? "busy" : "{}", { status: n === 1 ? 503 : 200, headers: { "content-type": "application/json" } }));
      const { mcpy } = testMcpy({ pages: [direct()], fetch });
      await mcpy.fetch({ url: RPC, method, body: "{}" }).catch(() => undefined);
      expect([method, calls.length]).toEqual([method, sent]);
    }
  });

  it("refuses a body on GET and HEAD", async () => {
    const { mcpy } = site();
    for (const method of [HttpMethod.Get, HttpMethod.Head]) await expect(mcpy.fetch({ url: RPC, method, body: "x" })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
