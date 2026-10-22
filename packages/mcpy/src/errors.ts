import { ErrorCode } from "./enums.js";

/** HTTP status each error code maps to on the REST API. */
const HTTP_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.InvalidInput]: 400,
  [ErrorCode.InvalidTarget]: 400,
  [ErrorCode.NotFound]: 404,
  [ErrorCode.Unauthorized]: 401,
  [ErrorCode.Forbidden]: 403,
  [ErrorCode.RateLimited]: 429,
  [ErrorCode.NoProviders]: 503,
  [ErrorCode.UpstreamFailed]: 502,
  [ErrorCode.Timeout]: 504,
  [ErrorCode.TooLarge]: 502,
  [ErrorCode.UnsupportedContent]: 415,
  [ErrorCode.BadResponse]: 502,
  [ErrorCode.Internal]: 500,
};

/** The single error type the public API throws. */
export class McpyError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = "McpyError";
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

/**
 * Failure inside one provider attempt. Internal: the engine records it and
 * moves on; callers only ever see a McpyError.
 */
export class ProviderFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderFailure";
  }
}

export function toMcpyError(err: unknown): McpyError {
  if (err instanceof McpyError) return err;
  if (err instanceof ProviderFailure) return new McpyError(err.code, err.message);
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new McpyError(ErrorCode.Timeout, "operation timed out");
  }
  // Never echo internal error text (stack details, schema dumps) to callers;
  // the original stays in telemetry.
  return new McpyError(ErrorCode.Internal, "internal error");
}
