import { describe, expect, it } from "vitest";
import { AttemptOutcome, ErrorCode, LogLevel, McpyError, SpanName, SpanStatus } from "mcpy";
import { Attr, MemorySink, Telemetry, type SpanContext } from "mcpy/telemetry";
import { CircuitBreaker } from "../../src/engine/breaker.js";
import { runChain, type ChainOptions, type ChainProvider, type Judgement } from "../../src/engine/chain.js";
import { ProviderFailure } from "../../src/errors.js";
import { PROVIDER_IDS } from "../helpers.js";

/** Values a fake provider returns; the judge maps them to outcomes. */
const Value = { Good: "good", Missing: "missing", Blocked: "blocked" } as const;
type Value = (typeof Value)[keyof typeof Value];

interface Fake extends ChainProvider {
  calls: number;
  run(signal: AbortSignal): Promise<Value>;
}

function provider(id: string, behavior: Value | Error | ((signal: AbortSignal) => Promise<Value>), costPerCall = 0): Fake {
  const p: Fake = {
    id,
    costPerCall,
    calls: 0,
    async run(signal) {
      p.calls++;
      if (behavior instanceof Error) throw behavior;
      return typeof behavior === "function" ? behavior(signal) : behavior;
    },
  };
  return p;
}

/** Never settles on its own; rejects with the signal's reason when aborted. */
const hangs = (signal: AbortSignal) =>
  new Promise<Value>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));

function judge(value: Value): Judgement {
  if (value === Value.Missing) return { outcome: AttemptOutcome.Final, reason: "HTTP 404" };
  if (value === Value.Blocked) return { outcome: AttemptOutcome.Escalate, reason: "bot challenge detected" };
  return { outcome: AttemptOutcome.Ok };
}

const parent: SpanContext = { traceId: "1".repeat(32), spanId: "2".repeat(16) };

function setup(providers: Fake[], over: Partial<ChainOptions<Fake, Value>> = {}) {
  const sink = new MemorySink();
  const options: ChainOptions<Fake, Value> = {
    providers,
    attempt: (p, signal) => p.run(signal),
    judge,
    describe: (v) => ({ [Attr.ContentChars]: v.length }),
    attemptTimeoutMs: 1_000,
    deadlineAt: Date.now() + 5_000,
    breaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 }),
    telemetry: new Telemetry([sink], {}, LogLevel.Debug),
    parent,
    ...over,
  };
  return { run: () => runChain(options), sink, options };
}

async function chainError(p: Promise<unknown>): Promise<McpyError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(McpyError);
  return err as McpyError;
}

describe("runChain", () => {
  it("stops at the first Ok result", async () => {
    const a = provider("a", Value.Good);
    const b = provider("b", Value.Good);
    const result = await setup([a, b]).run();
    expect(result).toMatchObject({ value: Value.Good, provider: "a", costUsd: 0 });
    expect(result.attempts).toEqual([expect.objectContaining({ provider: "a", outcome: AttemptOutcome.Ok })]);
    expect(b.calls).toBe(0);
  });

  it("stops on a Final (404) answer without calling later providers", async () => {
    const free = provider("free", Value.Missing);
    const paid = provider("paid", Value.Good, 0.01);
    const result = await setup([free, paid]).run();
    expect(result.value).toBe(Value.Missing);
    expect(result.attempts.map((a) => a.outcome)).toEqual([AttemptOutcome.Final]);
    expect(paid.calls).toBe(0);
  });

  it("moves on after an Escalate verdict and after a thrown error", async () => {
    const blocked = provider("blocked", Value.Blocked);
    const broken = provider("broken", new ProviderFailure(ErrorCode.UpstreamFailed, "HTTP 500"));
    const plain = provider("plain", new Error("boom"));
    const good = provider("good", Value.Good);
    const result = await setup([blocked, broken, plain, good]).run();
    expect(result.provider).toBe("good");
    expect(result.attempts.map((a) => [a.provider, a.outcome, a.reason])).toEqual([
      ["blocked", AttemptOutcome.Escalate, "bot challenge detected"],
      ["broken", AttemptOutcome.Error, "HTTP 500"],
      ["plain", AttemptOutcome.Error, "boom"],
      ["good", AttemptOutcome.Ok, undefined],
    ]);
  });

  it("sums the cost of every provider attempted, and only those", async () => {
    const providers = [provider("a", Value.Blocked, 0.001), provider("b", new Error("x"), 0.002), provider("c", Value.Good, 0.004)];
    const unused = provider("d", Value.Good, 1);
    const result = await setup([...providers, unused]).run();
    expect(result.costUsd).toBeCloseTo(0.007, 10);
  });

  it("emits one mcpy.attempt span per attempt, parented on the caller", async () => {
    const { run, sink } = setup([provider("a", Value.Blocked, 0.5), provider("b", Value.Good)]);
    await run();
    const spans = sink.spans.filter((s) => s.name === SpanName.Attempt);
    expect(spans).toHaveLength(2);
    for (const s of spans) expect(s).toMatchObject({ traceId: parent.traceId, parentSpanId: parent.spanId });
    expect(spans[0]).toMatchObject({
      status: SpanStatus.Error,
      attributes: { [Attr.Provider]: "a", [Attr.CostUsd]: 0.5, [Attr.Outcome]: AttemptOutcome.Escalate, [Attr.ContentChars]: Value.Blocked.length },
    });
    expect(spans[1]).toMatchObject({ status: SpanStatus.Ok, attributes: { [Attr.Provider]: "b", [Attr.Outcome]: AttemptOutcome.Ok } });
  });

  it("throws no_providers when there is nothing to try", async () => {
    const err = await chainError(setup([]).run());
    expect(err.code).toBe(ErrorCode.NoProviders);
  });

  it("throws upstream_failed when every provider fails, naming no provider", async () => {
    const providers = PROVIDER_IDS.map((id, i) =>
      i % 2 ? provider(id, Value.Blocked) : provider(id, new ProviderFailure(ErrorCode.UpstreamFailed, "HTTP 502")),
    );
    const err = await chainError(setup(providers).run());
    expect(err.code).toBe(ErrorCode.UpstreamFailed);
    expect(err.details).toHaveLength(PROVIDER_IDS.length);
    const text = JSON.stringify(err.toJSON());
    for (const id of PROVIDER_IDS) expect(text).not.toContain(id);
    expect(providers.every((p) => p.calls === 1)).toBe(true);
  });

  it("does not leak a provider id that appears in a provider's error message", async () => {
    const providers = [
      provider("firecrawl", new Error("firecrawl: quota exceeded")),
      provider("brightdata", new ProviderFailure(ErrorCode.UpstreamFailed, "HTTP 500: brightdata zone disabled")),
      provider("direct", Value.Blocked),
    ];
    const err = await chainError(setup(providers).run());
    expect(JSON.stringify(err.toJSON())).not.toMatch(/firecrawl|brightdata|direct|quota|zone/);
    // Public details carry the outcome plus an error code or the quality verdict.
    expect(err.details).toEqual([
      `${AttemptOutcome.Error} (${ErrorCode.Internal})`,
      `${AttemptOutcome.Error} (${ErrorCode.UpstreamFailed})`,
      `${AttemptOutcome.Escalate} (bot challenge detected)`,
    ]);
  });

  it("throws timeout without trying anyone when the deadline has already passed", async () => {
    const a = provider("a", Value.Good);
    const err = await chainError(setup([a], { deadlineAt: Date.now() - 1 }).run());
    expect(err.code).toBe(ErrorCode.Timeout);
    expect(a.calls).toBe(0);
  });

  it("throws timeout when the deadline is reached mid-chain", async () => {
    const slow = provider("slow", hangs);
    const next = provider("next", Value.Good);
    const err = await chainError(setup([slow, next], { attemptTimeoutMs: 1_000, deadlineAt: Date.now() + 20 }).run());
    expect(err.code).toBe(ErrorCode.Timeout);
    expect(slow.calls).toBe(1);
    expect(next.calls).toBe(0);
  });

  it("aborts a hanging provider at the attempt timeout and continues", async () => {
    const stuck = provider("stuck", hangs);
    const next = provider("next", Value.Good);
    const started = Date.now();
    const result = await setup([stuck, next], { attemptTimeoutMs: 15 }).run();
    expect(result.provider).toBe("next");
    expect(result.attempts[0]).toMatchObject({ provider: "stuck", outcome: AttemptOutcome.Error, reason: "timed out", publicReason: ErrorCode.Timeout });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("passes min(attempt timeout, time left) to each attempt", async () => {
    const seen: number[] = [];
    const { run } = setup([provider("a", Value.Good)], {
      attemptTimeoutMs: 100_000,
      deadlineAt: Date.now() + 2_000,
      attempt: (p, signal, timeoutMs) => {
        seen.push(timeoutMs);
        return p.run(signal);
      },
    });
    await run();
    expect(seen[0]).toBeLessThanOrEqual(2_000);
    expect(seen[0]).toBeGreaterThan(1_000);
  });
});
