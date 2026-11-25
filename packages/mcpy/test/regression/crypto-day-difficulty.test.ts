/**
 * Regression (2026-11-25, deepmine): BTC's and LTC's complete days carried no `difficulty`
 * (Coin Metrics' community tier refuses DiffLast), so deepmine read two block explorers itself to
 * find each day's last retarget. A complete day now carries the difficulty in force at its last
 * block: the last retarget at or before the day's end, from mempool.space (BTC) and
 * litecoinspace.org (LTC). Retarget lists recorded live on 2026-11-25.
 */

import { describe, expect, it } from "vitest";
import { mempool, type CryptoProvider, type FoundCoinDay } from "mcpy/providers";
import { fixture, stubFetch, testMcpy } from "../helpers.js";

const prices: CryptoProvider = {
  id: "coinmetrics",
  costPerCall: 0,
  capabilities: { totals: false, live: false, history: true },
  history: async (req) =>
    req.symbols.flatMap((symbol) =>
      ["2026-09-01", "2026-11-11", "2026-11-13", "2026-11-14", "2026-11-22", "2026-11-24"].map((date): FoundCoinDay => ({ symbol, date, priceUsd: 1 })),
    ),
};

const explorers = () =>
  stubFetch((url) => {
    const host = new URL(url).host;
    const body = host === "mempool.space" ? fixture("crypto/mempool-btc-difficulty-adjustments-3m.json") : fixture("crypto/litecoinspace-ltc-difficulty-adjustments-3m.json");
    return new Response(body, { headers: { "content-type": "application/json" } });
  });

const difficultyByDay = async (symbol: string, from: string, to: string) => {
  const { fetch, calls } = explorers();
  const { mcpy } = testMcpy({ fetch, crypto: [prices, mempool()] });
  const result = await mcpy.cryptoCoin({ symbols: [symbol], from, to });
  return { days: Object.fromEntries(result.coins[0].days.map((d) => [d.date, d.difficulty])), calls };
};

describe("crypto_coin: a complete day's difficulty at its last block", () => {
  it("BTC: the last retarget at or before the day's end", async () => {
    const { days, calls } = await difficultyByDay("BTC", "2026-11-13", "2026-11-24");
    expect(Object.keys(days)).toHaveLength(12); // every day of the span
    expect(days).toMatchObject({
      "2026-11-13": 148364561003867.4, // the 2026-10-29 retarget's
      "2026-11-14": 134823837323272.7, // retargeted at 05:02:50: the day's last block has the new one
      "2026-11-22": 134823837323272.7,
      "2026-11-24": 134823837323272.7,
    });
    expect(calls.map((c) => c.url)).toEqual(["https://mempool.space/api/v1/mining/difficulty-adjustments/all"]);
  });

  it("LTC: the same, from litecoinspace.org (a retarget at 23:55:40 is the day's)", async () => {
    const { days, calls } = await difficultyByDay("LTC", "2026-11-11", "2026-11-22");
    expect(Object.keys(days)).toHaveLength(12);
    expect(days).toMatchObject({
      "2026-11-11": 94729203.34146552,
      "2026-11-13": 94729203.34146552,
      "2026-11-15": 96737553.66429844, // retargeted at 10:08:29
      "2026-11-21": 91317977.90340634,
      "2026-11-22": 90912746.5658243,
    });
    expect(calls.map((c) => c.url)).toEqual(["https://litecoinspace.org/api/v1/mining/difficulty-adjustments/all"]);
  });

  it("leaves the field out of a day no listed retarget precedes", async () => {
    const { days } = await difficultyByDay("BTC", "2026-09-01", "2026-09-01");
    expect(days).toEqual({ "2026-09-01": undefined });
  });
});
