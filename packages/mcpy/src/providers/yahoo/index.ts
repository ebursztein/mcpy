/**
 * Yahoo Finance's chart API: quotes and daily history for stocks, ETFs,
 * funds, indices, currencies and crypto on most of the world's exchanges.
 * Unofficial and keyless. The chart endpoint needs no session (verified from
 * a Cloudflare Worker, 2026-11-28), unlike the quote endpoint (cookies and a
 * crumb, which it refuses with 429 once an address asks too often). One call
 * per symbol: the chart's meta carries the quote, its bars the history.
 */

import { UserAgentProfile } from "../../enums.js";
import { InstrumentType } from "../../schemas-stocks.js";
import { getStockJson, pooled, positive } from "../stock-http.js";
import { localDay, roundPrice, type FoundBar, type FoundHistory, type FoundQuote, type StockCapabilities, type StockProvider } from "../stock-types.js";
import { ProviderId, type ProviderCall } from "../types.js";
import { ChartResponseSchema, type ChartResult } from "./schemas.js";

export const YAHOO_CHART = "https://query2.finance.yahoo.com/v8/finance/chart";
export const YAHOO_CAPABILITIES: StockCapabilities = { quotes: true, history: true, fundamentals: false };
/** Chart calls in flight at once for one quote request. */
const CONCURRENCY = 5;
/** Ten years of daily bars are about 250 KB; 40 years stay under this. */
const MAX_CHART_BYTES = 20_000_000;
const DAY_S = 86_400;

const TYPES: Readonly<Record<string, InstrumentType>> = {
  EQUITY: InstrumentType.Stock,
  ETF: InstrumentType.Etf,
  MUTUALFUND: InstrumentType.Fund,
  INDEX: InstrumentType.Index,
  CRYPTOCURRENCY: InstrumentType.Crypto,
  CURRENCY: InstrumentType.Currency,
  FUTURE: InstrumentType.Future,
};

export const quoteUrl = (symbol: string) => `${YAHOO_CHART}/${encodeURIComponent(symbol)}?range=5d&interval=1d`;

/** Bars from a day before `from` to two days after `to`: the window is in exchange days, the API's in UTC seconds. */
export const historyUrl = (symbol: string, from: string, to: string) =>
  `${YAHOO_CHART}/${encodeURIComponent(symbol)}?period1=${Date.parse(from) / 1000 - DAY_S}&period2=${Date.parse(to) / 1000 + 2 * DAY_S}&interval=1d&events=div%2Csplit`;

const headers = (call: ProviderCall) => ({ accept: "application/json", "user-agent": call.userAgent(UserAgentProfile.Default) });

async function chart(url: string, call: ProviderCall): Promise<ChartResult | undefined> {
  const body = await getStockJson({ url, headers: headers(call), notFound: [404], maxBytes: MAX_CHART_BYTES }, ChartResponseSchema, call, "Yahoo");
  return body?.chart.result?.[0];
}

/** The chart's daily bars, by exchange-local day; points without a close are dropped. */
export function barsOf(result: ChartResult): FoundBar[] {
  const quote = result.indicators?.quote?.[0];
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const offset = result.meta.gmtoffset ?? 0;
  return (result.timestamp ?? []).flatMap((ts, i) => {
    const close = positive(quote?.close?.[i]);
    if (close === undefined) return [];
    const at = (series: (number | null)[] | undefined) => {
      const v = positive(series?.[i]);
      return v === undefined ? undefined : roundPrice(v);
    };
    const volume = quote?.volume?.[i];
    return [
      {
        date: localDay(ts, offset),
        open: at(quote?.open),
        high: at(quote?.high),
        low: at(quote?.low),
        close: roundPrice(close),
        adjClose: at(adj),
        volume: typeof volume === "number" && volume >= 0 ? volume : undefined,
      },
    ];
  });
}

/** The quote in a chart's meta; the bars give the previous close and the open. Undefined without a price. */
export function quoteOf(symbol: string, result: ChartResult): FoundQuote | undefined {
  const m = result.meta;
  const price = positive(m.regularMarketPrice);
  if (price === undefined) return undefined;
  const bars = barsOf(result);
  const marketDate = m.regularMarketTime !== undefined ? localDay(m.regularMarketTime, m.gmtoffset ?? 0) : bars.at(-1)?.date;
  if (!marketDate) return undefined;
  const before = bars.filter((b) => b.date < marketDate);
  const fixed = (n: number | null | undefined) => (positive(n) === undefined ? undefined : roundPrice(n!));
  // While a session is open its bar has an open but no close yet (XETRA, seen live), so the open is read from the raw series.
  const todayAt = (result.timestamp ?? []).findIndex((ts) => localDay(ts, m.gmtoffset ?? 0) === marketDate);
  const open = todayAt >= 0 ? fixed(result.indicators?.quote?.[0]?.open?.[todayAt]) : undefined;
  return {
    symbol,
    name: m.longName?.trim() || m.shortName?.trim() || undefined,
    instrumentType: m.instrumentType ? (TYPES[m.instrumentType] ?? InstrumentType.Other) : undefined,
    exchange: m.fullExchangeName ?? m.exchangeName ?? undefined,
    currency: m.currency ?? undefined,
    price: roundPrice(price),
    previousClose: before.at(-1)?.close,
    open,
    dayHigh: fixed(m.regularMarketDayHigh),
    dayLow: fixed(m.regularMarketDayLow),
    volume: typeof m.regularMarketVolume === "number" && m.regularMarketVolume >= 0 ? m.regularMarketVolume : undefined,
    fiftyTwoWeekHigh: fixed(m.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: fixed(m.fiftyTwoWeekLow),
    marketDate,
    asOf: m.regularMarketTime !== undefined ? new Date(m.regularMarketTime * 1000).toISOString() : undefined,
  };
}

/** A chart's bars from `from` to `to`, with its dividends and splits in the window. */
export function historyOf(result: ChartResult, from: string, to: string): FoundHistory {
  const offset = result.meta.gmtoffset ?? 0;
  const inWindow = (day: string) => day >= from && day <= to;
  const dividends = Object.values(result.events?.dividends ?? {})
    .flatMap((d) => (positive(d.amount) === undefined ? [] : [{ date: localDay(d.date, offset), amount: d.amount }]))
    .filter((d) => inWindow(d.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const splits = Object.values(result.events?.splits ?? {})
    .flatMap((s) => (s.numerator > 0 && s.denominator > 0 ? [{ date: localDay(s.date, offset), ratio: `${s.numerator}:${s.denominator}` }] : []))
    .filter((s) => inWindow(s.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    name: result.meta.longName?.trim() || result.meta.shortName?.trim() || undefined,
    currency: result.meta.currency ?? undefined,
    bars: barsOf(result).filter((b) => inWindow(b.date)),
    ...(dividends.length ? { dividends } : {}),
    ...(splits.length ? { splits } : {}),
  };
}

/** Yahoo Finance: free quotes and daily history, worldwide. */
export function yahoo(options: { costPerCall?: number } = {}): StockProvider {
  return {
    id: ProviderId.Yahoo,
    costPerCall: options.costPerCall ?? 0,
    capabilities: YAHOO_CAPABILITIES,
    async quotes(symbols, call) {
      const found = await pooled(symbols, CONCURRENCY, async (symbol) => {
        const result = await chart(quoteUrl(symbol), call);
        return result ? quoteOf(symbol, result) : undefined;
      });
      return found.filter((q): q is FoundQuote => q !== undefined);
    },
    async history(req, call) {
      const result = await chart(historyUrl(req.symbol, req.from, req.to), call);
      return result ? historyOf(result, req.from, req.to) : undefined;
    },
  };
}
