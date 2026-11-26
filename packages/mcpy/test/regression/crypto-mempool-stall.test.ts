/**
 * Regression (2026-11-25, production): from Cloudflare Workers, mempool.space now and then holds a
 * request open with no answer (20 s and more; it answers in under a second otherwise). The source
 * waited it out, which held every BTC/LTC crypto call for the fan-out's whole grace period, so it
 * was taken out of the default sources. A retarget list not in within READ_TIMEOUT_MS is given up
 * on, and a stalled explorer costs only its own coin's difficulty: the other coin's days stand.
 */

import { describe, expect, it } from "vitest";
import { mempool } from "mcpy/providers";
import { READ_TIMEOUT_MS } from "../../src/providers/mempool/index.js";
import { fixture, stubFetch } from "../helpers.js";
import { providerCall } from "../contract/call.js";

/** A fetch that never answers until its signal aborts, as mempool.space did. */
const hang = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));

const LTC = () => new Response(fixture("crypto/litecoinspace-ltc-difficulty-adjustments-3m.json"), { headers: { "content-type": "application/json" } });
const req = { symbols: ["BTC", "LTC"], from: "2026-11-20", to: "2026-11-22" };

describe("mempool: a stalled explorer", () => {
  it("is given up on quickly, and the other coin's days still come back", async () => {
    const { fetch, calls } = stubFetch((url, _n, init) => (url.includes("mempool.space") ? hang(init) : LTC()));
    const started = Date.now();
    const days = await mempool({ readTimeoutMs: 50 }).history!(req, providerCall(fetch));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(new Set(days.map((d) => d.symbol))).toEqual(new Set(["LTC"]));
    expect(days).toHaveLength(3);
    // mcpy names itself to the explorers.
    expect(calls.every((c) => /mcpy/.test(c.headers.get("user-agent") ?? ""))).toBe(true);
  });

  it("fails the source when no explorer answers, so the chain records it", async () => {
    const { fetch } = stubFetch((_url, _n, init) => hang(init));
    await expect(mempool({ readTimeoutMs: 50 }).history!(req, providerCall(fetch))).rejects.toBeDefined();
  });

  it("waits well under the crypto fan-out's grace period by default", () => {
    expect(READ_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });
});
