/** crypto tools: answer size, one name per measure, whole-table sources and coin facts. */

import { describe, expect, it } from "vitest";
import { CoinDaySchema, CoinSchema, MarketCoinSchema, MAX_COIN_ROWS, MAX_MARKET_COINS, MAX_OUTPUT_CHARS } from "mcpy";
import type { CryptoProvider, FoundLiveCoin } from "mcpy/providers";
import { completeDay, liveDay } from "../../src/services/crypto/coin.js";
import { marketRow } from "../../src/services/crypto/market.js";
import { testMcpy } from "../helpers.js";
import { dayBefore, live, network, NOW, past, prices, today } from "./crypto-fakes.js";

describe("answer size", () => {
  const big = 123_456_789.123456789;
  it("a call at the row caps, every figure filled, stays under the output ceiling", () => {
    const day = completeDay({
      symbol: "BTC", date: "2026-11-24", priceUsd: big, marketCapUsd: big, supply: big, volumeUsd: big, networkHashrateHs: 9.95e20, blocks: 144, issuedCoins: big, feesCoins: big,
      txCount: 412_345, issuedUsd: big, priceBtc: 1, marketCapEstimatedUsd: big, mvrv: 2.123456789012, activeAddresses: 812_345, addressesWithBalance: 55_123_456, transfers: 1_012_345,
      exchangeInflowCoins: big, exchangeInflowUsd: big, exchangeOutflowCoins: big, exchangeOutflowUsd: big, supplyOnExchangesCoins: big, supplyOnExchangesUsd: big,
      supplyExpected10yCoins: big, roi30dPct: -12.123456789, roi1yPct: -30.12345678,
    });
    expect(JSON.stringify(Array(MAX_COIN_ROWS).fill(day)).length).toBeLessThan(MAX_OUTPUT_CHARS);
    const row = marketRow({
      symbol: "BTC", name: "Bitcoin", asOf: NOW, algorithm: "SHA-256", minedWith: "asic", blockTimeTargetS: 600, blockHeight: 977_534, priceUsd: big, priceChange24hPct: -1.2345,
      priceChange7dPct: -7.2869, high24hUsd: big, low24hUsd: big, allTimeHighUsd: big, allTimeHighDate: "2025-10-06", marketCapUsd: big, marketCapRank: 1, fullyDilutedValueUsd: big,
      volume24hUsd: big, supply: big, totalSupply: big, maxSupply: big, networkHashrateHs: 9.95e20, difficulty: big, difficultyChange7dPct: -0.123456, blockTimeS: 588, issued24hCoins: big,
      pools: 161, poolHashrateHs: 1.02e21,
    });
    expect(JSON.stringify(Array(MAX_MARKET_COINS).fill(row)).length).toBeLessThan(MAX_OUTPUT_CHARS);
    expect(row.pool_share_pct).toBeCloseTo((1.02e21 / 9.95e20) * 100, 9);
  });
});

// Owner, 2026-11-25: the same measure has the same field name in crypto_market and crypto_coin.
describe("one name per measure across both tools", () => {
  const keys = (shape: object) => new Set(Object.keys(shape));
  const market = keys(MarketCoinSchema.shape);
  const day = keys(CoinDaySchema.shape);
  const coin = keys(CoinSchema.shape);
  it("a market row's every figure is a day field, and its coin facts are a coin's", () => {
    for (const k of market) if (k !== "as_of") expect(day.has(k) || coin.has(k), k).toBe(true);
    for (const k of coin) if (k !== "days") expect(market.has(k), k).toBe(true);
  });
  it("a live day carries exactly a market row's figures", () => {
    const c = { symbol: "RVN", name: "Ravencoin", asOf: NOW, priceUsd: 1, priceChange24hPct: 2, volume24hUsd: 3, networkHashrateHs: 4, poolHashrateHs: 2, pools: 5, issued24hCoins: 6 };
    const { symbol: _s, name: _n, as_of: _a, ...rowFigures } = marketRow(c);
    const { date: _d, status: _t, as_of: _b, ...dayFigures } = liveDay(c, today);
    expect(dayFigures).toEqual(rowFigures);
  });
});

describe("whole-table sources", () => {
  function tableSource(tables: (FoundLiveCoin[] | Error)[]): CryptoProvider & { downloads: number } {
    const source = {
      id: "table",
      costPerCall: 0,
      capabilities: { totals: false, live: true, history: false },
      downloads: 0,
      async table() {
        const next = tables[Math.min(source.downloads++, tables.length - 1)];
        if (next instanceof Error) throw next;
        return next;
      },
    };
    return source;
  }
  const coins: FoundLiveCoin[] = [
    { symbol: "BTC", asOf: NOW, marketCapUsd: 1e12, networkHashrateHs: 1e21 },
    { symbol: "RVN", asOf: NOW, marketCapUsd: 1e7, networkHashrateHs: 4e11 },
    { symbol: "NOCAP", asOf: NOW, networkHashrateHs: 1 },
  ];

  it("downloads the table once for different coins, tools and calls within 5 minutes", async () => {
    const source = tableSource([coins]);
    const { mcpy } = testMcpy({ crypto: [source] });
    expect((await mcpy.cryptoMarket({ symbols: ["BTC"] })).coins[0].network_hashrate_hs).toBe(1e21);
    expect((await mcpy.cryptoMarket({ symbols: ["RVN", "NOCAP"] })).coins.map((c) => c.symbol)).toEqual(["RVN", "NOCAP"]);
    expect((await mcpy.cryptoCoin({ symbols: ["RVN"] })).coins[0].days[0].network_hashrate_hs).toBe(4e11);
    // Without symbols: only coins with a market cap are ranked.
    expect((await mcpy.cryptoMarket({ limit: 5 })).coins.map((c) => c.symbol)).toEqual(["BTC", "RVN"]);
    expect(source.downloads).toBe(1);
  });

  it("never keeps an empty or failed table", async () => {
    const source = tableSource([[], new Error("boom"), coins]);
    const prices = live("prices", { coins: [{ symbol: "BTC", asOf: NOW, priceUsd: 1 }] });
    const { mcpy } = testMcpy({ crypto: [prices, source] });
    await mcpy.cryptoMarket({ symbols: ["BTC"] });
    await mcpy.cryptoMarket({ symbols: ["BTC", "RVN"] });
    const third = await mcpy.cryptoMarket({ symbols: ["RVN"] });
    expect(third.coins[0].network_hashrate_hs).toBe(4e11);
    expect(source.downloads).toBe(3);
  });
});

describe("coin facts", () => {
  it("states units, miners' shares and merge-mining in both tools, from the registry and the sources", async () => {
    const { mcpy } = testMcpy({ crypto: [network, live("doge", { coins: [{ symbol: "DOGE", asOf: NOW, algorithm: "Scrypt", networkHashrateHs: 2.6e15 }] })] });
    const [btc, zec, doge] = (await mcpy.cryptoMarket({ symbols: ["BTC", "ZEC", "DOGE"] })).coins;
    expect(btc).toMatchObject({ hashrate_unit: "H/s", quoted_hashrate_unit: "TH/s", quoted_hashrate_unit_hs: 1e12, miner_share_pct: 100, miner_fee_share_pct: 100 });
    expect(zec).toMatchObject({ hashrate_unit: "Sol/s", quoted_hashrate_unit: "GSol/s", quoted_hashrate_unit_hs: 1e9, miner_share_pct: 80, miner_fee_share_pct: 40 });
    expect(doge).toMatchObject({ merge_mined_with: "LTC" });
    const coin = (await mcpy.cryptoCoin({ symbols: ["ZEC"] })).coins[0];
    expect(coin).toMatchObject({ hashrate_unit: "Sol/s", miner_share_pct: 80 });
  });

  it("states nothing it does not know: an unlisted coin gets its unit from its algorithm only", async () => {
    const { mcpy } = testMcpy({ crypto: [live("rvn", { coins: [{ symbol: "RVN", asOf: NOW, algorithm: "KawPow", networkHashrateHs: 4e11 }] })] });
    const rvn = (await mcpy.cryptoMarket({ symbols: ["RVN"] })).coins[0];
    expect(rvn.hashrate_unit).toBe("H/s");
    for (const k of ["quoted_hashrate_unit", "miner_share_pct", "miner_fee_share_pct", "merge_mined_with", "hashprice_usd_per_hs_day"]) expect(rvn).not.toHaveProperty(k);
  });

  it("works out KAS's complete-day hashprice from its scheduled subsidy, no source stating its fees", async () => {
    const day0 = "2026-11-20"; // KAS paid 1.94454365 a block from 2026-11-04
    const kas = past("kaspa", [{ symbol: "KAS", date: day0, networkHashrateHs: 3.2e17, blocks: 864_000 }]);
    const prices = past("prices", [{ symbol: "KAS", date: day0, priceUsd: 0.027 }]);
    const { mcpy } = testMcpy({ crypto: [kas, prices] });
    const [day] = (await mcpy.cryptoCoin({ symbols: ["KAS"], from: day0, to: day0 })).coins[0].days;
    expect(day.miner_subsidy_coins).toBeCloseTo(1.94454365 * 864_000, 6);
    expect(day.hashprice_usd_per_hs_day).toBeCloseTo((0.027 * 1.94454365 * 864_000) / 3.2e17, 25);
    expect(day).not.toHaveProperty("miner_fees_coins");
  });
});
