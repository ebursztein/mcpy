/**
 * Regression (2026-11-25, production): ZEC's block figures were wrong or missing after NU7
 * (2026-11-06) cut its block target from 75 s to 25 s (zebra's POST_NU7_POW_TARGET_SPACING).
 * - block_time_target_s read 75: the live source's stated target, never checked against the
 *   25.1 s it measured. A target is now reported only when the measured block time bears it out.
 * - ZEC had no live hashprice: its live source states no 24-hour issuance. It now comes from the
 *   latest complete day's coins per block × 86,400 ÷ the live block time, all from data.
 */

import { describe, expect, it } from "vitest";
import type { FoundCoinDay } from "mcpy/providers";
import { testMcpy } from "../helpers.js";
import { dayBefore, live, NOW, past } from "../unit/crypto-fakes.js";

// Live 2026-11-25: miningpoolstats' ZEC row (no e24) and Coin Metrics' 2026-11-24.
const zecNow = { symbol: "ZEC", asOf: NOW, priceUsd: 760, networkHashrateHs: 3.27e10, blockTimeS: 25.1, blockTimeTargetS: 75 };
const zecDay: FoundCoinDay = { symbol: "ZEC", date: dayBefore(1), priceUsd: 738.5, networkHashrateHs: 3.58e10, blocks: 3497, issuedCoins: 1821.35415501, feesCoins: 1.69 };
const btcNow = { symbol: "BTC", asOf: NOW, priceUsd: 60_000, networkHashrateHs: 1e21, issued24hCoins: 450, blockTimeS: 561, blockTimeTargetS: 600 };
// Miners get 80% of new ZEC: 1821.35 / 3497 coins a block, 86,400 / 25.1 blocks a day.
const zecHashprice = (760 * 0.8 * (1821.35415501 / 3497) * (86_400 / 25.1)) / 3.27e10;

describe("ZEC block figures from data", () => {
  it("leaves out a target the measured block time contradicts, and keeps one it bears out", async () => {
    const { mcpy } = testMcpy({ crypto: [live("network", { coins: [zecNow, btcNow] })] });
    const [zec, btc] = (await mcpy.cryptoMarket({ symbols: ["ZEC", "BTC"] })).coins;
    expect(zec).not.toHaveProperty("block_time_target_s");
    expect(zec.block_time_s).toBe(25.1);
    expect(btc.block_time_target_s).toBe(600);
  });

  it("gives crypto_market's ZEC row a hashprice from the latest complete day's coins per block", async () => {
    const history = past("history", [zecDay]);
    const { mcpy } = testMcpy({ crypto: [live("network", { coins: [zecNow, btcNow] }), history] });
    const [zec, btc] = (await mcpy.cryptoMarket({ symbols: ["ZEC", "BTC"] })).coins;
    expect(zec.hashprice_usd_per_hs_day).toBeCloseTo(zecHashprice, 15);
    // The estimate fills a gap only: it is never reported as issuance, and BTC, whose issuance is stated, is not asked about.
    expect(zec).not.toHaveProperty("issued_24h_coins");
    expect(history.asked).toHaveLength(1);
    expect(history.asked[0].symbols).toEqual(["ZEC"]);
    expect(btc.hashprice_usd_per_hs_day).toBeCloseTo((60_000 * 450) / 1e21, 30);
  });

  it("gives crypto_coin's live ZEC day the same hashprice, from the window's own days when it has them", async () => {
    const history = past("history", [zecDay]);
    const { mcpy } = testMcpy({ crypto: [live("network", { coins: [zecNow] }), history] });
    const days = (await mcpy.cryptoCoin({ symbols: ["ZEC"], days: 2 })).coins[0].days;
    expect(days[1].hashprice_usd_per_hs_day).toBeCloseTo(zecHashprice, 15);
    expect(history.asked).toHaveLength(1); // yesterday came with the window: no second ask

    const todayOnly = past("history", [zecDay]);
    const again = testMcpy({ crypto: [live("network", { coins: [zecNow] }), todayOnly] }).mcpy;
    const [day] = (await again.cryptoCoin({ symbols: ["ZEC"], days: 1 })).coins[0].days;
    expect(day.hashprice_usd_per_hs_day).toBeCloseTo(zecHashprice, 15);
  });

  it("stays without a hashprice when no history source has a day with blocks and issuance", async () => {
    const { mcpy } = testMcpy({ crypto: [live("network", { coins: [zecNow] }), past("history", new Error("down"))] });
    const [zec] = (await mcpy.cryptoMarket({ symbols: ["ZEC"] })).coins;
    expect(zec.price_usd).toBe(760);
    expect(zec).not.toHaveProperty("hashprice_usd_per_hs_day");
  });
});
