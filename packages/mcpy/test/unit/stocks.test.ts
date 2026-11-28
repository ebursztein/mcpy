import { describe, expect, it } from "vitest";
import { BarInterval, ErrorCode, LayeredCache, McpyError, StockHistoryInputSchema, StockQuoteInputSchema } from "mcpy";
import type { FiledFact, FoundBar, FoundFundamentals, FoundHistory, FoundQuote, StockProvider } from "mcpy/providers";
import { aggregate, weekOf } from "../../src/services/stocks/history.js";
import { fiscalYears, latestBalanceSheet, settle, sharesOutstanding } from "../../src/services/stocks/filings.js";
import { fakeKv, mentionsProvider, testMcpy } from "../helpers.js";

const quote = (symbol: string, over: Partial<FoundQuote> = {}): FoundQuote => ({ symbol, price: 110, previousClose: 100, marketDate: "2026-11-27", currency: "USD", ...over });

/** A stock source that knows `known` symbols, recording what it was asked. */
function fakeStocks(id: string, known: Record<string, FoundQuote | FoundHistory>, options: { fail?: boolean; filings?: Record<string, FoundFundamentals>; directory?: Record<string, string> } = {}) {
  const asked: string[][] = [];
  let directoryCalls = 0;
  const provider: StockProvider = {
    id,
    costPerCall: 0,
    capabilities: { quotes: true, history: true, fundamentals: options.filings !== undefined },
    async quotes(symbols) {
      asked.push(symbols);
      if (options.fail) throw new McpyError(ErrorCode.UpstreamFailed, "down");
      return symbols.flatMap((s) => (known[s] && "price" in known[s]! ? [known[s] as FoundQuote] : []));
    },
    async history(req) {
      asked.push([req.symbol]);
      const h = known[req.symbol];
      return h && "bars" in h ? h : undefined;
    },
    ...(options.directory
      ? {
          async directory() {
            directoryCalls++;
            return options.directory!;
          },
        }
      : {}),
    async fundamentals(symbol, cik) {
      asked.push([symbol, cik ?? ""]);
      return options.filings?.[symbol];
    },
  };
  return { provider, asked, directoryCalls: () => directoryCalls };
}

describe("stock_quote", () => {
  it("asks each source only for what earlier ones did not know, keeps the order asked, and works out the change", async () => {
    const first = fakeStocks("first", { AAPL: quote("AAPL") });
    const second = fakeStocks("second", { "BRK-B": quote("BRK-B", { price: 99, previousClose: 100 }) });
    const { mcpy } = testMcpy({ stocks: [first.provider, second.provider] });
    const r = await mcpy.stockQuote({ symbols: ["brk-b", "aapl", "ZZZZ"] });
    expect(r.quotes.map((q) => [q.symbol, q.price, q.change, q.change_pct])).toEqual([
      ["BRK-B", 99, -1, -1],
      ["AAPL", 110, 10, 10],
    ]);
    expect(r.missing).toEqual(["ZZZZ"]);
    expect([first.asked, second.asked]).toEqual([[["BRK-B", "AAPL", "ZZZZ"]], [["BRK-B", "ZZZZ"]]]);
    expect(mentionsProvider(r)).toBe(false);
  });

  it("caches each symbol on its own: a later call with an overlapping set asks only for the new symbol", async () => {
    const src = fakeStocks("first", { AAPL: quote("AAPL"), MSFT: quote("MSFT") });
    const { mcpy } = testMcpy({ stocks: [src.provider] });
    await mcpy.stockQuote({ symbols: ["AAPL"] });
    const again = await mcpy.stockQuote({ symbols: ["AAPL", "MSFT"] });
    expect(src.asked).toEqual([["AAPL"], ["MSFT"]]);
    expect(again.meta.cache).toBe("miss");
    expect((await mcpy.stockQuote({ symbols: ["MSFT", "AAPL"] })).meta).toMatchObject({ cache: "hit", attempts: 0 });
  });

  it("reads every symbol's entry from KV in one bulk request", async () => {
    const kv = fakeKv();
    const src = fakeStocks("first", { A: quote("A"), B: quote("B"), C: quote("C") });
    await testMcpy({ stocks: [src.provider], cache: new LayeredCache({ kv }) }).mcpy.stockQuote({ symbols: ["A", "B", "C"] });
    // Another isolate: same KV, empty memory.
    const other = testMcpy({ stocks: [src.provider], cache: new LayeredCache({ kv }) });
    expect((await other.mcpy.stockQuote({ symbols: ["A", "B", "C"] })).meta.cache).toBe("hit");
    expect(kv.bulkGets.map((keys) => keys.length)).toEqual([3, 3]);
  });

  it("moves past a failing source, and fails only when no source answered at all", async () => {
    const down = fakeStocks("down", {}, { fail: true });
    const up = fakeStocks("up", { AAPL: quote("AAPL") });
    expect((await testMcpy({ stocks: [down.provider, up.provider] }).mcpy.stockQuote({ symbols: ["AAPL"] })).quotes).toHaveLength(1);
    await expect(testMcpy({ stocks: [down.provider] }).mcpy.stockQuote({ symbols: ["AAPL"] })).rejects.toMatchObject({ code: ErrorCode.UpstreamFailed });
    await expect(testMcpy().mcpy.stockQuote({ symbols: ["AAPL"] })).rejects.toMatchObject({ code: ErrorCode.NoProviders });
  });

  it("takes the tickers markets use, each once", () => {
    expect(StockQuoteInputSchema.safeParse({ symbols: ["AAPL", "BRK-B", "^GSPC", "SAP.DE", "EURUSD=X", "BTC-USD"] }).success).toBe(true);
    expect(StockQuoteInputSchema.safeParse({ symbols: ["AAPL", "aapl"] }).success).toBe(false);
    expect(StockQuoteInputSchema.safeParse({ symbols: ["AA PL"] }).success).toBe(false);
  });
});

const bar = (date: string, close: number, over: Partial<FoundBar> = {}): FoundBar => ({ date, open: close - 1, high: close + 1, low: close - 2, close, volume: 10, ...over });

describe("stock_history", () => {
  const days = [bar("2025-11-03", 10), bar("2025-11-04", 12), bar("2025-11-07", 11), bar("2025-11-10", 13), bar("2025-12-01", 20)];

  it("builds week and month bars from daily ones", () => {
    expect(weekOf("2025-11-07")).toBe("2025-11-03");
    expect(weekOf("2025-11-03")).toBe("2025-11-03");
    expect(weekOf("2025-11-09")).toBe("2025-11-03");
    expect(aggregate(days, BarInterval.Week).map((b) => [b.date, b.open, b.high, b.low, b.close, b.volume])).toEqual([
      ["2025-11-03", 9, 13, 8, 11, 30],
      ["2025-11-10", 12, 14, 11, 13, 10],
      ["2025-12-01", 19, 21, 18, 20, 10],
    ]);
    expect(aggregate(days, BarInterval.Month).map((b) => [b.date, b.close])).toEqual([
      ["2025-11-03", 13],
      ["2025-12-01", 20],
    ]);
    // A volume missing on one day leaves the period's total unknown rather than short.
    expect(aggregate([bar("2025-11-03", 1), bar("2025-11-04", 1, { volume: undefined })], BarInterval.Week)[0]!.volume).toBeUndefined();
  });

  it("serves a window from the first source with bars, cached for the next call", async () => {
    const empty = fakeStocks("empty", {});
    const src = fakeStocks("src", { AAPL: { name: "Apple", currency: "USD", bars: days, dividends: [{ date: "2025-11-04", amount: 0.27 }] } });
    const { mcpy } = testMcpy({ stocks: [empty.provider, src.provider] });
    const r = await mcpy.stockHistory({ symbol: "aapl", from: "2025-11-01", to: "2025-12-05", interval: "week" });
    expect(r).toMatchObject({ symbol: "AAPL", name: "Apple", interval: "week", from: "2025-11-01", to: "2025-12-05", dividends: [{ date: "2025-11-04", amount: 0.27 }] });
    expect(r.bars).toHaveLength(3);
    expect((await mcpy.stockHistory({ symbol: "AAPL", from: "2025-11-01", to: "2025-12-05", interval: "month" })).meta.cache).toBe("hit");
    expect(src.asked).toEqual([["AAPL"]]);
  });

  it("says not_found when no source has the symbol, and does not cache that", async () => {
    const src = fakeStocks("src", {});
    const { mcpy } = testMcpy({ stocks: [src.provider] });
    await expect(mcpy.stockHistory({ symbol: "ZZZZ", from: "2025-11-01", to: "2025-11-20" })).rejects.toMatchObject({ code: ErrorCode.NotFound });
    await expect(mcpy.stockHistory({ symbol: "ZZZZ", from: "2025-11-01", to: "2025-11-20" })).rejects.toMatchObject({ code: ErrorCode.NotFound });
    expect(src.asked).toHaveLength(2);
  });

  it("bounds the window by interval so a call stays under the bar cap", () => {
    expect(StockHistoryInputSchema.safeParse({ symbol: "AAPL", from: "2020-01-01", to: "2026-01-01" }).error?.issues[0]?.message).toMatch(/use interval week or month/);
    expect(StockHistoryInputSchema.safeParse({ symbol: "AAPL", from: "2020-01-01", to: "2026-01-01", interval: "week" }).success).toBe(true);
    expect(StockHistoryInputSchema.safeParse({ symbol: "AAPL", from: "1990-01-01", to: "2026-01-01", interval: "month" }).success).toBe(false);
    expect(StockHistoryInputSchema.safeParse({ symbol: "AAPL", from: "2026-02-01", to: "2026-01-01" }).success).toBe(false);
  });
});

const fact = (value: number, end: string, filed: string, over: Partial<FiledFact> = {}): FiledFact => ({ value, end, filed, annual: true, ...over });
const year = (value: number, start: string, end: string, filed: string) => fact(value, end, filed, { start });

describe("filings arithmetic", () => {
  it("settles a period: the latest filing's value, dated by the first filing that reported it", () => {
    expect(settle([fact(5, "2024-09-28", "2024-11-01"), fact(5, "2024-09-28", "2025-10-31")])).toEqual({ value: 5, filed: "2024-11-01" });
    // Restated a year later: the new value, filed then.
    expect(settle([fact(5, "2024-09-28", "2024-11-01"), fact(6, "2024-09-28", "2025-10-31")])).toEqual({ value: 6, filed: "2025-10-31" });
  });

  it("builds fiscal years from 10-K periods of 350 to 380 days, newest first, with free cash flow and the year-end balance sheet", () => {
    const facts: FoundFundamentals["facts"] = {
      revenue: [year(100, "2024-09-29", "2025-09-27", "2025-10-31"), year(90, "2023-10-01", "2024-09-28", "2024-11-01"), year(30, "2025-06-29", "2025-09-27", "2025-10-31")],
      // A 53-week year still counts.
      netIncome: [year(20, "2024-09-29", "2025-10-04", "2025-10-31"), year(18, "2023-10-01", "2024-09-28", "2024-11-01")],
      operatingCashFlow: [year(40, "2023-10-01", "2024-09-28", "2024-11-01")],
      capex: [year(8, "2023-10-01", "2024-09-28", "2024-11-01")],
      assets: [fact(500, "2024-09-28", "2024-11-01"), fact(520, "2025-03-29", "2025-05-02", { annual: false })],
    };
    expect(fiscalYears(facts, 10)).toEqual([
      { period_end: "2025-10-04", fiscal_year: 2025, net_income_usd: 20, filed: "2025-10-31" },
      { period_end: "2025-09-27", fiscal_year: 2025, revenue_usd: 100, filed: "2025-10-31" },
      { period_end: "2024-09-28", fiscal_year: 2024, revenue_usd: 90, net_income_usd: 18, operating_cash_flow_usd: 40, capex_usd: 8, free_cash_flow_usd: 32, assets_usd: 500, filed: "2024-11-01" },
    ]);
    expect(fiscalYears(facts, 1)).toHaveLength(1);
    // The quarterly balance sheet is newer than the annual one.
    expect(latestBalanceSheet(facts)).toEqual({ as_of: "2025-03-29", assets_usd: 520 });
  });

  it("counts shares at the newest date filed, adding up counts one filing states per class", () => {
    expect(sharesOutstanding({ sharesOutstanding: [fact(10, "2026-01-16", "2026-01-30"), fact(12, "2026-04-17", "2026-05-01")] })).toEqual({ shares: 12, asOf: "2026-04-17" });
    expect(sharesOutstanding({ sharesOutstanding: [fact(5, "2026-04-17", "2026-05-01"), fact(7, "2026-04-17", "2026-05-01")] })).toEqual({ shares: 12, asOf: "2026-04-17" });
    expect(sharesOutstanding({})).toBeUndefined();
  });
});

describe("stock_fundamentals", () => {
  const apple: FoundFundamentals = {
    name: "Apple Inc.",
    facts: { revenue: [year(416, "2024-09-29", "2025-09-27", "2025-10-31")], sharesOutstanding: [fact(14.6, "2025-10-17", "2025-10-31")], assets: [fact(360, "2025-09-27", "2025-10-31")] },
  };

  it("looks the company up in the source's directory (fetched once a day) and returns its years", async () => {
    const sec = fakeStocks("filings", {}, { filings: { AAPL: apple }, directory: { AAPL: "0000320193" } });
    const { mcpy } = testMcpy({ stocks: [sec.provider] });
    const r = await mcpy.stockFundamentals({ symbol: "aapl" });
    expect(r).toMatchObject({ symbol: "AAPL", name: "Apple Inc.", shares_outstanding: 14.6, shares_outstanding_as_of: "2025-10-17", latest_balance_sheet: { as_of: "2025-09-27", assets_usd: 360 } });
    expect(r.years).toEqual([{ period_end: "2025-09-27", fiscal_year: 2025, revenue_usd: 416, assets_usd: 360, filed: "2025-10-31" }]);
    expect(sec.asked).toEqual([["AAPL", "0000320193"]]);
    await expect(mcpy.stockFundamentals({ symbol: "MSFT" })).rejects.toMatchObject({ code: ErrorCode.NotFound });
    expect(sec.directoryCalls()).toBe(1);
    // MSFT is not in the directory: the filings source was never asked for it.
    expect(sec.asked).toEqual([["AAPL", "0000320193"]]);
    expect(mentionsProvider(r)).toBe(false);
  });
});
