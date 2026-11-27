import { ErrorCode, McpyError } from "mcpy";

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
