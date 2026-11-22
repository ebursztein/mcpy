/**
 * Thorough mode asks several providers at once. Waiting for the slowest one
 * made answers as slow as the worst index (seen live: 55 s because one paper
 * index took that long). Instead, once the first provider answers, the
 * others get a grace period; whatever has not answered by then is left out.
 */

import { AttemptOutcome, ErrorCode } from "../enums.js";
import { McpyError } from "../errors.js";
import type { AttemptRecord, ChainResult } from "./chain.js";

export type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown }
  /** Still running when the grace period ended. */
  | { status: "late" };

export async function settleWithGrace<T>(tasks: Promise<T>[], graceMs: number): Promise<Settled<T>[]> {
  const results: (Settled<T> | undefined)[] = tasks.map(() => undefined);
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  let pending = tasks.length;
  let grace: ReturnType<typeof setTimeout> | undefined;

  tasks.forEach((task, i) => {
    task
      .then(
        (value) => {
          results[i] = { status: "fulfilled", value };
          grace ??= setTimeout(finish, graceMs);
        },
        (reason: unknown) => {
          results[i] = { status: "rejected", reason };
        },
      )
      .finally(() => {
        if (--pending === 0) finish();
      });
  });
  if (tasks.length === 0) finish();

  await done;
  if (grace) clearTimeout(grace);
  // Snapshot now: late tasks may still settle later, but their results are not used.
  return results.map((r) => r ?? { status: "late" as const });
}

/**
 * Thorough mode: one chain per provider, in parallel, under the same
 * deadline. Once one answers, the rest get `graceMs`; succeeds if any
 * provider answered, merging what came back.
 */
export async function fanOut<P extends { id: string; costPerCall: number }, T, V>(
  providers: P[],
  run: (provider: P) => Promise<ChainResult<T>>,
  merge: (values: T[]) => V,
  graceMs: number,
  /** Estimated USD of a provider's attempt, counted even when its chain failed. */
  cost: (provider: P) => number = (p) => p.costPerCall,
): Promise<ChainResult<V>> {
  const settled = await settleWithGrace(providers.map(run), graceMs);
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (ok.length === 0) {
    const reasons = settled.flatMap((s) => (s.status === "rejected" ? [s.reason] : []));
    // A spending limit is the one failure the caller can act on: report it first.
    const overBudget = reasons.find((r) => r instanceof McpyError && r.code === ErrorCode.BudgetExceeded);
    throw overBudget ?? reasons[0] ?? new McpyError(ErrorCode.Timeout, "no source answered in time");
  }
  const attempts: AttemptRecord[] = settled.flatMap((s, i) =>
    s.status === "fulfilled"
      ? s.value.attempts
      : [{ provider: providers[i].id, outcome: AttemptOutcome.Error, reason: s.status, publicReason: s.status, latencyMs: 0 }],
  );
  const costUsd = settled.reduce((sum, s, i) => sum + (s.status === "fulfilled" ? s.value.costUsd : cost(providers[i])), 0);
  return { value: merge(ok.map((r) => r.value)), provider: ok.map((r) => r.provider).join("+"), attempts, costUsd, salvaged: false };
}
