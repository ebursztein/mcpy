/**
 * Regression (2026-11-27, owner): a write (POST, PUT, PATCH, DELETE) carries a client's own data,
 * and one isolate's cache serves every API key. Through the Worker, two keys sending the same
 * write must each get their own answer, over REST fetch, grep, the batch and MCP alike; reads
 * stay shared. Never delete these.
 */

import { CacheStatus, FetchBatchResultSchema, FetchResultSchema, GrepResultSchema, HttpMethod, RestRoute, ToolName } from "mcpy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_KEY, call, makeEnv, rpc } from "./harness.js";

const ALICE = "alice-key-0123456789abcdef";
const BOB = "bob-key-0123456789abcdefgh";
const API = "https://api.example.org/account";
const WRITES = [HttpMethod.Post, HttpMethod.Put, HttpMethod.Patch, HttpMethod.Delete];

let sent = 0;
beforeEach(() => {
  sent = 0;
  // The site numbers its answers, so a cached one shows an old number.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const res = new Response(JSON.stringify({ answer: ++sent }), { status: 200, headers: { "Content-Type": "application/json" } });
    Object.defineProperty(res, "url", { value: url });
    return res;
  });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** One isolate (one env, one cache) serving both keys. */
const isolate = () => makeEnv({ MCPY_CLIENTS: `alice:${ALICE},bob:${BOB},ops:${ADMIN_KEY}:admin` });
const write = (method: HttpMethod) => ({ url: API, method, body: '{"plan":"pro"}', max_age: 3_600 });

async function fetchAs(key: string, env: ReturnType<typeof isolate>, body: object) {
  const response = await call(RestRoute.Fetch, { env, key, body });
  expect(response.status).toBe(200);
  return FetchResultSchema.parse(await response.json());
}

describe("through the Worker, a write's answer is its key's alone", () => {
  it.each(WRITES)("%s over REST: each key gets its own answer, and its own back from the cache", async (method) => {
    const env = isolate();
    const alice = await fetchAs(ALICE, env, write(method));
    const bob = await fetchAs(BOB, env, write(method));
    expect([alice.content, bob.content]).toEqual(['{"answer":1}', '{"answer":2}']);
    expect(bob.meta.cache).toBe(CacheStatus.Miss);
    expect([(await fetchAs(ALICE, env, write(method))).content, (await fetchAs(BOB, env, write(method))).content]).toEqual(['{"answer":1}', '{"answer":2}']);
    expect(sent).toBe(2);
  });

  it.each(WRITES)("%s in a batch: never served the other key's answer", async (method) => {
    const env = isolate();
    await fetchAs(ALICE, env, write(method));
    const response = await call(RestRoute.FetchBatch, { env, key: BOB, body: { requests: [write(method)] } });
    const out = FetchBatchResultSchema.parse(await response.json());
    expect(out.results[0]).toMatchObject({ result: { content: '{"answer":2}', meta: { cache: CacheStatus.Miss } } });
  });

  it.each(WRITES)("%s through grep: never matches the other key's answer", async (method) => {
    const env = isolate();
    await fetchAs(ALICE, env, write(method));
    const response = await call(RestRoute.Grep, { env, key: BOB, body: { ...write(method), pattern: "answer" } });
    const out = GrepResultSchema.parse(await response.json());
    expect(out.output).toContain('"answer":2');
    expect(out.output).not.toContain('"answer":1');
  });

  it.each(WRITES)("%s over MCP: never served the other key's answer", async (method) => {
    const env = isolate();
    await fetchAs(ALICE, env, write(method));
    const { message } = await rpc("tools/call", { name: ToolName.Fetch, arguments: write(method) }, { env, key: BOB });
    const out = FetchResultSchema.parse((message.result as { structuredContent: unknown }).structuredContent);
    expect([out.meta.cache, out.content]).toEqual([CacheStatus.Miss, '{"answer":2}']);
  });

  it("a GET stays shared between keys", async () => {
    const env = isolate();
    await fetchAs(ALICE, env, { url: API });
    const bob = await fetchAs(BOB, env, { url: API });
    expect([bob.meta.cache, bob.content, sent]).toEqual([CacheStatus.Hit, '{"answer":1}', 1]);
  });
});
