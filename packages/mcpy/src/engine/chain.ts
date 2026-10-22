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
  /** True when no provider did better than a thin page (not worth caching). */
  salvaged: boolean;
}

export interface ChainProvider {
  readonly id: string;
  readonly costPerCall: number;
  /**
   * Whether failures count toward this provider's circuit breaker. False for
   * providers whose failures are about the target, not their own health
   * (a direct fetch failing says the site is down, not that fetch is).
   */
  readonly circuitBreaker?: boolean;
}

export interface Judgement {
  outcome: AttemptOutcome;
  reason?: string;
  /** A thin but real result, returned if no provider does better. */
  salvageable?: boolean;
}

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

/** Failures that say something about the request itself: no other provider can help. */
function definitive(err: unknown): McpyError | undefined {
  if (err instanceof McpyError) return err; // e.g. a redirect to a private address
  if (err instanceof ProviderFailure && err.code === ErrorCode.UnsupportedContent) {
    return new McpyError(ErrorCode.UnsupportedContent, "unsupported content type");
  }
  return undefined;
}

function reasonOf(err: unknown): { code: string; message: string } {
  if (err instanceof ProviderFailure) return { code: err.code, message: err.message };
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return { code: ErrorCode.Timeout, message: "timed out" };
  return { code: ErrorCode.Internal, message: err instanceof Error ? err.message : String(err) };
}

/** Settle at the attempt timeout even if the provider ignores its signal. */
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ProviderFailure(ErrorCode.Timeout, "attempt timed out"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Try providers in order until one yields an acceptable result.
 * - Each attempt is bounded by min(attempt timeout, time left to the deadline).
 * - Providers with an open circuit are skipped, unless every provider is open.
 * - Ok or Final stops the chain; Escalate and errors move on; definitive
 *   errors (unsafe target, unsupported content) stop it without a fallback.
 * - Only thrown provider failures feed the circuit breaker: a blocked or
 *   JS-heavy target says nothing about the provider's health.
 * - If nothing is Ok, the first salvageable result is returned.
 */
export async function runChain<P extends ChainProvider, T>(o: ChainOptions<P, T>): Promise<ChainResult<T>> {
  if (o.providers.length === 0) throw new McpyError(ErrorCode.NoProviders, "no providers are configured for this operation");

  const attempts: AttemptRecord[] = [];
  let costUsd = 0;
  let salvage: { value: T; provider: string } | undefined;
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
      const signal = AbortSignal.timeout(timeoutMs);
      const value = await bounded(o.attempt(provider, signal, timeoutMs, span.context), signal);
      // The provider answered: it is healthy, whatever the page looks like.
      o.breaker.recordSuccess(provider.id);
      const verdict = o.judge(value);
      // Quality verdicts ("HTTP 403", "bot challenge detected") never name a provider.
      attempts.push({ provider: provider.id, outcome: verdict.outcome, reason: verdict.reason, publicReason: verdict.reason, latencyMs: Date.now() - started });
      span.setAttributes({ [Attr.Outcome]: verdict.outcome, ...(verdict.reason ? { [Attr.Reason]: verdict.reason } : {}), ...o.describe?.(value) });

      if (verdict.outcome === AttemptOutcome.Escalate) {
        if (verdict.salvageable && !salvage) salvage = { value, provider: provider.id };
        span.end(SpanStatus.Error, verdict.reason);
        continue;
      }
      span.end(SpanStatus.Ok);
      return { value, provider: provider.id, attempts, costUsd, salvaged: false };
    } catch (err) {
      const { code, message } = reasonOf(err);
      attempts.push({ provider: provider.id, outcome: AttemptOutcome.Error, reason: message, publicReason: code, latencyMs: Date.now() - started });
      span.recordError(err);
      span.setAttributes({ [Attr.Outcome]: AttemptOutcome.Error, [Attr.Reason]: `${code}: ${message}` });
      span.end(SpanStatus.Error, message);
      const stop = definitive(err);
      if (stop) throw stop;
      if (provider.circuitBreaker !== false) o.breaker.recordFailure(provider.id);
    }
  }

  if (salvage) return { value: salvage.value, provider: salvage.provider, attempts, costUsd, salvaged: true };

  // Callers see outcomes and error codes only; raw messages stay in telemetry.
  const summary = attempts.map((a) => `${a.outcome}${a.publicReason ? ` (${a.publicReason})` : ""}`);
  const timedOut = Date.now() >= o.deadlineAt;
  throw new McpyError(
    timedOut ? ErrorCode.Timeout : ErrorCode.UpstreamFailed,
    timedOut ? "deadline exceeded before any source succeeded" : "every source failed for this request",
    summary,
  );
}
