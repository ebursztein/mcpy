import type { FetchedPage, FetchProvider, FetchRequest, SearchHit, SearchProvider, SearchRequest } from "../providers/types";
import { assessPage } from "./quality";
import type { Telemetry } from "./telemetry";

export interface Attempt {
  provider: string;
  outcome: "ok" | "final" | "escalate" | "error";
  reason?: string;
  latencyMs: number;
}

export interface ChainResult<T> {
  value: T;
  provider: string;
  attempts: Attempt[];
  costUsd: number;
}

export class ChainExhaustedError extends Error {
  constructor(readonly attempts: Attempt[]) {
    super(
      attempts.length
        ? `all providers failed: ${attempts.map((a) => `${a.provider} (${a.reason ?? a.outcome})`).join("; ")}`
        : "no providers are configured for this operation",
    );
    this.name = "ChainExhaustedError";
  }
}

interface Ctx {
  tool: string;
  target: string;
  telemetry: Telemetry;
}

function errorReason(err: unknown): string {
  if (err instanceof Error) return err.name === "TimeoutError" ? "timeout" : err.message;
  return String(err);
}

/**
 * Try providers in order until one returns a usable page. A definitive answer
 * (e.g. 404) stops the chain so we never pay a fallback to confirm it.
 */
export async function fetchWithFallback(
  providers: FetchProvider[],
  req: FetchRequest,
  ctx: Ctx,
): Promise<ChainResult<FetchedPage>> {
  const attempts: Attempt[] = [];
  let costUsd = 0;

  for (const provider of providers) {
    const started = Date.now();
    try {
      const page = await provider.fetch(req, AbortSignal.timeout(req.timeoutMs));
      costUsd += provider.costPerCall;
      const verdict = assessPage(page);
      const attempt: Attempt = {
        provider: provider.id,
        outcome: verdict.kind,
        reason: verdict.kind === "ok" ? undefined : verdict.reason,
        latencyMs: Date.now() - started,
      };
      attempts.push(attempt);
      ctx.telemetry.record({
        event: "attempt",
        tool: ctx.tool,
        provider: provider.id,
        outcome: attempt.outcome,
        target: ctx.target,
        reason: attempt.reason,
        latencyMs: attempt.latencyMs,
        chars: page.content.length,
        costUsd: provider.costPerCall,
        status: page.status,
      });
      if (verdict.kind !== "escalate") return { value: page, provider: provider.id, attempts, costUsd };
    } catch (err) {
      costUsd += provider.costPerCall;
      const attempt: Attempt = { provider: provider.id, outcome: "error", reason: errorReason(err), latencyMs: Date.now() - started };
      attempts.push(attempt);
      ctx.telemetry.record({
        event: "attempt",
        tool: ctx.tool,
        provider: provider.id,
        outcome: "error",
        target: ctx.target,
        reason: attempt.reason,
        latencyMs: attempt.latencyMs,
        costUsd: provider.costPerCall,
      });
    }
  }
  throw new ChainExhaustedError(attempts);
}

/** Search fallback: the first provider that answers wins, even with zero hits. */
export async function searchWithFallback(
  providers: SearchProvider[],
  req: SearchRequest,
  ctx: Ctx,
): Promise<ChainResult<SearchHit[]>> {
  const attempts: Attempt[] = [];
  let costUsd = 0;

  for (const provider of providers) {
    const started = Date.now();
    try {
      const hits = await provider.search(req, AbortSignal.timeout(req.timeoutMs));
      costUsd += provider.costPerCall;
      const attempt: Attempt = { provider: provider.id, outcome: "ok", latencyMs: Date.now() - started };
      attempts.push(attempt);
      ctx.telemetry.record({
        event: "attempt",
        tool: ctx.tool,
        provider: provider.id,
        outcome: "ok",
        target: ctx.target,
        latencyMs: attempt.latencyMs,
        chars: hits.length,
        costUsd: provider.costPerCall,
      });
      return { value: hits, provider: provider.id, attempts, costUsd };
    } catch (err) {
      costUsd += provider.costPerCall;
      const attempt: Attempt = { provider: provider.id, outcome: "error", reason: errorReason(err), latencyMs: Date.now() - started };
      attempts.push(attempt);
      ctx.telemetry.record({
        event: "attempt",
        tool: ctx.tool,
        provider: provider.id,
        outcome: "error",
        target: ctx.target,
        reason: attempt.reason,
        latencyMs: attempt.latencyMs,
        costUsd: provider.costPerCall,
      });
    }
  }
  throw new ChainExhaustedError(attempts);
}
