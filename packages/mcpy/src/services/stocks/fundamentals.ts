/**
 * stock_fundamentals: a US-listed company's fiscal years from its annual
 * reports, its latest balance sheet and its shares outstanding. Filings
 * change a few times a year, so an answer is kept a day; it is worked out for
 * the most years asked for and cut to each call's `years`. Sources that name
 * companies by an id of their own get it from their directory, also kept a day.
 */

import { z } from "zod";
import { cacheSpace, CacheName, requiredFields } from "../../cache/spaces.js";
import type { CallScope, Engine, Served } from "../../engine/engine.js";
import type { StockProvider } from "../../providers/stock-types.js";
import { FiscalYearSchema, MAX_FUNDAMENTAL_YEARS, StockFundamentalsResultSchema, upperTicker, type StockFundamentalsQuery, type StockFundamentalsResult } from "../../schemas-stocks.js";
import { fiscalYears, latestBalanceSheet, sharesOutstanding } from "./filings.js";
import { movesOnWhenEmpty, noSources, sourcesFor, unknownSymbol } from "./sources.js";

const FUNDAMENTALS_TTL_SECONDS = 86_400;
const DIRECTORY_TTL_SECONDS = 86_400;

type Answer = Omit<StockFundamentalsResult, "meta">;

const AnswerSpace = cacheSpace(CacheName.StockFundamentals, requiredFields<Answer>({ symbol: z.string(), years: z.array(FiscalYearSchema) }));
const DirectorySpace = cacheSpace(CacheName.StockDirectory, z.record(z.string(), z.string()));

const compact = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/** The source's id for `symbol` from its directory, read from the cache when it was fetched today. */
async function idOf(engine: Engine, p: StockProvider, symbol: string, scope: CallScope): Promise<string | undefined> {
  const served = await engine.cached(
    DirectorySpace,
    p.id,
    (ids) => (Object.keys(ids).length ? DIRECTORY_TTL_SECONDS : undefined),
    DIRECTORY_TTL_SECONDS,
    scope,
    (deadlineAt) => engine.chain([p], (q, call) => q.directory!(call), (ids) => movesOnWhenEmpty(Object.keys(ids).length === 0), deadlineAt, scope),
  );
  return served.value[symbol];
}

export async function stockFundamentalsOp(
  engine: Engine,
  input: StockFundamentalsQuery,
  scope: CallScope,
): Promise<{ result: StockFundamentalsResult; served: Served<unknown>; outputChars: number }> {
  const startedAt = Date.now();
  const providers = sourcesFor(engine, "fundamentals");
  if (!providers.length) throw noSources("company fundamentals");
  const symbol = upperTicker(input.symbol);
  const empty = (a: Answer) => a.years.length === 0 && !a.latest_balance_sheet;
  const served = await engine.cached(AnswerSpace, symbol, (a, salvaged) => (salvaged || empty(a) ? undefined : FUNDAMENTALS_TTL_SECONDS), input.max_age, scope, async (deadlineAt) => {
    // Ids are looked up before the chain: a directory download is a request of its own, not part of an attempt.
    const ids = new Map<string, string | undefined>();
    for (const p of providers) if (p.directory) ids.set(p.id, await idOf(engine, p, symbol, scope));
    const known = providers.filter((p) => !p.directory || ids.get(p.id) !== undefined);
    if (!known.length) return { value: { symbol, years: [] }, provider: "none", attempts: [], costUsd: 0, salvaged: true };
    return engine.chain(
      known,
      async (p, call): Promise<Answer> => {
        const filed = await p.fundamentals!(symbol, ids.get(p.id), call);
        if (!filed) return { symbol, years: [] };
        const shares = sharesOutstanding(filed.facts);
        return compact({
          symbol,
          name: filed.name,
          shares_outstanding: shares?.shares,
          shares_outstanding_as_of: shares?.asOf,
          latest_balance_sheet: latestBalanceSheet(filed.facts),
          years: fiscalYears(filed.facts, MAX_FUNDAMENTAL_YEARS),
        });
      },
      (a) => movesOnWhenEmpty(empty(a)),
      deadlineAt,
      scope,
    );
  });
  if (empty(served.value)) throw unknownSymbol(symbol, "filed fundamentals");
  const result = StockFundamentalsResultSchema.parse({
    ...served.value,
    years: served.value.years.slice(0, input.years),
    meta: { cache: served.cache, latency_ms: Date.now() - startedAt, attempts: served.attempts },
  });
  return { result, served, outputChars: JSON.stringify(result).length };
}
