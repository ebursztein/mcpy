import { ErrorCode, McpyError } from "mcpy";
import type { RateLimiterLike } from "./env.js";

/**
 * The per-client limit the RATE_LIMITER binding enforces. The binding cannot
 * report its own settings, so this mirrors wrangler.jsonc (a unit test keeps
 * them equal) and lets a refusal tell the caller what to pace itself to.
 */
export const CLIENT_RATE_LIMIT = { requests: 360, periodSeconds: 60 } as const;

/** The 429 a client over its rate limit gets: the limit in the message, details and headers. */
export function rateLimited(): { error: McpyError; headers: Record<string, string> } {
  const { requests, periodSeconds } = CLIENT_RATE_LIMIT;
  return {
    error: new McpyError(ErrorCode.RateLimited, `rate limit exceeded: at most ${requests} requests per ${periodSeconds} s per API key`, [
      `limit: ${requests} requests per ${periodSeconds} s, every call counted (cache hits and page parts included)`,
      `retry after ${periodSeconds} s`,
    ]),
    headers: {
      "Retry-After": String(periodSeconds),
      "RateLimit-Policy": `${requests};w=${periodSeconds}`,
      "X-RateLimit-Limit": String(requests),
    },
  };
}

/**
 * Count `calls` more requests against `key`'s limit (the binding counts one
 * per call to `limit`); false when any is over the limit. A batch of N fetches
 * counts N, as the N calls it replaces would.
 */
export async function chargeCalls(limiter: RateLimiterLike, key: string, calls: number): Promise<boolean> {
  const answers = await Promise.all(Array.from({ length: calls }, () => limiter.limit({ key })));
  return answers.every((a) => a.success);
}

/** How many fetches a batch input asks for, or 0 when it is no batch (the SDK refuses it). */
export function batchSize(input: unknown): number {
  const requests = (input as { requests?: unknown } | null)?.requests;
  return Array.isArray(requests) ? requests.length : 0;
}
