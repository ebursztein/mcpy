/**
 * Which page providers a fetch may try, and what it learns afterwards:
 * - site routes put the provider that last served a site first;
 * - `freeOnly` (the caller's choice) keeps paid providers out of the call;
 * - a site whose paid providers all failed gets its free ones only for a
 *   while, so a failed escalation is not paid for again on every call.
 * In both free-only cases the cache still answers, and a failure is an
 * ordinary `upstream_failed` that says paid sources were not tried.
 */

import { ErrorCode, LogLevel } from "../enums.js";
import { McpyError } from "../errors.js";
import type { FetchedPage, PageProvider } from "../providers/types.js";
import { Attr } from "../telemetry/attributes.js";
import type { ChainResult } from "./chain.js";
import type { CallScope } from "./engine.js";
import { routeOrder, type PaidFailures, type SiteRoutes } from "./routes.js";

/** How a caller lets a page fetch spend. */
export interface PagePolicy {
  /** Never try a paid provider: free ones and the cache only. */
  freeOnly?: boolean;
}

export const isFree = (p: PageProvider): boolean => p.costPerCall === 0;

export interface PageChainContext {
  /** Capable providers in configured order. */
  capable: PageProvider[];
  /** The request's route-memory site, if it has one. */
  site: string | undefined;
  policy: PagePolicy;
  routes: SiteRoutes;
  failures: PaidFailures;
  scope: CallScope;
  /** Runs the fallback chain over `providers`; `onAttempt` hears each provider tried. */
  run: (providers: PageProvider[], onAttempt: (p: PageProvider) => void) => Promise<ChainResult<FetchedPage>>;
}

/** The error a call that could not reach a free provider at all gets. */
export function noFreeProvider(): McpyError {
  return new McpyError(ErrorCode.NoProviders, "free_only: no free source on this server can serve this request");
}

export async function runPageChain(c: PageChainContext): Promise<ChainResult<FetchedPage>> {
  const paused = !c.policy.freeOnly && c.site !== undefined && (await c.failures.recent(c.site));
  const freeOnly = c.policy.freeOnly === true || paused;
  const pool = freeOnly ? c.capable.filter(isFree) : c.capable;
  if (pool.length === 0) throw c.policy.freeOnly ? noFreeProvider() : pausedError(c.failures.seconds);
  if (paused) c.scope.telemetry.log(LogLevel.Info, "paid sources paused for site", {}, c.scope.parent);

  const preferred = c.site ? await c.routes.recall(c.site) : undefined;
  const providers = routeOrder(pool, preferred);
  if (providers[0] !== c.capable[0]) c.scope.telemetry.log(LogLevel.Debug, "site route", { [Attr.Provider]: providers[0].id }, c.scope.parent);

  let triedPaid = false;
  let result: ChainResult<FetchedPage>;
  try {
    result = await c.run(providers, (p) => (triedPaid ||= !isFree(p)));
  } catch (err) {
    if (!(err instanceof McpyError) || (err.code !== ErrorCode.UpstreamFailed && err.code !== ErrorCode.Timeout)) throw err;
    if (triedPaid && c.site) await defer(c.scope, c.failures.remember(c.site));
    if (paused) throw pausedError(c.failures.seconds, err.details);
    if (freeOnly) throw new McpyError(err.code, `${err.message} (free_only: paid sources were not tried)`, err.details);
    throw err;
  }
  if (c.site && !result.salvaged) await learnRoute(c, preferred, result.provider);
  return result;
}

function pausedError(seconds: number, details?: string[]): McpyError {
  const minutes = Math.round(seconds / 60);
  return new McpyError(
    ErrorCode.UpstreamFailed,
    `the free sources failed, and the paid ones are paused for this site: they all failed on a call in the last ${minutes} minutes`,
    details,
  );
}

/** Remember which provider served a site, when that changes what the next call tries first. */
function learnRoute(c: PageChainContext, preferred: string | undefined, served: string): Promise<void> {
  const isDefault = served === c.capable[0].id;
  if (served === preferred || (preferred === undefined && isDefault)) return Promise.resolve();
  return defer(c.scope, c.routes.remember(c.site!, served));
}

/** Memory writes never fail a call, and run after the response when the host allows it. */
async function defer(scope: CallScope, write: Promise<void>): Promise<void> {
  const safe = write.catch(() => undefined);
  if (scope.defer) scope.defer(safe);
  else await safe;
}
