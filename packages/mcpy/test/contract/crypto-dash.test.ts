/**
 * Dash's Insight explorer against responses captured live on 2026-11-25: 2026-11-24's last
 * blocks (newest first) and the coinbase of its last, height 2,577,886, which lists the credit
 * pool, a masternode and the miner (0.41108933 of 1.64435732) in that order.
 */

import { describe, expect, it } from "vitest";
import { blockTxsUrl, coinbaseAtDayEnd, dash, DASH_CAPABILITIES, dayBlocksUrl, sameStep } from "../../src/providers/dash/index.js";
import { fixture, fixtureJson, stubFetch } from "../helpers.js";
import { json, providerCall } from "./call.js";

const BLOCKS = fixture("crypto/dash-blocks-2026-11-24.json");
const TXS = fixture("crypto/dash-txs-2577886.json");
const LAST = "0000000000000021b8ddaa5551fcf67e19762040da14a66427124937f14af152";
const reply = (url: string) => json(url.includes("/blocks?") ? BLOCKS : TXS);

describe("dash: request", () => {
  it("is a free history source for DASH only", async () => {
    expect(dash()).toMatchObject({ id: "dash", costPerCall: 0, capabilities: DASH_CAPABILITIES });
    const { fetch, calls } = stubFetch(reply);
    expect(await dash().history!({ symbols: ["BTC"], from: "2026-11-24", to: "2026-11-24" }, providerCall(fetch))).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("reads the coinbase payout of the day's last block", async () => {
    const { fetch, calls } = stubFetch(reply);
    expect(await coinbaseAtDayEnd("2026-11-24", providerCall(fetch))).toBe(1.64435732);
    expect(calls.map((c) => c.url)).toEqual([dayBlocksUrl("2026-11-24"), blockTxsUrl(LAST)]);
    expect(dayBlocksUrl("2026-11-24")).toBe("https://insight.dash.org/insight-api/blocks?blockDate=2026-11-24&limit=3");
    // Insight refuses a request without a User-Agent (403, live 2026-11-25).
    expect(calls[0].headers.get("user-agent")).toMatch(/mcpy/);
  });

  it("passes over a superblock's coinbase to the block before it", async () => {
    const superblock = fixtureJson<{ txs: { vout: unknown[] }[] }>("crypto/dash-txs-2577886.json");
    superblock.txs[0].vout.push({ value: "5000" }, { value: "3000" });
    const { fetch, calls } = stubFetch((url, n) => json(url.includes("/blocks?") ? BLOCKS : n === 2 ? superblock : TXS));
    expect(await coinbaseAtDayEnd("2026-11-24", providerCall(fetch))).toBe(1.64435732);
    expect(calls).toHaveLength(3);
  });
});

describe("dash: days", () => {
  it("gives each day its payout per block, reading only the window's ends when they agree", async () => {
    const { fetch, calls } = stubFetch(reply);
    const days = await dash().history!({ symbols: ["DASH"], from: "2026-11-20", to: "2026-11-24" }, providerCall(fetch));
    expect(days.map((d) => d.date)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]);
    expect(days.every((d) => d.symbol === "DASH" && d.coinbasePerBlockCoins === 1.64435732)).toBe(true);
    // The day before the window (its start) and the window's last day: two readings, two requests each.
    expect(calls.filter((c) => c.url.includes("/blocks?")).map((c) => c.url).sort()).toEqual([dayBlocksUrl("2026-11-19"), dayBlocksUrl("2026-11-24")]);
  });

  it("leaves out the day a step falls in, and keeps the days either side", async () => {
    const after = fixtureJson<{ txs: { valueOut: number }[] }>("crypto/dash-txs-2577886.json");
    after.txs[0].valueOut = 1.527; // a 7% yearly step
    const stepDay = "2026-11-22";
    const { fetch } = stubFetch((url) => {
      const day = /blockDate=([\d-]+)/.exec(url)?.[1];
      if (day) return json({ blocks: [{ hash: (day >= stepDay ? "b" : "a").repeat(64), height: 1, time: 1 }] });
      return json(url.endsWith("b".repeat(64)) ? after : TXS);
    });
    const days = await dash().history!({ symbols: ["DASH"], from: "2026-11-20", to: "2026-11-24" }, providerCall(fetch));
    expect(days.map((d) => [d.date, d.coinbasePerBlockCoins])).toEqual([
      ["2026-11-20", 1.64435732],
      ["2026-11-21", 1.64435732],
      ["2026-11-23", 1.527],
      ["2026-11-24", 1.527],
    ]);
  });

  it("treats fee-sized differences as one step and a yearly cut as another", () => {
    expect(sameStep(1.64435732, 1.64388266)).toBe(true);
    expect(sameStep(1.64435732, 1.527)).toBe(false);
  });
});
