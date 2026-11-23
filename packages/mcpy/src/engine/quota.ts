/**
 * Quota alerts: a paid source refusing calls because its account ran out
 * (402) or hit its limit (429, after the HTTP client's retries) is not a
 * page problem the fallback can fix for long. The chain reports it so the
 * host can tell its owner; deduplication is the host's job.
 */

import { QuotaAlertKind } from "../enums.js";
import { ProviderFailure } from "../errors.js";

/** One paid source refusing a call for account reasons. Host-facing: it names the provider. */
export interface QuotaAlert {
  kind: QuotaAlertKind;
  provider: string;
  /** The HTTP status the source answered. */
  status: number;
}

/** What a host plugs in to hear about quota alerts. Failures are logged, never thrown at callers. */
export type QuotaAlertSink = (alert: QuotaAlert) => Promise<void> | void;

const KIND_BY_STATUS: Readonly<Record<number, QuotaAlertKind>> = {
  402: QuotaAlertKind.OutOfCredits,
  429: QuotaAlertKind.RateLimited,
};

/** The alert a failed attempt calls for, if any. Only paid sources: free ones have no account to top up. */
export function quotaAlertFor(provider: { id: string; costPerCall: number }, err: unknown): QuotaAlert | undefined {
  if (provider.costPerCall <= 0 || !(err instanceof ProviderFailure) || err.status === undefined) return undefined;
  const kind = KIND_BY_STATUS[err.status];
  return kind ? { kind, provider: provider.id, status: err.status } : undefined;
}
