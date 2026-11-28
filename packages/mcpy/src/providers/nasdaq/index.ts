/**
 * Nasdaq's quote API (api.nasdaq.com): quotes and daily history for US-listed
 * stocks and ETFs, keyless. Figures come as display text ("$358.54",
 * "21,368,018", "243.42 - 360.83"), parsed here. It needs the asset class
 * (a stock asked as an ETF is "Symbol not exists.", and the reverse), so an
 * unknown stock is asked again as an ETF. It answers a Cloudflare Worker only
 * with a browser user agent (HTTP 520 otherwise, verified 2026-11-28), and
 * its daily history lags the market by a session or two.
 */

import { UserAgentProfile } from "../../enums.js";
import { InstrumentType } from "../../schemas-stocks.js";
import { getStockJson, pooled } from "../stock-http.js";
import { roundPrice, type FoundBar, type FoundQuote, type StockCapabilities, type StockProvider } from "../stock-types.js";
import { ProviderId, type ProviderCall } from "../types.js";
import { HistoryResponseSchema, InfoResponseSchema, type InfoData } from "./schemas.js";

export const NASDAQ_API = "https://api.nasdaq.com/api/quote";
export const NASDAQ_CAPABILITIES: StockCapabilities = { quotes: true, history: true, fundamentals: false };
const AssetClass = { Stocks: "stocks", Etf: "etf" } as const;
type AssetClass = (typeof AssetClass)[keyof typeof AssetClass];
const CONCURRENCY = 4;
/** Nasdaq's slow answers (1-3 s from a Worker) need more than the usual attempt. */
const ATTEMPT_TIMEOUT_MS = 30_000;

/** US tickers only (AAPL, BRK-B); Nasdaq writes a share class with a dot. Undefined for anything else (^GSPC, SAP.DE). */
export function nasdaqSymbol(symbol: string): string | undefined {
  return /^[A-Z]{1,5}(-[A-Z])?$/.test(symbol) ? symbol.replace("-", ".") : undefined;
}

/** "$1,234.50", "+2.96", "21,368,018.4372" or "N/A" as a number. */
export function figure(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const n = Number(text.replace(/[$,%+\s]/g, ""));
  return Number.isFinite(n) && text.trim() !== "" && !/^n\/?a$/i.test(text.trim()) ? n : undefined;
}

/** "243.42 - 360.83" as [low, high]. */
export function range(text: string | null | undefined): [number | undefined, number | undefined] {
  const [low, high] = (text ?? "").split(/\s+-\s+|\//).map(figure);
  return low !== undefined && high !== undefined && low <= high ? [low, high] : [undefined, undefined];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 27, 2026" (possibly followed by a time) as 2026-11-27. */
export function tradeDay(text: string | null | undefined): string | undefined {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(text ?? "");
  const month = m ? MONTHS.indexOf(m[1]!) + 1 : 0;
  return m && month ? `${m[3]}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : undefined;
}

/** "11/25/2026" as 2026-11-25. */
export const usDay = (text: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : undefined;
};

const headers = (call: ProviderCall) => ({ accept: "application/json", "user-agent": call.userAgent(UserAgentProfile.Chrome) });

/** The info answer for `symbol`, and the asset class that knew it. */
async function info(symbol: string, call: ProviderCall): Promise<{ data: InfoData; assetClass: AssetClass } | undefined> {
  for (const assetClass of [AssetClass.Stocks, AssetClass.Etf]) {
    const url = `${NASDAQ_API}/${encodeURIComponent(symbol)}/info?assetclass=${assetClass}`;
    const body = await getStockJson({ url, headers: headers(call) }, InfoResponseSchema, call, "Nasdaq");
    if (body?.data) return { data: body.data, assetClass };
  }
  return undefined;
}

/** A quote from the info answer; undefined without a price or a trade day. */
export function quoteOf(symbol: string, data: InfoData, assetClass: AssetClass): FoundQuote | undefined {
  const p = data.primaryData;
  const price = figure(p?.lastSalePrice);
  const marketDate = tradeDay(p?.lastTradeTimestamp);
  if (price === undefined || price <= 0 || !marketDate) return undefined;
  const change = figure(p?.netChange);
  const [low52, high52] = range(data.keyStats?.fiftyTwoWeekHighLow?.value);
  const [dayLow, dayHigh] = range(data.keyStats?.dayrange?.value);
  const volume = figure(p?.volume);
  return {
    symbol,
    name: data.companyName?.replace(/\s+Common Stock$/, "").trim() || undefined,
    instrumentType: assetClass === AssetClass.Etf ? InstrumentType.Etf : InstrumentType.Stock,
    exchange: data.exchange ?? undefined,
    currency: "USD",
    price,
    previousClose: change !== undefined ? roundPrice(price - change) : undefined,
    dayHigh,
    dayLow,
    volume: volume !== undefined ? Math.round(volume) : undefined,
    fiftyTwoWeekHigh: high52,
    fiftyTwoWeekLow: low52,
    marketDate,
  };
}

/** Nasdaq: US stocks and ETFs, a fallback for quotes and daily history. */
export function nasdaq(options: { costPerCall?: number } = {}): StockProvider {
  return {
    id: ProviderId.Nasdaq,
    costPerCall: options.costPerCall ?? 0,
    capabilities: NASDAQ_CAPABILITIES,
    attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
    async quotes(symbols, call) {
      const found = await pooled(symbols, CONCURRENCY, async (symbol) => {
        const theirs = nasdaqSymbol(symbol);
        const known = theirs ? await info(theirs, call) : undefined;
        return known ? quoteOf(symbol, known.data, known.assetClass) : undefined;
      });
      return found.filter((q): q is FoundQuote => q !== undefined);
    },
    async history(req, call) {
      const theirs = nasdaqSymbol(req.symbol);
      const known = theirs ? await info(theirs, call) : undefined;
      if (!theirs || !known) return undefined;
      const url = `${NASDAQ_API}/${encodeURIComponent(theirs)}/historical?assetclass=${known.assetClass}&fromdate=${req.from}&todate=${req.to}&limit=9999`;
      const body = await getStockJson({ url, headers: headers(call) }, HistoryResponseSchema, call, "Nasdaq");
      const bars = (body?.data?.tradesTable?.rows ?? []).flatMap((row): FoundBar[] => {
        const date = usDay(row.date);
        const close = figure(row.close);
        if (!date || close === undefined || close <= 0 || date < req.from || date > req.to) return [];
        const volume = figure(row.volume);
        return [{ date, open: figure(row.open), high: figure(row.high), low: figure(row.low), close, volume: volume !== undefined ? Math.round(volume) : undefined }];
      });
      return { name: known.data.companyName?.replace(/\s+Common Stock$/, "").trim() || undefined, currency: "USD", bars: bars.sort((a, b) => a.date.localeCompare(b.date)) };
    },
  };
}
