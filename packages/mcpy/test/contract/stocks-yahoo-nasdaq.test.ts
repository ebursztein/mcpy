/**
 * Yahoo's chart API and Nasdaq's quote API against answers recorded live on
 * 2026-11-28 (from a Cloudflare Worker for Yahoo): Apple and SPY after the
 * 27 November session, SAP on XETRA while its session was still open, Apple
 * around its August 2020 split, and unknown symbols.
 */

import { describe, expect, it } from "vitest";
import { ErrorCode, InstrumentType, USER_AGENTS, UserAgentProfile } from "mcpy";
import { figure, nasdaq, nasdaqSymbol, range, tradeDay } from "../../src/providers/nasdaq/index.js";
import { historyUrl, quoteUrl, yahoo } from "../../src/providers/yahoo/index.js";
import { fixture, stubFetch } from "../helpers.js";
import { failureOf, json, providerCall } from "./call.js";

const f = (name: string) => fixture(`stocks/${name}`);

describe("yahoo: quotes from the chart's meta", () => {
  it("reads Apple's quote, taking the previous close from the last session before the market day", async () => {
    const { fetch, calls } = stubFetch(() => json(f("yahoo-chart-aapl-5d.json")));
    const [aapl] = await yahoo().quotes!(["AAPL"], providerCall(fetch));
    expect(calls.map((c) => c.url)).toEqual([quoteUrl("AAPL")]);
    expect(aapl).toEqual({
      symbol: "AAPL",
      name: "Apple Inc.",
      instrumentType: InstrumentType.Stock,
      exchange: "NasdaqGS",
      currency: "USD",
      price: 358.54,
      // The bars are 11-20, 11-23, 11-24, 11-25 and 11-27 (Thanksgiving closed the market on the 26th).
      previousClose: 355.58,
      open: 358.21,
      dayHigh: 359.5,
      dayLow: 355.64,
      volume: 22683910,
      fiftyTwoWeekHigh: 360.83,
      fiftyTwoWeekLow: 243.42,
      marketDate: "2026-11-27",
      // 13:00 in New York: the market closes early the day after Thanksgiving.
      asOf: "2026-11-27T18:00:01.000Z",
    });
  });

  it("reads an open session: today's bar has no close yet, so the previous close is yesterday's and the open comes from the raw series", async () => {
    const { fetch } = stubFetch(() => json(f("yahoo-chart-sap-open-session.json")));
    const [sap] = await yahoo().quotes!(["SAP.DE"], providerCall(fetch));
    expect(sap).toMatchObject({ symbol: "SAP.DE", currency: "EUR", exchange: "XETRA", price: 195.64, previousClose: 194.14, open: 192.6, marketDate: "2026-11-27" });
  });

  it("leaves out a symbol Yahoo does not know (404), and asks for each symbol once", async () => {
    const { fetch, calls } = stubFetch((url) => (url.includes("/ZZZZQ?") ? json(f("yahoo-chart-unknown.json"), 404) : json(f("yahoo-chart-aapl-5d.json"))));
    const quotes = await yahoo().quotes!(["AAPL", "ZZZZQ"], providerCall(fetch));
    expect(quotes.map((q) => q.symbol)).toEqual(["AAPL"]);
    expect(calls).toHaveLength(2);
  });

  it("presents mcpy's own user agent, and fails rate_limited on a 429 so the next source answers", async () => {
    const { fetch, calls } = stubFetch(() => new Response("Too Many Requests\r\n", { status: 429 }));
    const failure = await failureOf(yahoo().quotes!(["AAPL"], providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.RateLimited);
    expect(calls[0]!.headers.get("user-agent")).toBe(USER_AGENTS[UserAgentProfile.Default]);
  });
});

describe("yahoo: history", () => {
  it("asks a day either side of the window and keeps the window's bars, dividends and splits", async () => {
    expect(historyUrl("AAPL", "2020-08-01", "2020-08-31")).toBe(
      "https://query2.finance.yahoo.com/v8/finance/chart/AAPL?period1=1596153600&period2=1599004800&interval=1d&events=div%2Csplit",
    );
    const { fetch } = stubFetch(() => json(f("yahoo-chart-aapl-2020-08-split.json")));
    const h = await yahoo().history!({ symbol: "AAPL", from: "2020-08-01", to: "2020-08-31" }, providerCall(fetch));
    expect(h?.bars.map((b) => b.date)).toEqual(["2020-08-24", "2020-08-25", "2020-08-26", "2020-08-27", "2020-08-28"]);
    // Prices are already split-adjusted (125, not 500); float noise is rounded off.
    expect(h?.bars[0]).toEqual({ date: "2020-08-24", open: 128.6975, high: 128.785, low: 123.9375, close: 125.8575, adjClose: 121.8806, volume: 345937600 });
    expect(h?.dividends).toEqual([{ date: "2020-08-07", amount: 0.205 }]);
    expect(h?.splits).toEqual([{ date: "2020-08-31", ratio: "4:1" }]);
  });

  it("drops events outside the window", async () => {
    const { fetch } = stubFetch(() => json(f("yahoo-chart-aapl-2020-08-split.json")));
    const h = await yahoo().history!({ symbol: "AAPL", from: "2020-08-20", to: "2020-08-28" }, providerCall(fetch));
    expect(h?.dividends).toBeUndefined();
    expect(h?.splits).toBeUndefined();
  });
});

describe("nasdaq: display text", () => {
  it("parses prices, volumes, ranges and trade days", () => {
    expect([figure("$358.54"), figure("+2.96"), figure("-1.5"), figure("21,368,018.437203"), figure("N/A"), figure("NA"), figure("")]).toEqual([358.54, 2.96, -1.5, 21368018.437203, undefined, undefined, undefined]);
    expect(range("243.42 - 360.83")).toEqual([243.42, 360.83]);
    expect(range("NA")).toEqual([undefined, undefined]);
    expect(tradeDay("Nov 27, 2026")).toBe("2026-11-27");
    expect(tradeDay("Feb 3, 2026 4:00 PM ET")).toBe("2026-02-03");
  });

  it("asks only for US tickers, writing a share class with a dot", () => {
    expect([nasdaqSymbol("AAPL"), nasdaqSymbol("BRK-B"), nasdaqSymbol("^GSPC"), nasdaqSymbol("SAP.DE"), nasdaqSymbol("EURUSD=X")]).toEqual(["AAPL", "BRK.B", undefined, undefined, undefined]);
  });
});

describe("nasdaq: quotes and history", () => {
  const reply = (url: string) =>
    url.includes("/AAPL/info?assetclass=stocks")
      ? json(f("nasdaq-info-aapl.json"))
      : url.includes("/SPY/info?assetclass=etf")
        ? json(f("nasdaq-info-spy-etf.json"))
        : url.includes("/SPY/historical")
          ? json(f("nasdaq-history-spy.json"))
          : json(f("nasdaq-info-unknown.json"));

  it("reads a stock, asks an ETF again as an ETF, and never asks for a non-US symbol", async () => {
    const { fetch, calls } = stubFetch(reply);
    const quotes = await nasdaq().quotes!(["AAPL", "SPY", "^GSPC"], providerCall(fetch));
    expect(quotes).toEqual([
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        instrumentType: InstrumentType.Stock,
        exchange: "NASDAQ-GS",
        currency: "USD",
        price: 358.54,
        previousClose: 355.58,
        dayHigh: undefined,
        dayLow: undefined,
        volume: 21368018,
        fiftyTwoWeekHigh: 360.83,
        fiftyTwoWeekLow: 243.42,
        marketDate: "2026-11-27",
      },
      expect.objectContaining({ symbol: "SPY", instrumentType: InstrumentType.Etf, price: 728.68, previousClose: 716.7, marketDate: "2026-11-27" }),
    ]);
    expect(calls.map((c) => new URL(c.url).pathname + new URL(c.url).search)).toEqual([
      "/api/quote/AAPL/info?assetclass=stocks",
      "/api/quote/SPY/info?assetclass=stocks",
      "/api/quote/SPY/info?assetclass=etf",
    ]);
    // Nasdaq answers a Worker only when it looks like a browser.
    expect(calls[0]!.headers.get("user-agent")).toBe(USER_AGENTS[UserAgentProfile.Chrome]);
  });

  it("returns the window's daily bars oldest first", async () => {
    const { fetch } = stubFetch(reply);
    const h = await nasdaq().history!({ symbol: "SPY", from: "2026-11-20", to: "2026-11-27" }, providerCall(fetch));
    expect(h?.bars.map((b) => b.date)).toEqual(["2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25"]);
    expect(h?.bars[0]).toEqual({ date: "2026-11-20", open: 713.56, high: 718.29, low: 686.75, close: 689.81, volume: 151413300 });
  });

  it("knows nothing about a symbol it has no record of", async () => {
    const { fetch } = stubFetch(() => json(f("nasdaq-info-unknown.json")));
    expect(await nasdaq().quotes!(["ZZZZQ"], providerCall(fetch))).toEqual([]);
    expect(await nasdaq().history!({ symbol: "ZZZZQ", from: "2026-11-20", to: "2026-11-27" }, providerCall(fetch))).toBeUndefined();
  });
});
