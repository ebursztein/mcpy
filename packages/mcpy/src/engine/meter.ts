/**
 * Spending limits. A caller with a SpendLimit can use free sources (cache,
 * direct fetch, free indexes) without limit; paid sources are skipped once
 * the limit says no. Costs are the providers' estimated `costPerCall`.
 */

/** What a host (e.g. the server) plugs in to cap one caller's spending. */
export interface SpendLimit {
  /** False once the caller has used up its allowance. Asked at most once per operation. */
  allows(): Promise<boolean>;
  /** Estimated USD one operation spent (failed attempts included). Called only when it is above 0. */
  record(usd: number): Promise<void>;
}

/** One operation's view of the limit: asks lazily, totals every paid attempt. */
export class SpendMeter {
  private verdict?: Promise<boolean>;
  private total = 0;

  constructor(
    private readonly limit?: SpendLimit,
    /** A limit that cannot answer fails open: it is a budget, not an access control. */
    private readonly onLimitError?: (err: unknown) => void,
  ) {}

  /** Whether a paid attempt may run. Free attempts never need to ask. */
  mayPay(): Promise<boolean> {
    if (!this.limit) return Promise.resolve(true);
    this.verdict ??= this.limit.allows().catch((err: unknown) => {
      this.onLimitError?.(err);
      return true;
    });
    return this.verdict;
  }

  spend(usd: number): void {
    this.total += usd;
  }

  get spentUsd(): number {
    return this.total;
  }
}
