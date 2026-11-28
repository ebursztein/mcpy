/**
 * Asking the stock sources: in configured order, each through its own
 * fallback chain (so it is retried, broken-circuited and costed like any
 * other), a later source only for what earlier ones did not answer.
 */

import { AttemptOutcome, ErrorCode } from "../../enums.js";
import { McpyError } from "../../errors.js";
import type { Judgement } from "../../engine/chain.js";
import type { Engine } from "../../engine/engine.js";
import type { StockCapabilities, StockProvider } from "../../providers/stock-types.js";

/** Sources that can answer this part, in configured order. */
export function sourcesFor(engine: Engine, part: keyof StockCapabilities): StockProvider[] {
  return engine.stockProviders.filter((p) => p.capabilities[part] && p[part]);
}

/** No stock source configured for this part: a server setup problem, worded without naming any. */
export const noSources = (what: string) => new McpyError(ErrorCode.NoProviders, `no stock source is configured for ${what}`);

/** No source knew the symbol: the caller's to fix, not an outage. */
export const unknownSymbol = (symbol: string, what: string) => new McpyError(ErrorCode.NotFound, `no source has ${what} for ${symbol}`);

/** An answer with nothing in it moves on to the next source; it is kept if no source does better. */
export const movesOnWhenEmpty = (empty: boolean): Judgement =>
  empty ? { outcome: AttemptOutcome.Escalate, reason: "no data", salvageable: true } : { outcome: AttemptOutcome.Ok };
