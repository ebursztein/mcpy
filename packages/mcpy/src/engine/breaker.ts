import { z } from "zod";

export const BreakerPolicySchema = z.object({
  /** Consecutive failures that open the circuit. */
  failureThreshold: z.number().int().min(1).max(100).default(5),
  /** How long an open circuit skips the provider. */
  cooldownMs: z.number().int().min(0).max(3_600_000).default(30_000),
});
export type BreakerPolicy = z.infer<typeof BreakerPolicySchema>;

interface State {
  failures: number;
  openUntil: number;
}

/**
 * Per-provider circuit breaker. After `failureThreshold` consecutive
 * failures a provider is skipped until the cooldown ends; the next call
 * after that is a trial (half-open) that closes or re-opens the circuit.
 * State is per process (per Worker isolate), which is what we want: it
 * reacts within seconds without shared storage.
 */
export class CircuitBreaker {
  private readonly states = new Map<string, State>();

  constructor(
    private readonly policy: BreakerPolicy,
    private readonly now: () => number = Date.now,
  ) {}

  isOpen(id: string): boolean {
    const s = this.states.get(id);
    return !!s && s.openUntil > this.now();
  }

  recordSuccess(id: string): void {
    this.states.delete(id);
  }

  recordFailure(id: string): void {
    const s = this.states.get(id) ?? { failures: 0, openUntil: 0 };
    s.failures += 1;
    if (s.failures >= this.policy.failureThreshold) s.openUntil = this.now() + this.policy.cooldownMs;
    this.states.set(id, s);
  }
}
