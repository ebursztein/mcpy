import { AttemptOutcome, ErrorCode, SpanName, SpanStatus } from "../enums.js";
import { McpyError, ProviderFailure } from "../errors.js";
import { Attr } from "../telemetry/attributes.js";
import type { Telemetry } from "../telemetry/telemetry.js";
import type { SpanContext } from "../telemetry/types.js";
import type { CircuitBreaker } from "./breaker.js";

export interface AttemptRecord {
  provider: string;
  outcome: AttemptOutcome;
  /** Internal detail (may name the provider): telemetry only. */
  reason?: string;
  /** Safe to show callers: an ErrorCode or a quality verdict. */
  publicReason?: string;
  latencyMs: number;
}

export interface ChainResult<T> {
  value: T;
  provider: string;
  attempts: AttemptRecord[];
  costUsd: number;
}

export interface ChainProvider {
  readonly id: string;
  readonly costPerCall: number;
}

export type Judgement = { outcome: AttemptOutcome; reason?: string };

export interface ChainOptions<P extends ChainProvider, T> {
  providers: P[];
  /** Run one attempt; `signal` fires on the attempt timeout or the deadline. */
  attempt: (provider: P, signal: AbortSignal, timeoutMs: number, parent: SpanContext) => Promise<T>;
  judge: (value: T) => Judgement;
  /** Facts about a value worth putting on the attempt span. */
  describe?: (value: T) => Record<string, number>;
  attemptTimeoutMs: number;
  deadlineAt: number;
  breaker: CircuitBreaker;
  telemetry: Telemetry;
  parent: SpanContext;
}

function reasonOf(err: unknown): { code: string; message: string } {
  if (err instanceof ProviderFailure) return { code: err.code, message: err.message };
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return { code: ErrorCode.Timeout, message: "timed out" };
  return { code: ErrorCode.Internal, message: err instanceof Error ? err.message : String(err) };
}

/**
 * Try providers in order until one yields an acceptable result.
 * - Each attempt is bounded by min(attempt timeout, time left to the deadline).
 * - Providers with an open circuit are skipped, unless every remaining
 *   provider is open (better a trial call than a guaranteed failure).
 * - An Ok or Final judgement stops the chain; Escalate and errors move on.
 */
export async function runChain<P extends ChainProvider, T>(o: ChainOptions<P, T>): Promise<ChainResult<T>> {
  if (o.providers.length === 0) throw new McpyError(ErrorCode.NoProviders, "no providers are configured for this operation");

  const attempts: AttemptRecord[] = [];
  let costUsd = 0;
  const allOpen = o.providers.every((p) => o.breaker.isOpen(p.id));

  for (const provider of o.providers) {
    const remaining = o.deadlineAt - Date.now();
    if (remaining <= 0) break;
    if (!allOpen && o.breaker.isOpen(provider.id)) {
      attempts.push({ provider: provider.id, outcome: AttemptOutcome.Skipped, reason: "circuit open", publicReason: "circuit open", latencyMs: 0 });
      continue;
    }

    const timeoutMs = Math.min(o.attemptTimeoutMs, remaining);
    const started = Date.now();
    const span = o.telemetry.startSpan(SpanName.Attempt, { [Attr.Provider]: provider.id, [Attr.CostUsd]: provider.costPerCall }, o.parent);
    costUsd += provider.costPerCall;
    try {
      const value = await o.attempt(provider, AbortSignal.timeout(timeoutMs), timeoutMs, span.context);
      const verdict = o.judge(value);
      // Quality verdicts ("HTTP 403", "bot challenge detected") never name a provider.
      const record: AttemptRecord = {
        provider: provider.id,
        outcome: verdict.outcome,
        reason: verdict.reason,
        publicReason: verdict.reason,
        latencyMs: Date.now() - started,
      };
      attempts.push(record);
      span.setAttributes({ [Attr.Outcome]: verdict.outcome, ...(verdict.reason ? { [Attr.Reason]: verdict.reason } : {}), ...o.describe?.(value) });

      if (verdict.outcome === AttemptOutcome.Escalate) {
        o.breaker.recordFailure(provider.id);
        span.end(SpanStatus.Error, verdict.reason);
        continue;
      }
      o.breaker.recordSuccess(provider.id);
      span.end(SpanStatus.Ok);
      return { value, provider: provider.id, attempts, costUsd };
    } catch (err) {
      const { code, message } = reasonOf(err);
      attempts.push({ provider: provider.id, outcome: AttemptOutcome.Error, reason: message, publicReason: code, latencyMs: Date.now() - started });
      o.breaker.recordFailure(provider.id);
      span.recordError(err);
      span.setAttributes({ [Attr.Outcome]: AttemptOutcome.Error, [Attr.Reason]: `${code}: ${message}` });
      span.end(SpanStatus.Error, message);
    }
  }

  // Callers see outcomes and error codes only; raw messages stay in telemetry.
  const summary = attempts.map((a) => `${a.outcome}${a.publicReason ? ` (${a.publicReason})` : ""}`);
  const timedOut = Date.now() >= o.deadlineAt;
  throw new McpyError(
    timedOut ? ErrorCode.Timeout : ErrorCode.UpstreamFailed,
    timedOut ? "deadline exceeded before any source succeeded" : "every source failed for this request",
    // Attempt outcomes only: provider names stay internal.
    summary,
  );
}
