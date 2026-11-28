/**
 * The stock sources against their real APIs, one at a time, through the
 * public SDK. Yahoo, Nasdaq and EDGAR need no key; Alpha Vantage is skipped
 * without ALPHAVANTAGE_API_KEY and spends 2 of its 25 requests a day.
 */

import { describe, expect, it } from "vitest";
import { createMcpy, InstrumentType, LayeredCache } from "mcpy";
import { alphaVantage, edgar, nasdaq, yahoo, type StockProvider } from "mcpy/providers";
import { has, k } from "./keys.js";

const sdk = (stocks: StockProvider[]) => createMcpy({ cache: new LayeredCache(), stocks });
const lastMonth = () => {
  const to = new Date().toISOString().slice(0, 10);
  return { from: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10), to };
};

describe("yahoo (live)", () => {
  it("quotes a stock, an index, a foreign listing and a currency, and knows an unknown symbol is missing", async () => {
    const r = await sdk([yahoo()]).stockQuote({ symbols: ["AAPL", "^GSPC", "SAP.DE", "EURUSD=X", "ZZZZZQ"], max_age: 0 });
    expect(r.quotes.map((q) => q.symbol)).toEqual(["AAPL", "^GSPC", "SAP.DE", "EURUSD=X"]);
    expect(r.missing).toEqual(["ZZZZZQ"]);
    const [aapl, spx, sap] = r.quotes;
    expect(aapl).toMatchObject({ instrument_type: InstrumentType.Stock, currency: "USD" });
    expect(aapl!.price).toBeGreaterThan(10);
    expect(aapl!.previous_close).toBeGreaterThan(10);
    expect(spx!.instrument_type).toBe(InstrumentType.Index);
    expect(sap!.currency).toBe("EUR");
  });

  it("gives a month of daily bars, oldest first", async () => {
    const r = await sdk([yahoo()]).stockHistory({ symbol: "MSFT", ...lastMonth(), max_age: 0 });
    expect(r.bars.length).toBeGreaterThan(15);
    expect(r.bars.map((b) => b.date)).toEqual([...r.bars.map((b) => b.date)].sort());
    expect(r.bars.every((b) => b.adj_close !== undefined)).toBe(true);
  });
});

describe("nasdaq (live)", () => {
  it("quotes a stock, a share class and an ETF", async () => {
    const r = await sdk([nasdaq()]).stockQuote({ symbols: ["AAPL", "BRK-B", "SPY"], max_age: 0 });
    expect(r.quotes.map((q) => [q.symbol, q.instrument_type])).toEqual([
      ["AAPL", InstrumentType.Stock],
      ["BRK-B", InstrumentType.Stock],
      ["SPY", InstrumentType.Etf],
    ]);
    expect(r.quotes.every((q) => q.price > 0 && q.previous_close !== undefined)).toBe(true);
  });

  it("gives a month of daily bars", async () => {
    const r = await sdk([nasdaq()]).stockHistory({ symbol: "AAPL", ...lastMonth(), max_age: 0 });
    expect(r.bars.length).toBeGreaterThan(15);
  });
});

describe("edgar (live)", () => {
  it("reads Apple's fiscal years and Alphabet's share count", async () => {
    // The source's own default user agent: the one SEC must keep accepting.
    const mcpy = sdk([edgar()]);
    const apple = await mcpy.stockFundamentals({ symbol: "AAPL", years: 3, max_age: 0 });
    expect(apple.name).toBe("Apple Inc.");
    expect(apple.years).toHaveLength(3);
    for (const y of apple.years) {
      expect(y.revenue_usd).toBeGreaterThan(2e11);
      expect(y.net_income_usd).toBeGreaterThan(5e10);
      expect(y.free_cash_flow_usd).toBeGreaterThan(0);
    }
    expect(apple.shares_outstanding).toBeGreaterThan(1e10);
    const alphabet = await mcpy.stockFundamentals({ symbol: "GOOGL", years: 1, max_age: 0 });
    expect(alphabet.shares_outstanding).toBeGreaterThan(1e10);
  });
});

describe.skipIf(!has("ALPHAVANTAGE_API_KEY"))("alpha vantage (live)", () => {
  it("quotes a stock", async () => {
    const r = await sdk([alphaVantage({ apiKey: k.ALPHAVANTAGE_API_KEY! })]).stockQuote({ symbols: ["IBM"], max_age: 0 });
    expect(r.quotes[0]!.price).toBeGreaterThan(10);
  });
});
