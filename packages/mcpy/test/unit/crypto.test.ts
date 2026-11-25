/** crypto_market and crypto_coin over scripted sources: merging, miner rules, caching, failures and inputs. */

import { describe, expect, it } from "vitest";
import { CacheStatus, CoinDayStatus, CryptoCoinInputSchema, ErrorCode, MAX_COIN_ROWS, MIN_CRYPTO_MAX_AGE_SECONDS, type McpyError } from "mcpy";
import type { FoundCoinDay } from "mcpy/providers";
import { hashprice, minerFees, minerSubsidy } from "../../src/services/crypto/rules.js";
import { testMcpy } from "../helpers.js";
import { dayBefore, live, network, NOW, past, prices, today } from "./crypto-fakes.js";

describe("crypto_market", () => {
  it("merges sources field by field, the first source winning, and works out hashprice", async () => {
    const { mcpy } = testMcpy({ crypto: [prices, network] });
    const r = await mcpy.cryptoMarket({ limit: 3 });
    expect(r.total_market_cap_usd).toBe(2.9e12);
    expect(r.coins.map((c) => c.symbol)).toEqual(["BTC", "ETH", "ZEC"]);
    const btc = r.coins[0];
    expect(btc).toMatchObject({ name: "Bitcoin", price_usd: 60_000, algorithm: "SHA-256", network_hashrate_hs: 1e21 });
    expect(btc.hashprice_usd_per_hs_day).toBeCloseTo((60_000 * 450) / 1e21, 30);
    // ZEC miners get 80% of new coins.
    expect(r.coins[2].hashprice_usd_per_hs_day).toBeCloseTo((50 * 600 * 0.8) / 1.2e10, 20);
    // No miners' rule for ETH (not mined): no hashprice, never a guess.
    expect(r.coins[1]).not.toHaveProperty("hashprice_usd_per_hs_day");
  });

  it("keeps the order asked and lists unknown symbols", async () => {
    const { mcpy } = testMcpy({ crypto: [prices, network] });
    const r = await mcpy.cryptoMarket({ symbols: ["rvn", "BTC", "NOPE"] });
    expect(r.coins.map((c) => c.symbol)).toEqual(["RVN", "BTC"]);
    expect(r.missing).toEqual(["NOPE"]);
  });

  it("answers from one source when another fails", async () => {
    const { mcpy } = testMcpy({ crypto: [live("down", new Error("boom")), network] });
    const r = await mcpy.cryptoMarket({ symbols: ["ZEC"] });
    expect(r.coins[0].price_usd).toBe(50);
    expect(r).not.toHaveProperty("total_market_cap_usd");
  });

  // Owner, 2026-11-25: the market key is shared and rate-limited, so every answer is reused for 5 minutes.
  it("reuses answers for at least 5 minutes, even when asked for max_age 0", async () => {
    const source = live("prices", { coins: [{ symbol: "BTC", asOf: NOW, priceUsd: 1 }] });
    const { mcpy } = testMcpy({ crypto: [source] });
    await mcpy.cryptoMarket({ symbols: ["BTC"] });
    const again = await mcpy.cryptoMarket({ symbols: ["BTC"], max_age: 0 });
    expect(again.meta.cache).toBe(CacheStatus.Hit);
    expect(source.asked).toHaveLength(1);
    expect(MIN_CRYPTO_MAX_AGE_SECONDS).toBe(300);
  });

  it("fails clearly, naming no source, when none is configured", async () => {
    const { mcpy } = testMcpy({});
    const err = (await mcpy.cryptoMarket({}).catch((e: unknown) => e)) as McpyError;
    expect(err.code).toBe(ErrorCode.NoProviders);
  });
});

const zecDay = (date: string): FoundCoinDay => ({ symbol: "ZEC", date, priceUsd: 50, networkHashrateHs: 1.2e10, blocks: 1152, issuedCoins: 600, feesCoins: 2, txCount: 9000 });

describe("crypto_coin", () => {
  it("returns complete days oldest first, then today live, with miners' shares and hashprice", async () => {
    const history = past("history", [zecDay(dayBefore(1)), zecDay(dayBefore(2))]);
    const { mcpy } = testMcpy({ crypto: [history, network] });
    const r = await mcpy.cryptoCoin({ symbols: ["zec"], days: 3 });
    const days = r.coins[0].days;
    expect(days.map((d) => [d.date, d.status])).toEqual([
      [dayBefore(2), CoinDayStatus.Complete],
      [dayBefore(1), CoinDayStatus.Complete],
      [today, CoinDayStatus.Live],
    ]);
    // Since NU7 (2026-11-06) ZEC miners keep 80% of the subsidy and 40% of fees.
    expect(days[1]).toMatchObject({ miner_subsidy_coins: 480, miner_fees_coins: 0.8 });
    expect(days[1].hashprice_usd_per_hs_day).toBeCloseTo((50 * 480.8) / 1.2e10, 20);
    expect(days[2]).toMatchObject({ as_of: NOW, price_usd: 50 });
    expect(history.asked[0]).toEqual({ symbols: ["ZEC"], from: dayBefore(2), to: dayBefore(1) });
  });

  it("asks only the history sources for a window that ends before today", async () => {
    const history = past("history", [zecDay(dayBefore(5))]);
    const now = live("network", { coins: [] });
    const { mcpy } = testMcpy({ crypto: [history, now] });
    const r = await mcpy.cryptoCoin({ symbols: ["ZEC"], from: dayBefore(5), to: dayBefore(5) });
    expect(r.coins[0].days).toHaveLength(1);
    expect(now.asked).toHaveLength(0);
  });

  it("keeps today's live day when the history sources fail, and drops stray days", async () => {
    const stray = past("stray", [zecDay("1999-01-01")]);
    const { mcpy } = testMcpy({ crypto: [past("down", new Error("boom")), stray, network] });
    const r = await mcpy.cryptoCoin({ symbols: ["ZEC"], days: 2 });
    expect(r.coins[0].days.map((d) => d.status)).toEqual([CoinDayStatus.Live]);
  });

  it("names each coin's sources for the usage log, never in the result", async () => {
    const served: { provider: string; parts?: Record<string, string> }[] = [];
    const { mcpy } = testMcpy({ crypto: [past("history", [zecDay(dayBefore(1))]), network] });
    const r = await mcpy.with({ onServed: (s) => void served.push(s) }).cryptoCoin({ symbols: ["ZEC", "NOPE"], days: 2 });
    expect(served[0].parts).toEqual({ "ZEC complete": "history", "ZEC live": "network" }); // one source each here
    expect(JSON.stringify(r)).not.toMatch(/history|network"/);
    expect(r.missing).toEqual(["NOPE"]);
  });
});

describe("crypto_coin input", () => {
  const parse = (input: object) => CryptoCoinInputSchema.safeParse(input);
  it("caps day rows at coins × days", () => {
    expect(parse({ symbols: ["BTC"], days: MAX_COIN_ROWS }).success).toBe(true);
    expect(parse({ symbols: ["BTC", "ZEC"], days: 61 }).success).toBe(false);
    expect(parse({ symbols: ["BTC"], from: dayBefore(200) }).success).toBe(false);
  });
  it("refuses days with from, to without from, a future to, and a symbol twice", () => {
    expect(parse({ symbols: ["BTC"], days: 2, from: dayBefore(3) }).success).toBe(false);
    expect(parse({ symbols: ["BTC"], to: dayBefore(3) }).success).toBe(false);
    expect(parse({ symbols: ["BTC"], from: today, to: "2999-01-01" }).success).toBe(false);
    expect(parse({ symbols: ["BTC", "btc"] }).success).toBe(false);
  });
});

describe("miners' rules", () => {
  it("gives DASH's miners a quarter of each block's coinbase payout, never its reported issuance, nor its reported fees", () => {
    expect(minerSubsidy("DASH", { issuedCoins: 7_751, blocks: 545, coinbasePerBlockCoins: 1.64388266 })).toBeCloseTo(1.64388266 * 545 * 0.25, 9);
    expect(minerSubsidy("DASH", { issuedCoins: 7_751, blocks: 545 })).toBeUndefined();
    expect(minerFees("DASH", "2026-11-20", 3)).toBeUndefined();
  });
  it("applies ZEC's fee share from NU7 only", () => {
    expect(minerFees("ZEC", "2026-11-05", 10)).toBe(10);
    expect(minerFees("ZEC", "2026-11-06", 10)).toBe(4);
  });
  it("leaves coins it has no rule for alone", () => {
    expect(minerSubsidy("RVN", { issuedCoins: 1_800_000, blocks: 1440 })).toBeUndefined();
    expect(hashprice(1, undefined, 1)).toBeUndefined();
  });
});

