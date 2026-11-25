/**
 * CoinGecko against responses recorded live on 2026-11-25 with the demo key
 * (the key is never in a fixture): /coins/markets for BTC, ETH, ZEC, RVN and
 * a fund token whose volume and price changes read 0 (ETH has no max supply), /global, RVN's daily
 * market_chart (days=5), and the keyless pool's 429.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "mcpy";
import { quotaAlertFor } from "../../src/engine/quota.js";
import {
  chartDays,
  chartUrl,
  coinGecko,
  dailyCloses,
  GLOBAL_URL,
  marketsUrls,
  MAX_SYMBOLS_PER_CALL,
  toLiveCoin,
} from "../../src/providers/coingecko/index.js";
import { ChartResponseSchema, MarketRowSchema } from "../../src/providers/coingecko/schemas.js";
import { fixture, fixtureJson, stubFetch } from "../helpers.js";
import { failureOf, providerCall } from "./call.js";

const MARKETS = fixture("crypto/coingecko-markets.json");
const GLOBAL = fixture("crypto/coingecko-global.json");
const CHART_RVN = fixture("crypto/coingecko-chart-rvn.json");
const ERROR_429 = fixture("crypto/coingecko-error-429.json");

const reply = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/json" } });
const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

/** Answers each endpoint from its fixture. */
function coinGeckoStub(markets = MARKETS) {
  return stubFetch((url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/coins/markets")) return reply(markets);
    if (path.endsWith("/global")) return reply(GLOBAL);
    if (path.endsWith("/coins/ravencoin/market_chart")) return reply(CHART_RVN);
    return reply(JSON.stringify({ error: "coin not found" }), 404);
  });
}

describe("coingecko: requests", () => {
  it("asks for the top coin per symbol, lower-case, 50 symbols a call", () => {
    const [url] = marketsUrls({ symbols: ["BTC", "rvn", "BTC"], limit: 100 });
    expect(params(url)).toEqual({ vs_currency: "usd", price_change_percentage: "24h,7d", symbols: "btc,rvn", include_tokens: "top" });
    const many = Array.from({ length: 101 }, (_, i) => `C${i}`);
    const urls = marketsUrls({ symbols: many, limit: 100 });
    expect(urls.map((u) => params(u).symbols.split(",").length)).toEqual([MAX_SYMBOLS_PER_CALL, MAX_SYMBOLS_PER_CALL, 1]);
  });

  it("lists the largest coins by market cap, at most 250 a page", () => {
    expect(params(marketsUrls({ limit: 20 })[0])).toEqual({ vs_currency: "usd", price_change_percentage: "24h,7d", order: "market_cap_desc", per_page: "20", page: "1" });
    expect(params(marketsUrls({ limit: 1000 })[0]).per_page).toBe("250");
  });

  it("sends the demo key header only when a key is set, and a descriptive user agent always", async () => {
    const keyed = coinGeckoStub();
    await coinGecko({ apiKey: "demo-key" }).snapshot!({ symbols: ["BTC"], limit: 1, totals: false }, providerCall(keyed.fetch));
    expect(keyed.calls).toHaveLength(1);
    expect(keyed.calls[0].headers.get("x-cg-demo-api-key")).toBe("demo-key");
    expect(keyed.calls[0].headers.get("user-agent")).toMatch(/mcpy/);

    const keyless = coinGeckoStub();
    await coinGecko().snapshot!({ symbols: ["BTC"], limit: 1, totals: false }, providerCall(keyless.fetch));
    expect(keyless.calls[0].headers.has("x-cg-demo-api-key")).toBe(false);
    expect(keyless.calls[0].headers.get("user-agent")).toMatch(/mcpy/);
  });

  it("asks for enough chart days to reach from's close, never past the plan's 365", () => {
    expect(chartDays("2026-11-20", "2026-11-25")).toBe(6);
    expect(chartDays("2024-01-01", "2026-11-25")).toBe(365);
    expect(params(chartUrl("ravencoin", 6))).toEqual({ vs_currency: "usd", days: "6", interval: "daily" });
  });
});

describe("coingecko: snapshot", () => {
  it("maps the live markets rows with their exact values", async () => {
    const { fetch } = coinGeckoStub();
    const snap = await coinGecko().snapshot!({ symbols: ["BTC", "ETH", "ZEC", "RVN"], limit: 4, totals: false }, providerCall(fetch));
    expect(snap.totals).toBeUndefined();
    expect(snap.coins.map((c) => c.symbol)).toEqual(["BTC", "ETH", "ZEC", "RVN"]);
    expect(snap.coins[3]).toEqual({
      symbol: "RVN",
      name: "Ravencoin",
      asOf: "2026-11-25T18:02:54.000Z",
      priceUsd: 0.00084974,
      priceChange24hPct: -0.3056,
      priceChange7dPct: -21.238,
      high24hUsd: 0.00085875,
      low24hUsd: 0.00080365,
      allTimeHighUsd: 0.285218,
      allTimeHighDate: "2021-02-20",
      marketCapUsd: 14093244,
      marketCapRank: 916,
      fullyDilutedValueUsd: 14093244,
      volume24hUsd: 1859281,
      supply: 16585238379.119675,
      totalSupply: 16585238379.119675,
      maxSupply: 21000000000,
    });
    expect(snap.coins[0]).toMatchObject({
      symbol: "BTC",
      priceUsd: 59596,
      priceChange24hPct: -0.79319,
      high24hUsd: 60001,
      low24hUsd: 57308,
      allTimeHighUsd: 126080,
      allTimeHighDate: "2025-10-06",
      marketCapUsd: 1198856716024,
      marketCapRank: 1,
      volume24hUsd: 33974617466,
      supply: 20117275,
      maxSupply: 21000000,
    });
    // ZEC: circulating and total supply differ; ETH: no max supply (null live).
    expect(snap.coins[2]).toMatchObject({ supply: 17060982.03206168, totalSupply: 17061291.75865911, fullyDilutedValueUsd: 12555421867 });
    expect(snap.coins[1].maxSupply).toBeUndefined();
    expect(snap.coins[1].totalSupply).toBe(122250721.3439204);
  });

  it("reads 0 and null amounts as no figure, keeps a 0 percent change", () => {
    const rows = fixtureJson<{ symbol: string }[]>("crypto/coingecko-markets.json");
    const btc = rows.find((r) => r.symbol === "btc")!;
    const fund = toLiveCoin(MarketRowSchema.parse(rows.find((r) => r.symbol === "buidl")))!;
    expect(fund).toMatchObject({ symbol: "BUIDL", priceUsd: 1, priceChange24hPct: 0, priceChange7dPct: 0, high24hUsd: 1, low24hUsd: 1 });
    expect(fund.volume24hUsd).toBeUndefined();
    expect(fund.maxSupply).toBeUndefined();
    const nulled = toLiveCoin(MarketRowSchema.parse({ ...btc, market_cap: null, price_change_percentage_7d_in_currency: null, ath: 0 }))!;
    expect(nulled.marketCapUsd).toBeUndefined();
    expect(nulled.priceChange7dPct).toBeUndefined();
    expect(nulled.allTimeHighUsd).toBeUndefined();
    expect(nulled.priceUsd).toBe(59596);
  });

  it("falls back to the plain 24 h change, and a bad field never sinks the row", () => {
    const btc = fixtureJson<{ symbol: string }[]>("crypto/coingecko-markets.json").find((r) => r.symbol === "btc")!;
    const coin = toLiveCoin(
      MarketRowSchema.parse({
        ...btc,
        price_change_percentage_24h_in_currency: null,
        price_change_percentage_24h: -1.5,
        market_cap_rank: "first",
        ath_date: "long ago",
        high_24h: 1,
        low_24h: 2,
      }),
    );
    expect(coin).toMatchObject({ symbol: "BTC", priceUsd: 59596, priceChange24hPct: -1.5 });
    expect(coin.marketCapRank).toBeUndefined();
    expect(coin.allTimeHighDate).toBeUndefined();
    // A crossed 24 h range is dropped whole.
    expect(coin.high24hUsd).toBeUndefined();
    expect(coin.low24hUsd).toBeUndefined();
  });

  it("skips a bad row, not the response", async () => {
    const rows = fixtureJson<{ symbol: string }[]>("crypto/coingecko-markets.json");
    const [btc, rvn] = ["btc", "rvn"].map((sym) => rows.find((r) => r.symbol === sym)!);
    const { fetch } = coinGeckoStub(JSON.stringify([{ ...btc, last_updated: "yesterday" }, { symbol: "eth" }, rvn]));
    const snap = await coinGecko().snapshot!({ symbols: ["BTC", "ETH", "RVN"], limit: 3, totals: false }, providerCall(fetch));
    expect(snap.coins.map((c) => c.symbol)).toEqual(["RVN"]);
  });

  it("reports totals only when asked, from /global", async () => {
    const without = coinGeckoStub();
    await coinGecko().snapshot!({ limit: 5, totals: false }, providerCall(without.fetch));
    expect(without.calls.map((c) => c.url)).not.toContain(GLOBAL_URL);

    const { fetch, calls } = coinGeckoStub();
    const snap = await coinGecko().snapshot!({ limit: 3, totals: true }, providerCall(fetch));
    expect(calls.map((c) => new URL(c.url).pathname).sort()).toEqual(["/api/v3/coins/markets", "/api/v3/global"]);
    expect(snap.coins).toHaveLength(3);
    expect(snap.totals).toEqual({
      asOf: "2026-11-25T17:56:58.000Z",
      totalMarketCapUsd: 2080171636974.3108,
      totalVolume24hUsd: 79391663755.15132,
      btcDominancePct: 57.76674630967945,
      totalMarketCapChange24hPct: -2.2234378208148464,
      activeCoins: 21248,
      markets: 1526,
    });
  });

  it("leaves out symbols CoinGecko does not know", async () => {
    const { fetch } = coinGeckoStub();
    const snap = await coinGecko().snapshot!({ symbols: ["RVN", "NOTACOINXYZ"], limit: 2, totals: false }, providerCall(fetch));
    expect(snap.coins.map((c) => c.symbol)).toEqual(["RVN"]);
  });
});

describe("coingecko: history", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T18:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("dates each midnight point as the close of the day before, drops the live point", () => {
    const chart = ChartResponseSchema.parse(JSON.parse(CHART_RVN));
    const days = dailyCloses(chart, "RVN", "2026-11-01", "2026-11-25");
    // Midnights 11-21..11-25 close 11-20..11-24; the 17:39 point (today, live) is gone.
    expect(days.map((d) => d.date)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]);
    expect(days[4]).toEqual({ symbol: "RVN", date: "2026-11-24", priceUsd: 0.0008423752210867018, marketCapUsd: 13969886.122970859, volumeUsd: 2193465.2838047585 });
    expect(days[0].priceUsd).toBe(0.0009522192683916676);
  });

  it("resolves ids with one markets call, then one chart per known coin, keeping only from..to", async () => {
    const { fetch, calls } = coinGeckoStub();
    const days = await coinGecko().history!({ symbols: ["RVN", "NOTACOINXYZ"], from: "2026-11-22", to: "2026-11-23" }, providerCall(fetch));
    expect(calls).toHaveLength(2);
    expect(params(calls[0].url)).toMatchObject({ symbols: "rvn,notacoinxyz", include_tokens: "top" });
    expect(new URL(calls[1].url).pathname).toBe("/api/v3/coins/ravencoin/market_chart");
    expect(params(calls[1].url).days).toBe("4");
    expect(days).toEqual([
      expect.objectContaining({ symbol: "RVN", name: "Ravencoin", date: "2026-11-22", priceUsd: 0.0009078279050449821 }),
      expect.objectContaining({ symbol: "RVN", name: "Ravencoin", date: "2026-11-23", priceUsd: 0.0008756521669243726 }),
    ]);
  });

  it("never reports today, even when asked", async () => {
    const { fetch } = coinGeckoStub();
    const days = await coinGecko().history!({ symbols: ["RVN"], from: "2026-11-24", to: "2026-11-25" }, providerCall(fetch));
    expect(days.map((d) => d.date)).toEqual(["2026-11-24"]);
  });

  it("makes no chart call when no symbol is known", async () => {
    const { fetch, calls } = coinGeckoStub("[]");
    expect(await coinGecko().history!({ symbols: ["NOTACOINXYZ"], from: "2026-11-22", to: "2026-11-23" }, providerCall(fetch))).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("coingecko: errors", () => {
  it("fails a 429 with its status, so the engine falls back and counts it as rate limited", async () => {
    const { fetch } = stubFetch(() => reply(ERROR_429, 429));
    const err = await failureOf(coinGecko({ apiKey: "k" }).snapshot!({ limit: 5, totals: true }, providerCall(fetch)));
    expect(err.code).toBe(ErrorCode.RateLimited);
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/exceeded the Rate Limit/);
    // The engine's quota alert keys on the status (alerts only for paid sources).
    expect(quotaAlertFor({ id: "coingecko", costPerCall: 0.001 }, err)).toMatchObject({ kind: "rate_limited", status: 429 });
  });

  it("reports a chart failure during history, not a silent empty answer", async () => {
    const { fetch } = stubFetch((url) => (url.includes("/market_chart") ? reply(ERROR_429, 429) : reply(MARKETS)));
    const err = await failureOf(coinGecko().history!({ symbols: ["RVN"], from: "2026-01-01", to: "2026-01-02" }, providerCall(fetch)));
    expect(err.status).toBe(429);
  });
});
