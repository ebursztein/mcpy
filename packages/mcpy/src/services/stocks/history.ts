/**
 * stock_history: one symbol's bars over a window. Sources give daily bars;
 * week and month bars are built from them here, so every source and every
 * interval agree. The daily bars are cached per window: a past window for a
 * week (its days are final), one reaching today for an hour.
 */

import { z } from "zod";
import { hashedId } from "../../cache/shared.js";
import { cacheSpace, CacheName, requiredFields } from "../../cache/spaces.js";
import type { CallScope, Engine, Served } from "../../engine/engine.js";
import { roundPrice, type FoundBar, type FoundHistory } from "../../providers/stock-types.js";
import { BarInterval, historyWindow, MAX_HISTORY_BARS, StockHistoryResultSchema, upperTicker, type StockBar, type StockHistoryQuery, type StockHistoryResult } from "../../schemas-stocks.js";
import { movesOnWhenEmpty, noSources, sourcesFor, unknownSymbol } from "./sources.js";

const PAST_WINDOW_TTL_SECONDS = 7 * 86_400;
const OPEN_WINDOW_TTL_SECONDS = 3_600;

const BarSchema = requiredFields<FoundBar>({ date: z.string(), close: z.number().positive() });
const HistorySpace = cacheSpace(CacheName.StockHistory, requiredFields<FoundHistory>({ bars: z.array(BarSchema) }));

const compact = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/** The Monday of `day`'s week, YYYY-MM-DD. */
export function weekOf(day: string): string {
  const t = Date.parse(day);
  const weekday = (new Date(t).getUTCDay() + 6) % 7; // Monday 0
  return new Date(t - weekday * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Daily bars grouped into weeks or months: each dated by its first trading
 * day, opening at that day's open, closing at the last day's close, with the
 * period's highest high, lowest low and summed volume.
 */
export function aggregate(bars: readonly FoundBar[], interval: BarInterval): FoundBar[] {
  if (interval === BarInterval.Day) return [...bars];
  const period = (day: string) => (interval === BarInterval.Week ? weekOf(day) : day.slice(0, 7));
  const groups = new Map<string, FoundBar[]>();
  for (const bar of bars) groups.set(period(bar.date), [...(groups.get(period(bar.date)) ?? []), bar]);
  return [...groups.values()].map((days) => {
    const first = days[0]!;
    const last = days.at(-1)!;
    const highs = days.flatMap((d) => (d.high === undefined ? [] : [d.high]));
    const lows = days.flatMap((d) => (d.low === undefined ? [] : [d.low]));
    const volumes = days.flatMap((d) => (d.volume === undefined ? [] : [d.volume]));
    return {
      date: first.date,
      open: first.open,
      high: highs.length ? Math.max(...highs) : undefined,
      low: lows.length ? Math.min(...lows) : undefined,
      close: last.close,
      adjClose: last.adjClose,
      volume: volumes.length === days.length ? volumes.reduce((a, b) => a + b, 0) : undefined,
    };
  });
}

const barRow = (b: FoundBar): StockBar =>
  compact({ date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, adj_close: b.adjClose === undefined ? undefined : roundPrice(b.adjClose), volume: b.volume });

export async function stockHistoryOp(engine: Engine, input: StockHistoryQuery, scope: CallScope): Promise<{ result: StockHistoryResult; served: Served<unknown>; outputChars: number }> {
  const startedAt = Date.now();
  const providers = sourcesFor(engine, "history");
  if (!providers.length) throw noSources("price history");
  const symbol = upperTicker(input.symbol);
  const { from, to } = historyWindow(input);
  const today = new Date().toISOString().slice(0, 10);
  // An empty answer (no source knew the symbol) is not kept: the next call asks again.
  const ttl = (h: FoundHistory, salvaged: boolean) => (salvaged || h.bars.length === 0 ? undefined : to < today ? PAST_WINDOW_TTL_SECONDS : OPEN_WINDOW_TTL_SECONDS);
  const served = await engine.cached(HistorySpace, await hashedId([symbol, from, to]), ttl, input.max_age, scope, (deadlineAt) =>
    engine.chain(
      providers,
      async (p, call): Promise<FoundHistory> => (await p.history!({ symbol, from, to }, call)) ?? { bars: [] },
      (h) => movesOnWhenEmpty(h.bars.length === 0),
      deadlineAt,
      scope,
    ),
  );
  const history = served.value;
  if (history.bars.length === 0) throw unknownSymbol(symbol, `prices from ${from} to ${to}`);
  // The window's limits keep bars under the cap; should a source send more, the newest are kept.
  const bars = aggregate(history.bars, input.interval).slice(-MAX_HISTORY_BARS);
  const result = StockHistoryResultSchema.parse(
    compact({
      symbol,
      name: history.name,
      currency: history.currency,
      interval: input.interval,
      from,
      to,
      bars: bars.map(barRow),
      dividends: history.dividends?.length ? history.dividends : undefined,
      splits: history.splits?.length ? history.splits : undefined,
      meta: { cache: served.cache, latency_ms: Date.now() - startedAt, attempts: served.attempts },
    }),
  );
  return { result, served, outputChars: JSON.stringify(result.bars).length };
}
