/**
 * Regression (2026-11-27, owner): a write (POST, PUT, PATCH, DELETE) carries the caller's own
 * data, and its answer is the caller's: an account, an order, a token. The cache is shared by
 * every client of an instance, so a write's cached answer must only ever be served back to the
 * client that sent it, whatever path asks (fetch, grep, a batch, the parts of a long answer).
 * Reads (GET, HEAD) stay shared. Only one test (PUT, fetch) covered this before.
 * Never delete these.
 */

import { describe, expect, it } from "vitest";
import { CacheStatus, ErrorCode, HttpMethod, type FetchResult } from "mcpy";
import { direct } from "mcpy/providers";
import { responseAt, stubFetch, testMcpy } from "../helpers.js";

const API = "https://api.example.org/account";
const WRITES = [HttpMethod.Post, HttpMethod.Put, HttpMethod.Patch, HttpMethod.Delete];
const READS = [HttpMethod.Get, HttpMethod.Head];

/** The site answers each call with its number and who sent it (the Authorization header). */
function site(options: { long?: boolean } = {}) {
  const { fetch, calls } = stubFetch((url, n, init) => {
    const who = new Headers(init?.headers).get("x-caller") ?? "nobody";
    const text = `answer ${n} for ${who}`;
    return responseAt(url, options.long ? `${text}\n`.repeat(400) : JSON.stringify({ text }), { headers: { "content-type": options.long ? "text/plain" : "application/json" } });
  });
  const { mcpy } = testMcpy({ pages: [direct()], fetch });
  return { mcpy, calls, alice: mcpy.with({ client: "alice" }), bob: mcpy.with({ client: "bob" }) };
}

/** The same write, as each client sends it (its own credentials in a header). */
const write = (method: HttpMethod, who: string) => ({ url: API, method, body: '{"plan":"pro"}', headers: { "x-caller": who }, max_age: 3_600 });
/** The same write, byte for byte, from both clients: only the cache key's owner tells them apart. */
const same = (method: HttpMethod) => ({ url: API, method, body: '{"plan":"pro"}', max_age: 3_600 });
const answer = (r: FetchResult) => [r.meta.cache, r.content];

describe("a write's cached answer is its client's alone", () => {
  it.each(WRITES)("%s: never served to another client, even byte for byte the same request", async (method) => {
    const { alice, bob, calls } = site();
    const first = await alice.fetch(same(method));
    const theirs = await bob.fetch(same(method));
    expect(theirs.meta.cache).toBe(CacheStatus.Miss);
    expect(theirs.content).not.toBe(first.content);
    expect(answer(await alice.fetch(same(method)))).toEqual([CacheStatus.Hit, first.content]);
    expect(answer(await bob.fetch(same(method)))).toEqual([CacheStatus.Hit, theirs.content]);
    expect(calls).toHaveLength(2);
  });

  it.each(WRITES)("%s: an SDK caller without a client name never gets a named client's answer", async (method) => {
    const { mcpy, alice } = site();
    await alice.fetch(same(method));
    expect((await mcpy.fetch(same(method))).meta.cache).toBe(CacheStatus.Miss);
  });

  it.each(WRITES)("%s with its own credentials: each client gets the answer to its own", async (method) => {
    const { alice, bob } = site();
    await alice.fetch(write(method, "alice"));
    const theirs = await bob.fetch(write(method, "bob"));
    expect(theirs.content).toContain("for bob");
    expect(theirs.content).not.toContain("alice");
  });

  it.each(WRITES)("%s in a batch: never served another client's answer", async (method) => {
    const { alice, bob } = site();
    const a = await alice.fetchBatch({ requests: [same(method)] });
    const b = await bob.fetchBatch({ requests: [same(method), same(method)] });
    const content = (r: (typeof b.results)[number]) => ("result" in r ? r.result.content : r.error.code);
    // Bob's first is sent; his second may be his own first's answer (he passed max_age), never Alice's.
    expect(b.results[0]).toMatchObject({ result: { meta: { cache: CacheStatus.Miss } } });
    for (const r of b.results) expect(content(r)).not.toBe(content(a.results[0]!));
  });

  it.each(WRITES)("%s through grep: never matches another client's answer", async (method) => {
    const { alice, bob } = site();
    await alice.fetch(same(method));
    const out = await bob.grep({ ...same(method), pattern: "answer" });
    expect(out.output).toContain("answer 2");
    expect(out.output).not.toContain("answer 1");
  });

  it.each(WRITES)("%s answer in parts: another client naming its version never reads its copy", async (method) => {
    const { alice, bob } = site({ long: true });
    const first = await alice.fetch({ ...same(method), max_chars: 1_000 });
    expect(first.content).toContain("answer 1");
    const part = { ...same(method), max_chars: 1_000, offset: first.next_offset!, version: first.version! };
    // Bob has no copy under that version: his request goes to the site, whose answer is not that copy.
    await expect(bob.fetch(part)).rejects.toMatchObject({ code: ErrorCode.VersionExpired });
    expect((await alice.fetch(part)).content).toContain("answer 1");
  });

  it.each(READS)("%s stays shared: one client's read answers another", async (method) => {
    const { alice, bob, calls } = site();
    await alice.fetch({ url: API, method });
    expect((await bob.fetch({ url: API, method })).meta.cache).toBe(CacheStatus.Hit);
    expect(calls).toHaveLength(1);
  });
});
