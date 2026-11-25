/**
 * Asking the crypto sources: every capable source at once (each through its
 * own fallback chain, so a failing one is retried, broken-circuited and
 * costed like any other), merged afterwards. One failing source never fails
 * the call while another answered.
 */

import { AttemptOutcome, ErrorCode } from "../../enums.js";
import { McpyError } from "../../errors.js";
import type { ChainResult, Judgement } from "../../engine/chain.js";
import type { CallScope, Engine } from "../../engine/engine.js";
import { fanOut } from "../../engine/fanout.js";
import { pickCoins, type CryptoProvider, type CryptoSnapshot, type FoundCoinDay, type FoundLiveCoin, type HistoryRequest, type SnapshotRequest } from "../../providers/crypto-types.js";
import { MIN_CRYPTO_MAX_AGE_SECONDS } from "../../schemas-crypto.js";
import type { Tagged } from "./merge.js";

/** Sources that can answer this part of a call, in configured order. */
export function sourcesFor(engine: Engine, part: "live" | "history"): CryptoProvider[] {
  return engine.cryptoProviders.filter((p) => (part === "history" ? p.capabilities.history && p.history : (p.capabilities.live || p.capabilities.totals) && (p.snapshot || p.table)));
}

/** No crypto source configured for this part: a server setup problem, worded without naming any. */
export const noSources = (what: string) => new McpyError(ErrorCode.NoProviders, `no crypto source is configured for ${what}`);

const escalateEmpty = (empty: boolean): Judgement =>
  empty ? { outcome: AttemptOutcome.Escalate, reason: "no coins", salvageable: true } : { outcome: AttemptOutcome.Ok };

/** Run every source at once, tagging each answer with its source. */
function askAll<T>(engine: Engine, providers: CryptoProvider[], run: (p: CryptoProvider) => Promise<ChainResult<T>>): Promise<ChainResult<Tagged<T>[]>> {
  const tagged = (p: CryptoProvider) => run(p).then((r) => ({ ...r, value: { provider: p.id, value: r.value } }));
  return fanOut(providers, tagged, (answers) => answers, engine.limits.thoroughGraceMs);
}

/** Cache key of a source's whole table, shared by every call whatever coins it asks for. */
const tableKey = (id: string) => `v1:crypto:table:${id}`;

/**
 * A whole-table source's coins for this request: the table is read from the cache when it is
 * young enough (at least 5 minutes, per the crypto floor) and downloaded only otherwise.
 */
async function fromTable(engine: Engine, p: CryptoProvider, req: SnapshotRequest, deadlineAt: number, scope: CallScope, maxAgeSeconds: number): Promise<ChainResult<CryptoSnapshot>> {
  let fresh: ChainResult<FoundLiveCoin[]> | undefined;
  // An empty or salvaged table is never kept: one bad download must not blank the network figures for 5 minutes.
  const ttl = (coins: FoundLiveCoin[], salvaged: boolean) => (salvaged || coins.length === 0 ? undefined : MIN_CRYPTO_MAX_AGE_SECONDS);
  const served = await engine.cached(tableKey(p.id), ttl, maxAgeSeconds, scope, async () => {
    fresh = await engine.chain([p], (q, call) => q.table!(call), (coins) => escalateEmpty(coins.length === 0), deadlineAt, scope);
    return fresh;
  });
  return { value: { coins: pickCoins(served.value, req) }, provider: p.id, attempts: fresh?.attempts ?? [], costUsd: fresh?.costUsd ?? 0, salvaged: false };
}

/** Every live source's snapshot, tagged; whole-table sources answer from their shared cached table. */
export function askSnapshots(
  engine: Engine,
  providers: CryptoProvider[],
  req: SnapshotRequest,
  deadlineAt: number,
  scope: CallScope,
  maxAgeSeconds: number,
): Promise<ChainResult<Tagged<CryptoSnapshot>[]>> {
  return askAll(engine, providers, (p) =>
    p.table
      ? fromTable(engine, p, req, deadlineAt, scope, maxAgeSeconds)
      : engine.chain([p], (q, call) => q.snapshot!(req, call), (s) => escalateEmpty(s.coins.length === 0 && !s.totals), deadlineAt, scope),
  );
}

/** Every history source's days, tagged. */
export function askHistories(engine: Engine, providers: CryptoProvider[], req: HistoryRequest, deadlineAt: number, scope: CallScope): Promise<ChainResult<Tagged<FoundCoinDay[]>[]>> {
  return askAll(engine, providers, (p) => engine.chain([p], (q, call) => q.history!(req, call), (days) => escalateEmpty(days.length === 0), deadlineAt, scope));
}
