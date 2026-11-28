/**
 * Regression (2026-11-27, owner): the stock tools quoted crypto (BTC-USD answered with Bitcoin's
 * price), so a caller could get a coin's price from two tools that disagree on sources, symbols
 * and freshness. Crypto has its own tools, crypto_coin and crypto_market. The stock tools now
 * refuse it: a crypto pair (a coin against a currency or another coin) is refused before any
 * source is asked, and so is any symbol a source says is crypto. Share classes (BRK-B) and
 * currency pairs (EURUSD=X) are not crypto. Never delete these.
 */

import { describe, expect, it } from "vitest";
import { ErrorCode, InstrumentType } from "mcpy";
import type { FoundQuote, StockProvider } from "mcpy/providers";
import { testMcpy } from "../helpers.js";

const quote = (symbol: string, over: Partial<FoundQuote> = {}): FoundQuote => ({ symbol, price: 100, previousClose: 99, marketDate: "2026-11-27", currency: "USD", ...over });

/** A source that quotes whatever it is asked, as `types` says each symbol is; records every symbol asked for. */
function source(types: Record<string, InstrumentType> = {}) {
  const asked: string[] = [];
  const provider: StockProvider = {
    id: "fake",
    costPerCall: 0,
    capabilities: { quotes: true, history: true, fundamentals: true },
    async quotes(symbols) {
      asked.push(...symbols);
      return symbols.map((s) => quote(s, { instrumentType: types[s] ?? InstrumentType.Stock }));
    },
    async history(req) {
      asked.push(req.symbol);
      return { bars: [{ date: "2026-11-27", close: 100 }] };
    },
    async fundamentals(symbol) {
      asked.push(symbol);
      return undefined;
    },
  };
  return { provider, asked };
}

const refusal = (symbol: string) => ({ code: ErrorCode.InvalidInput, details: [expect.stringMatching(new RegExp(`${symbol.replace(/[-^=]/g, "\\$&")}.*crypto_coin`))] });

describe("the stock tools refuse crypto", () => {
  it.each(["BTC-USD", "btc-usd", "ETH-EUR", "XMR-USD", "ETH-BTC", "SOL-USDT"])("stock_quote refuses %s without asking a source, pointing to the crypto tools", async (symbol) => {
    const { provider, asked } = source();
    const { mcpy } = testMcpy({ stocks: [provider] });
    await expect(mcpy.stockQuote({ symbols: ["AAPL", symbol] })).rejects.toMatchObject(refusal(symbol));
    expect(asked).toEqual([]);
  });

  it("stock_history and stock_fundamentals refuse a crypto pair the same way", async () => {
    const { provider, asked } = source();
    const { mcpy } = testMcpy({ stocks: [provider] });
    await expect(mcpy.stockHistory({ symbol: "BTC-USD" })).rejects.toMatchObject(refusal("BTC-USD"));
    await expect(mcpy.stockFundamentals({ symbol: "ETH-USD" })).rejects.toMatchObject(refusal("ETH-USD"));
    expect(asked).toEqual([]);
  });

  it("refuses a symbol a source says is crypto, whatever its shape", async () => {
    const { provider } = source({ "BTCUSD=X": InstrumentType.Crypto });
    const { mcpy } = testMcpy({ stocks: [provider] });
    await expect(mcpy.stockQuote({ symbols: ["AAPL", "BTCUSD=X"] })).rejects.toMatchObject(refusal("BTCUSD=X"));
    // And again from the cache: what the source said is kept with the quote.
    await expect(mcpy.stockQuote({ symbols: ["BTCUSD=X"] })).rejects.toMatchObject(refusal("BTCUSD=X"));
  });

  it("still quotes share classes, currency pairs, indices and foreign listings", async () => {
    const { provider } = source({ "EURUSD=X": InstrumentType.Currency, "^GSPC": InstrumentType.Index });
    const { mcpy } = testMcpy({ stocks: [provider] });
    const symbols = ["BRK-B", "BF-B", "PBR-A", "EURUSD=X", "^GSPC", "SAP.DE", "RDS-A"];
    const out = await mcpy.stockQuote({ symbols });
    expect(out.quotes.map((q) => q.symbol)).toEqual(symbols);
    expect((await mcpy.stockHistory({ symbol: "BRK-B" })).bars).toHaveLength(1);
  });
});
