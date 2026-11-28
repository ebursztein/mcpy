/**
 * Alpha Vantage: quotes and the last 100 daily bars, the last resort. The
 * free key allows 25 requests a day and one a second (a faster second call
 * answers 200 with an "Information" notice instead of data, verified
 * 2026-11-27), so quotes are asked one symbol at a time, a second apart, and
 * a call asks at most MAX_QUOTES symbols.
 */

import { ErrorCode } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { getStockJson } from "../stock-http.js";
import { roundPrice, type FoundBar, type FoundQuote, type StockCapabilities, type StockProvider } from "../stock-types.js";
import { ProviderId, type ProviderCall } from "../types.js";
import { DailyResponseSchema, QuoteResponseSchema, type Notice } from "./schemas.js";

export const ALPHAVANTAGE_API = "https://www.alphavantage.co/query";
export const ALPHAVANTAGE_CAPABILITIES: StockCapabilities = { quotes: true, history: true, fundamentals: false };
/** Symbols one quote call asks for: each is a request of the day's 25. */
export const MAX_QUOTES = 5;
/** The free key's burst limit is one request a second. */
const SPACING_MS = 1_100;

const url = (fn: string, symbol: string, apiKey: string) => `${ALPHAVANTAGE_API}?function=${fn}&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;

/** A notice in place of data is the rate limit (or a premium-only request): a failure, so the breaker sees it. */
function refuseNotice(body: Notice): void {
  const notice = body.Information ?? body.Note;
  if (notice) throw new ProviderFailure(ErrorCode.RateLimited, `Alpha Vantage: ${notice.slice(0, 160)}`);
}

const num = (s: string | undefined) => {
  const n = s === undefined ? NaN : Number(s.replace("%", ""));
  return Number.isFinite(n) ? n : undefined;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

async function quote(symbol: string, apiKey: string, call: ProviderCall): Promise<FoundQuote | undefined> {
  const body = await getStockJson({ url: url("GLOBAL_QUOTE", symbol, apiKey), headers: { accept: "application/json" } }, QuoteResponseSchema, call, "Alpha Vantage");
  if (!body) return undefined;
  refuseNotice(body);
  const q = body["Global Quote"];
  const price = num(q?.["05. price"]);
  const day = q?.["07. latest trading day"];
  if (!q || price === undefined || price <= 0 || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const volume = num(q["06. volume"]);
  return {
    symbol,
    currency: "USD",
    price: roundPrice(price),
    previousClose: num(q["08. previous close"]),
    open: num(q["02. open"]),
    dayHigh: num(q["03. high"]),
    dayLow: num(q["04. low"]),
    volume: volume !== undefined && volume >= 0 ? volume : undefined,
    marketDate: day,
  };
}

/** Alpha Vantage: needs a key; US and some foreign tickers. */
export function alphaVantage(options: { apiKey: string; costPerCall?: number; /** Pause between quote requests (default 1,100 ms). */ spacingMs?: number }): StockProvider {
  const { apiKey } = options;
  const spacingMs = options.spacingMs ?? SPACING_MS;
  return {
    id: ProviderId.AlphaVantage,
    costPerCall: options.costPerCall ?? 0,
    capabilities: ALPHAVANTAGE_CAPABILITIES,
    async quotes(symbols, call) {
      const found: FoundQuote[] = [];
      for (const [i, symbol] of symbols.slice(0, MAX_QUOTES).entries()) {
        if (i > 0) await sleep(spacingMs, call.context.signal);
        const q = await quote(symbol, apiKey, call);
        if (q) found.push(q);
      }
      return found;
    },
    async history(req, call) {
      const body = await getStockJson({ url: url("TIME_SERIES_DAILY", req.symbol, apiKey), headers: { accept: "application/json" } }, DailyResponseSchema, call, "Alpha Vantage");
      if (!body) return undefined;
      refuseNotice(body);
      const series = body["Time Series (Daily)"];
      if (!series) return undefined;
      const bars = Object.entries(series).flatMap(([date, d]): FoundBar[] => {
        const close = num(d["4. close"]);
        if (close === undefined || close <= 0 || date < req.from || date > req.to) return [];
        const volume = num(d["5. volume"]);
        return [{ date, open: num(d["1. open"]), high: num(d["2. high"]), low: num(d["3. low"]), close, volume: volume !== undefined && volume >= 0 ? volume : undefined }];
      });
      return { currency: "USD", bars: bars.sort((a, b) => a.date.localeCompare(b.date)) };
    },
  };
}
