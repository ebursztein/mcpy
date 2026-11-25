/**
 * KAS's subsidy read off its coinbases, against blocks captured live on 2026-11-25 (trimmed to
 * the coinbase): blue score 581,235,252 (2026-11-03 23:57, 2.06017223 KAS) and 582,090,474
 * (2026-11-04 23:46, 1.94454365 KAS), either side of the monthly step.
 */

import { describe, expect, it } from "vitest";
import { kaspa } from "../../src/providers/kaspa/index.js";
import { blocksUrl, issuedByDay, MAX_SUBSIDY_READS, subsidyAt, subsidyOfPayload } from "../../src/providers/kaspa/subsidy.js";
import type { Sample } from "../../src/providers/kaspa/schemas.js";
import { fillSteps } from "../../src/providers/step-fill.js";
import { fixture, fixtureJson, stubFetch } from "../helpers.js";
import { json, providerCall } from "./call.js";

const BEFORE = fixture("crypto/kaspa-blocks-581235252.json");
const AFTER = fixture("crypto/kaspa-blocks-582090474.json");

describe("kaspa subsidy: the coinbase payload", () => {
  it("reads the subsidy, u64 little-endian sompi after the blue score", () => {
    const [block] = fixtureJson<{ transactions: { payload: string }[] }[]>("crypto/kaspa-blocks-581235252.json");
    expect(subsidyOfPayload(block.transactions[0].payload)).toBe(2.06017223);
    expect(subsidyOfPayload("zz")).toBeUndefined();
    expect(subsidyOfPayload("00".repeat(8))).toBeUndefined(); // too short
  });

  it("finds the coinbase among a blue score's blocks, skipping ordinary transactions", async () => {
    const { fetch, calls } = stubFetch(() => json(AFTER));
    expect(await subsidyAt(582_090_474, providerCall(fetch))).toBe(1.94454365);
    expect(calls[0].url).toBe("https://api.kaspa.org/blocks-from-bluescore?blueScore=582090474&includeTransactions=true");
    expect(blocksUrl(1)).toContain("blueScore=1&");
  });
});

describe("kaspa subsidy: few reads for many points", () => {
  it("reads only the ends of a span whose ends agree", async () => {
    const reads: number[] = [];
    const values = await fillSteps([1, 2, 3, 4, 5, 6, 7, 8], async (p) => (reads.push(p), 2), { maxReads: 10 });
    expect(values).toEqual(Array(8).fill(2));
    expect(reads.sort()).toEqual([1, 8]);
  });

  it("splits a span with a step until it finds it, and leaves points unread past the budget unknown", async () => {
    const step = (p: number) => (p < 700 ? 2.06 : 1.94);
    const points = Array.from({ length: 1000 }, (_, i) => i);
    let reads = 0;
    const values = await fillSteps(points, async (p) => (reads++, step(p)), { maxReads: MAX_SUBSIDY_READS });
    expect(values).toEqual(points.map(step));
    expect(reads).toBeLessThanOrEqual(2 + 2 * Math.ceil(Math.log2(1000)));
    const capped = await fillSteps(points, async (p) => step(p), { maxReads: 3 });
    expect(capped.some((v) => v === undefined)).toBe(true);
  });
});

describe("kaspa subsidy: a day's issuance", () => {
  const sample = (day: string, i: number, blueScore: number): Sample => ({ timestamp: Date.parse(`${day}T00:00:00Z`) + i * 900_000, difficulty: 1, hashrate_kh: 1, blueScore });

  it("weighs each side of a step by its time in the day", async () => {
    // 2026-11-04: the first 48 samples at the old subsidy, the last 48 at the new.
    const day = Array.from({ length: 96 }, (_, i) => sample("2026-11-04", i, i < 48 ? 581_235_252 : 582_090_474));
    const { fetch } = stubFetch((url) => json(url.includes("581235252") ? BEFORE : AFTER));
    const issued = await issuedByDay(new Map([["2026-11-04", day]]), () => 864_000, providerCall(fetch));
    expect(issued.get("2026-11-04")).toBeCloseTo(864_000 * ((2.06017223 + 1.94454365) / 2), 4);
  });

  it("leaves out a day it cannot read, and the kaspa source keeps its other figures", async () => {
    const history = fixture("crypto/kaspa-history-2026-11-24.json");
    const { fetch } = stubFetch((url) => (url.includes("blocks-from-bluescore") ? json({ detail: "down" }, 503) : json(history)));
    const [day] = await kaspa().history!({ symbols: ["KAS"], from: "2026-11-24", to: "2026-11-24" }, providerCall(fetch));
    expect(day).toMatchObject({ date: "2026-11-24", blocks: 864_000 });
    expect(day).not.toHaveProperty("issuedCoins");
  });

  it("reports a whole day at one subsidy as blocks × that subsidy", async () => {
    const history = fixture("crypto/kaspa-history-2026-11-24.json");
    const { fetch, calls } = stubFetch((url) => json(url.includes("blocks-from-bluescore") ? AFTER : history));
    const [day] = await kaspa().history!({ symbols: ["KAS"], from: "2026-11-24", to: "2026-11-24" }, providerCall(fetch));
    expect(day.issuedCoins).toBeCloseTo(864_000 * 1.94454365, 4);
    expect(calls.filter((c) => c.url.includes("blocks-from-bluescore"))).toHaveLength(2);
  });
});
