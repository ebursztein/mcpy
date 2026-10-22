import { describe, expect, it } from "vitest";
import { AttemptOutcome, ErrorCode, LogLevel } from "mcpy";
import { MemorySink, Telemetry } from "mcpy/telemetry";
import { CircuitBreaker } from "../../src/engine/breaker.js";
import { runChain, type ChainProvider } from "../../src/engine/chain.js";
import { ProviderFailure } from "../../src/errors.js";

const POLICY = { failureThreshold: 3, cooldownMs: 1_000 };

/** A breaker whose clock the test moves by hand. */
function clocked() {
  const clock = { t: 1_000_000 };
  return { clock, breaker: new CircuitBreaker(POLICY, () => clock.t) };
}

describe("CircuitBreaker", () => {
  it("starts closed", () => {
    expect(clocked().breaker.isOpen("a")).toBe(false);
  });

  it("opens after the threshold of consecutive failures, not before", () => {
    const { breaker } = clocked();
    breaker.recordFailure("a");
    breaker.recordFailure("a");
    expect(breaker.isOpen("a")).toBe(false);
    breaker.recordFailure("a");
    expect(breaker.isOpen("a")).toBe(true);
  });

  it("tracks providers independently", () => {
    const { breaker } = clocked();
    for (let i = 0; i < POLICY.failureThreshold; i++) breaker.recordFailure("a");
    expect(breaker.isOpen("a")).toBe(true);
    expect(breaker.isOpen("b")).toBe(false);
  });

  it("a success resets the consecutive-failure count", () => {
    const { breaker } = clocked();
    breaker.recordFailure("a");
    breaker.recordFailure("a");
    breaker.recordSuccess("a");
    breaker.recordFailure("a");
    breaker.recordFailure("a");
    expect(breaker.isOpen("a")).toBe(false);
  });

  it("goes half-open after the cooldown; a failed trial re-opens it at once", () => {
    const { clock, breaker } = clocked();
    for (let i = 0; i < POLICY.failureThreshold; i++) breaker.recordFailure("a");
    clock.t += POLICY.cooldownMs - 1;
    expect(breaker.isOpen("a")).toBe(true);
    clock.t += 1;
    expect(breaker.isOpen("a")).toBe(false); // half-open: one trial allowed
    breaker.recordFailure("a");
    expect(breaker.isOpen("a")).toBe(true);
  });

  it("a successful trial closes it", () => {
    const { clock, breaker } = clocked();
    for (let i = 0; i < POLICY.failureThreshold; i++) breaker.recordFailure("a");
    clock.t += POLICY.cooldownMs;
    breaker.recordSuccess("a");
    breaker.recordFailure("a");
    expect(breaker.isOpen("a")).toBe(false);
  });
});

describe("circuit breaker inside runChain", () => {
  interface Fake extends ChainProvider {
    calls: number;
    ok: boolean;
  }
  const fake = (id: string, ok: boolean): Fake => ({ id, costPerCall: 0.01, calls: 0, ok });

  function run(providers: Fake[], breaker: CircuitBreaker) {
    return runChain({
      providers,
      attempt: async (p) => {
        p.calls++;
        if (!p.ok) throw new ProviderFailure(ErrorCode.UpstreamFailed, "HTTP 503");
        return "page";
      },
      judge: () => ({ outcome: AttemptOutcome.Ok }),
      attemptTimeoutMs: 1_000,
      deadlineAt: Date.now() + 5_000,
      breaker,
      telemetry: new Telemetry([new MemorySink()], {}, LogLevel.Debug),
      parent: { traceId: "1".repeat(32), spanId: "2".repeat(16) },
    });
  }

  it("skips a provider whose circuit is open and records it as skipped", async () => {
    const { breaker } = clocked();
    const flaky = fake("flaky", false);
    const backup = fake("backup", true);
    for (let i = 0; i < POLICY.failureThreshold; i++) await run([flaky, backup], breaker);
    expect(flaky.calls).toBe(POLICY.failureThreshold);

    const result = await run([flaky, backup], breaker);
    expect(flaky.calls).toBe(POLICY.failureThreshold);
    expect(result.provider).toBe("backup");
    expect(result.attempts[0]).toMatchObject({ provider: "flaky", outcome: AttemptOutcome.Skipped, latencyMs: 0 });
    expect(result.costUsd).toBeCloseTo(0.01, 10); // a skipped provider costs nothing
  });

  it("tries the provider again after the cooldown and closes on success", async () => {
    const { clock, breaker } = clocked();
    const flaky = fake("flaky", false);
    const backup = fake("backup", true);
    for (let i = 0; i < POLICY.failureThreshold; i++) await run([flaky, backup], breaker);
    clock.t += POLICY.cooldownMs;
    flaky.ok = true;
    const result = await run([flaky, backup], breaker);
    expect(result.provider).toBe("flaky");
    expect(breaker.isOpen("flaky")).toBe(false);
  });

  it("still tries providers when every circuit is open", async () => {
    const { breaker } = clocked();
    const a = fake("a", false);
    const b = fake("b", false);
    for (let i = 0; i < POLICY.failureThreshold; i++) await run([a, b], breaker).catch(() => undefined);
    expect(breaker.isOpen("a") && breaker.isOpen("b")).toBe(true);

    a.ok = true;
    const result = await run([a, b], breaker);
    expect(result.provider).toBe("a");
    expect(result.attempts.map((x) => x.outcome)).toEqual([AttemptOutcome.Ok]);
    expect(breaker.isOpen("a")).toBe(false);
  });

  it("when all are open and all fail, reports upstream_failed with no skipped attempts", async () => {
    const { breaker } = clocked();
    const a = fake("a", false);
    const b = fake("b", false);
    for (let i = 0; i < POLICY.failureThreshold; i++) await run([a, b], breaker).catch(() => undefined);
    const err = await run([a, b], breaker).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: ErrorCode.UpstreamFailed });
    expect(a.calls).toBe(POLICY.failureThreshold + 1);
    expect(b.calls).toBe(POLICY.failureThreshold + 1);
  });
});
