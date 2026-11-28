/**
 * stock_quote: the latest price of up to 25 symbols. Each symbol is cached on
 * its own, so overlapping calls share entries (and their reads go to KV as
 * one bulk get); only the symbols the cache could not serve are asked for,
 * source by source, each source getting what earlier ones did not know.
 */

import { z } from "zod";
import { cacheSpace, CacheName, requiredFields } from "../../cache/spaces.js";
import { CacheStatus } from "../../enums.js";
import type { CallScope, Engine, Served } from "../../engine/engine.js";
import { roundPrice, type FoundQuote } from "../../providers/stock-types.js";
import { StockQuoteResultSchema, upperTicker, type StockQuote, type StockQuoteQuery, type StockQuoteResult } from "../../schemas-stocks.js";
import { movesOnWhenEmpty, noSources, sourcesFor } from "./sources.js";

/** Entries live a day; max_age decides which are young enough to serve. */
const QUOTE_TTL_SECONDS = 86_400;

const QuoteSpace = cacheSpace(CacheName.StockQuote, requiredFields<FoundQuote>({ symbol: z.string().min(1), price: z.number().positive(), marketDate: z.string() }));

const compact = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/** A found quote as the public row; change is worked out from the previous close. */
export function quoteRow(q: FoundQuote): StockQuote {
  const change = q.previousClose !== undefined ? roundPrice(q.price - q.previousClose) : undefined;
  return compact({
    symbol: q.symbol,
    name: q.name,
    instrument_type: q.instrumentType,
    exchange: q.exchange,
    currency: q.currency,
    price: q.price,
    previous_close: q.previousClose,
    change,
    change_pct: change !== undefined && q.previousClose ? Math.round((change / q.previousClose) * 1e6) / 1e4 : undefined,
    open: q.open,
    day_high: q.dayHigh,
    day_low: q.dayLow,
    volume: q.volume,
    fifty_two_week_high: q.fiftyTwoWeekHigh,
    fifty_two_week_low: q.fiftyTwoWeekLow,
    market_date: q.marketDate,
    as_of: q.asOf,
  });
}

/** Asks each source in turn for the symbols still missing; throws only when no source answered at all. */
async function askSources(engine: Engine, symbols: string[], scope: CallScope) {
  const providers = sourcesFor(engine, "quotes");
  if (!providers.length) throw noSources("quotes");
  const deadlineAt = Date.now() + engine.limits.deadlineMs;
  const found = new Map<string, { quote: FoundQuote; provider: string }>();
  let attempts = 0;
  let answered = false;
  let failure: unknown;
  for (const p of providers) {
    const remaining = symbols.filter((s) => !found.has(s));
    if (!remaining.length) break;
    try {
      const r = await engine.chain([p], (q, call) => q.quotes!(remaining, call), (qs) => movesOnWhenEmpty(qs.length === 0), deadlineAt, scope);
      attempts += r.attempts.length;
      answered = true;
      for (const quote of r.value) if (remaining.includes(quote.symbol)) found.set(quote.symbol, { quote, provider: p.id });
    } catch (err) {
      attempts++;
      failure = err;
    }
  }
  if (!answered && failure) throw failure;
  return { found, attempts };
}

export async function stockQuoteOp(engine: Engine, input: StockQuoteQuery, scope: CallScope): Promise<{ result: StockQuoteResult; served: Served<unknown>; outputChars: number }> {
  const startedAt = Date.now();
  const symbols = input.symbols.map(upperTicker);
  // Every symbol's read is issued before any is awaited: one KV request for all of them.
  const cached = await Promise.all(symbols.map((s) => engine.cache.read(QuoteSpace, s, scope, input.max_age)));
  const quotes = new Map<string, FoundQuote>();
  const parts: Record<string, string> = {};
  cached.forEach((entry, i) => {
    if (entry) quotes.set(symbols[i]!, entry.value);
  });
  const wanted = symbols.filter((s) => !quotes.has(s));
  let attempts = 0;
  if (wanted.length) {
    const asked = await askSources(engine, wanted, scope);
    attempts = asked.attempts;
    await Promise.all(
      [...asked.found].map(([symbol, { quote, provider }]) => {
        quotes.set(symbol, quote);
        parts[symbol] = provider;
        return engine.cache.write(QuoteSpace, symbol, quote, QUOTE_TTL_SECONDS, scope, provider);
      }),
    );
  }
  const cache = input.max_age === 0 ? CacheStatus.Bypass : wanted.length ? CacheStatus.Miss : CacheStatus.Hit;
  const result = StockQuoteResultSchema.parse({
    quotes: symbols.flatMap((s) => (quotes.has(s) ? [quoteRow(quotes.get(s)!)] : [])),
    missing: symbols.filter((s) => !quotes.has(s)),
    meta: { cache, latency_ms: Date.now() - startedAt, attempts },
  });
  const providers = [...new Set(Object.values(parts))];
  const served: Served<unknown> = { value: result, cache, attempts, provider: providers.join("+") || "none", ...(providers.length ? { parts } : {}) };
  return { result, served, outputChars: JSON.stringify(result.quotes).length };
}
