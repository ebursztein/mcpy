import { z } from "zod";

export const RetryPolicySchema = z.object({
  /** Extra attempts after the first one (0 disables retries). */
  retries: z.number().int().min(0).max(5).default(2),
  baseDelayMs: z.number().int().min(0).max(10_000).default(250),
  maxDelayMs: z.number().int().min(0).max(60_000).default(4_000),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

/** Statuses worth retrying: the request may succeed if sent again. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

/** Network-level failures (not aborts: an abort means our own deadline hit). */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError") return false;
  return err.name === "TypeError" || /network|fetch failed|ECONNRESET|socket|EAI_AGAIN/i.test(err.message);
}

/** Delay before retry `attempt` (1-based): full-jitter exponential backoff. */
export function backoffDelay(attempt: number, policy: RetryPolicy, random = Math.random): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(random() * ceiling);
}

/** Retry-After header in ms (seconds or HTTP date), capped by the policy. */
export function retryAfterMs(header: string | null, policy: RetryPolicy, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return Math.min(ms, policy.maxDelayMs);
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
