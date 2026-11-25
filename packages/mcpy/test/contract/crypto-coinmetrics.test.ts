/**
 * Coin Metrics community API against responses recorded live on 2026-11-25
 * (test/fixtures/crypto/coinmetrics-*.json): BTC, ZEC and RVN over
 * 2026-11-20..22 with every metric, a two-page read with page_size=3 (price
 * and hashrate only), and a 403 refusal.
 */

import { describe, expect, it } from "vitest";
import { ErrorCode } from "mcpy";
import { assetFor, coinMetrics, coinMetricsUrl, COIN_METRICS_CAPABILITIES, MAX_PAGES, parsePage } from "../../src/providers/coinmetrics/index.js";
import { MetricPageSchema } from "../../src/providers/coinmetrics/schemas.js";
import { fixture, fixtureJson, stubFetch } from "../helpers.js";
import { failureOf, json, providerCall } from "./call.js";

const params = (url: string) => Object.fromEntries(new URL(url).searchParams);
const reply = (name: string, status = 200) => () => json(fixture(`crypto/${name}`), status);
const window = { from: "2026-11-20", to: "2026-11-22" };

describe("coinmetrics: request", () => {
  it("asks for every asset and metric over the days in one request", () => {
    const url = coinMetricsUrl(["btc", "zec", "rvn"], "2026-11-20", "2026-11-22");
    expect(url.startsWith("https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?")).toBe(true);
    expect(params(url)).toEqual({
      assets: "btc,zec,rvn",
      metrics:
        "PriceUSD,PriceBTC,CapMrktCurUSD,CapMrktEstUSD,CapMVRVCur,SplyCur,SplyExpFut10yr,volume_reported_spot_usd_1d,HashRate,BlkCnt," +
        "IssTotNtv,IssTotUSD,FeeTotNtv,TxCnt,TxTfrCnt,AdrActCnt,AdrBalCnt,FlowInExNtv,FlowInExUSD,FlowOutExNtv,FlowOutExUSD,SplyExNtv,SplyExUSD,ROI30d,ROI1yr",
      frequency: "1d",
      start_time: "2026-11-20",
      end_time: "2026-11-22",
      page_size: "2500",
      paging_from: "start",
      ignore_unsupported_errors: "true",
      ignore_forbidden_errors: "true",
    });
    expect(params(coinMetricsUrl(["btc"], "2026-11-20", "2026-11-20", "1.MjAy")).next_page_token).toBe("1.MjAy");
  });

  it("maps tickers to assets, with a HashRate unit only where one is known", () => {
    expect(assetFor("btc")).toEqual({ asset: "btc", hashrateHs: 1e12 });
    expect(assetFor("XMR")).toEqual({ asset: "xmr", hashrateHs: 1 });
    expect(assetFor("RVN")).toEqual({ asset: "rvn" });
    expect(assetFor("FOO")).toEqual({ asset: "foo" });
    expect(assetFor("BT,C")).toBeUndefined();
  });

  it("calls nothing for no usable symbol or an empty window", async () => {
    const { fetch, calls } = stubFetch(reply("coinmetrics-btc-zec-rvn.json"));
    expect(await coinMetrics().history!({ symbols: ["a,b"], ...window }, providerCall(fetch))).toEqual([]);
    expect(await coinMetrics().history!({ symbols: ["BTC"], from: "2026-11-22", to: "2026-11-20" }, providerCall(fetch))).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("is free, history only", () => {
    const p = coinMetrics();
    expect(p).toMatchObject({ id: "coinmetrics", costPerCall: 0, capabilities: { totals: false, live: false, history: true } });
    expect(COIN_METRICS_CAPABILITIES).toEqual({ totals: false, live: false, history: true });
  });
});

describe("coinmetrics: mapping the live response", () => {
  it("maps every metric exactly, BTC hashrate in H/s", async () => {
    const { fetch, calls } = stubFetch(reply("coinmetrics-btc-zec-rvn.json"));
    const days = await coinMetrics().history!({ symbols: ["BTC", "zec", "RVN"], ...window }, providerCall(fetch));
    expect(calls).toHaveLength(1);
    expect(params(calls[0].url).assets).toBe("btc,zec,rvn");
    expect(days).toHaveLength(9);
    expect(days.find((d) => d.symbol === "BTC" && d.date === "2026-11-20")).toEqual({
      symbol: "BTC",
      date: "2026-11-20",
      priceUsd: 58851.0193890006,
      priceBtc: 1,
      marketCapUsd: 1183782066898.72802165806095108,
      marketCapEstimatedUsd: 1183754945332.7728946604,
      mvrv: 1.104933597125702049,
      supply: 20114894.8512518,
      supplyExpected10yCoins: 20848596.875,
      reportedSpotVolumeUsd: 22798535440.3709,
      // "978510879.725157058725939387528794019798" TH/s: 979 EH/s.
      networkHashrateHs: 978510879.725157058725939387528794019798 * 1e12,
      blocks: 146,
      issuedCoins: 456.25,
      issuedUsd: 26850777.59623152375,
      feesCoins: 4.22325131,
      txCount: 550970,
      transfers: 955711,
      activeAddresses: 739586,
      addressesWithBalance: 57207404,
      exchangeInflowCoins: 41305.47709901,
      exchangeInflowUsd: 2430869433.625757765991149406,
      exchangeOutflowCoins: 41820.85523016,
      exchangeOutflowUsd: 2461199962.014733310085378096,
      supplyOnExchangesCoins: 2709906.0558609,
      supplyOnExchangesUsd: 159480733835.83996893062361654,
      // Coin Metrics states ROI in percent already.
      roi30dPct: -30.085815784264035,
      roi1yPct: -32.286111583525965,
    });
    // ZEC: every metric but the exchange ones, which Coin Metrics has for BTC and ETH only.
    const zec = days.find((d) => d.symbol === "ZEC" && d.date === "2026-11-20");
    expect(zec).toMatchObject({ priceBtc: 0.012888812121993885, mvrv: 1.071287130258905494, transfers: 9930, roi1yPct: 12.29057022074576, issuedUsd: 1367310.82081830169492448424 });
    expect(Object.keys(zec!).filter((k) => /exchange|Exchanges/.test(k))).toEqual([]);
    // ZEC states GSol/s: 36.2 GSol/s.
    expect(days.find((d) => d.symbol === "ZEC" && d.date === "2026-11-20")?.networkHashrateHs).toBe(36.20138634972685 * 1e9);
  });

  it("reports RVN's price, volume and estimated cap, nothing else invented", async () => {
    const { fetch } = stubFetch(reply("coinmetrics-btc-zec-rvn.json"));
    const days = await coinMetrics().history!({ symbols: ["RVN"], ...window }, providerCall(fetch));
    expect(days).toEqual([
      { symbol: "RVN", date: "2026-11-20", priceUsd: 0.000952712048132862, reportedSpotVolumeUsd: 1235051.40727002, marketCapEstimatedUsd: 15791209.79588338478085086576154 },
      { symbol: "RVN", date: "2026-11-21", priceUsd: 0.000928011574882619, reportedSpotVolumeUsd: 716546.587974284, marketCapEstimatedUsd: 15383495.89193085898370356158273 },
      { symbol: "RVN", date: "2026-11-22", priceUsd: 0.000903418301722046, reportedSpotVolumeUsd: 516393.535469013, marketCapEstimatedUsd: 14977436.60781195875159857752282 },
    ]);
  });

  it("never reports a day outside the window, nor an asset not asked for", () => {
    const page = MetricPageSchema.parse(JSON.parse(fixture("crypto/coinmetrics-btc-zec-rvn.json")));
    const days = parsePage(page, new Map([["btc", { symbol: "BTC", hashrateHs: 1e12 }]]), "2026-11-21", "2026-11-21");
    expect(days.map((d) => [d.symbol, d.date])).toEqual([["BTC", "2026-11-21"]]);
  });

  it("never reports HashRate without a known unit; leaves out null, negative fees and empty days", () => {
    const page = MetricPageSchema.parse({
      data: [
        { asset: "foo", time: "2026-11-20T00:00:00.000000000Z", HashRate: "12.5", PriceUSD: "2" },
        // DASH states fees negative (other payments netted out): never the miners' fees.
        { asset: "dash", time: "2026-11-20T00:00:00.000000000Z", HashRate: "3.5", FeeTotNtv: "-12.25", IssTotNtv: null },
        { asset: "dash", time: "2026-11-21T00:00:00.000000000Z", PriceUSD: null },
      ],
    });
    const assets = new Map([
      ["foo", { symbol: "FOO" }],
      ["dash", { symbol: "DASH", hashrateHs: 1e9 }],
    ]);
    expect(parsePage(page, assets, "2026-11-20", "2026-11-21")).toEqual([
      { symbol: "FOO", date: "2026-11-20", priceUsd: 2 },
      { symbol: "DASH", date: "2026-11-20", networkHashrateHs: 3.5e9 },
    ]);
  });
});

describe("coinmetrics: paging and failures", () => {
  it("follows next_page_token until the last page", async () => {
    const { fetch, calls } = stubFetch((_url, n) => reply(n === 1 ? "coinmetrics-page-1.json" : "coinmetrics-page-2.json")());
    const days = await coinMetrics().history!({ symbols: ["BTC", "RVN"], from: "2026-11-20", to: "2026-11-21" }, providerCall(fetch));
    expect(calls).toHaveLength(2);
    expect(params(calls[0].url)).not.toHaveProperty("next_page_token");
    expect(params(calls[1].url).next_page_token).toBe("1.MjAyNi0xMS0yMFQwMDowMDowMFo");
    expect(days.map((d) => `${d.symbol} ${d.date}`)).toEqual(["BTC 2026-11-20", "BTC 2026-11-21", "RVN 2026-11-20", "RVN 2026-11-21"]);
    expect(days[1]).toEqual({ symbol: "BTC", date: "2026-11-21", priceUsd: 60122.6111387551, networkHashrateHs: 1099149207.230298802946790277256069019798 * 1e12 });
  });

  it(`gives up after ${MAX_PAGES} pages`, async () => {
    const { fetch, calls } = stubFetch(reply("coinmetrics-page-1.json"));
    const failure = await failureOf(coinMetrics().history!({ symbols: ["BTC"], ...window }, providerCall(fetch)));
    expect(calls).toHaveLength(MAX_PAGES);
    expect(failure.code).toBe(ErrorCode.TooLarge);
  });

  it("keeps Coin Metrics' own words when it refuses", async () => {
    const { fetch } = stubFetch(reply("coinmetrics-error-forbidden.json", 403));
    const failure = await failureOf(coinMetrics().history!({ symbols: ["BTC"], ...window }, providerCall(fetch)));
    const body = fixtureJson<{ error: { message: string } }>("crypto/coinmetrics-error-forbidden.json");
    expect(failure).toMatchObject({ code: ErrorCode.UpstreamFailed, status: 403 });
    expect(failure.message).toBe(`forbidden: ${body.error.message}`);
  });

  it("fails on an HTTP error without a body of its own, and on a malformed figure", async () => {
    const down = stubFetch(() => new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    expect(await failureOf(coinMetrics().history!({ symbols: ["BTC"], ...window }, providerCall(down.fetch)))).toMatchObject({ code: ErrorCode.UpstreamFailed, status: 502 });
    const bad = stubFetch(() => json({ data: [{ asset: "btc", time: "2026-11-20T00:00:00Z", PriceUSD: "lots" }] }));
    expect((await failureOf(coinMetrics().history!({ symbols: ["BTC"], ...window }, providerCall(bad.fetch)))).code).toBe(ErrorCode.BadResponse);
  });
});
