import type { z } from "zod";
import { ErrorCode, SpanName, SpanStatus } from "../enums.js";
import { ProviderFailure } from "../errors.js";
import { Attr } from "../telemetry/attributes.js";
import type { Telemetry } from "../telemetry/telemetry.js";
import type { SpanContext } from "../telemetry/types.js";
import { readTextCapped } from "./body.js";
import { backoffDelay, isRetryableError, isRetryableStatus, retryAfterMs, sleep, type RetryPolicy } from "./retry.js";

export const HttpMethod = { Get: "GET", Post: "POST" } as const;
export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod];

export interface HttpRequest {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  /** Serialized as JSON with the matching content type. */
  json?: unknown;
}

export interface HttpContext {
  signal: AbortSignal;
  /** Epoch ms after which no retry is started. */
  deadlineAt: number;
  maxBytes: number;
  telemetry: Telemetry;
  parent?: SpanContext;
}

export interface HttpResponse {
  status: number;
  url: string;
  headers: Headers;
  text: string;
}

export interface HttpClientOptions {
  fetch: typeof fetch;
  retry: RetryPolicy;
}

/**
 * The only way mcpy talks to the network. Every call gets a span, bounded
 * retries with jittered backoff (honoring Retry-After and the deadline), a
 * byte cap on the body, and typed failures.
 */
export class HttpClient {
  constructor(private readonly options: HttpClientOptions) {}

  async send(req: HttpRequest, ctx: HttpContext): Promise<HttpResponse> {
    const { retry } = this.options;
    const target = new URL(req.url);
    for (let attempt = 0; ; attempt++) {
      const span = ctx.telemetry.startSpan(
        SpanName.HttpClient,
        {
          [Attr.HttpMethod]: req.method ?? HttpMethod.Get,
          [Attr.ServerAddress]: target.host,
          [Attr.UrlPath]: target.pathname,
          [Attr.HttpResendCount]: attempt,
        },
        ctx.parent,
      );
      try {
        const res = await this.options.fetch(req.url, {
          method: req.method ?? HttpMethod.Get,
          headers: req.json === undefined ? req.headers : { "Content-Type": "application/json", ...req.headers },
          body: req.json === undefined ? undefined : JSON.stringify(req.json),
          redirect: "follow",
          signal: ctx.signal,
        });
        span.setAttributes({ [Attr.HttpStatus]: res.status });

        if (isRetryableStatus(res.status) && attempt < retry.retries) {
          const delay = retryAfterMs(res.headers.get("retry-after"), retry) ?? backoffDelay(attempt + 1, retry);
          if (Date.now() + delay < ctx.deadlineAt) {
            await res.body?.cancel();
            span.end(SpanStatus.Error, `retrying after HTTP ${res.status}`);
            await sleep(delay, ctx.signal);
            continue;
          }
        }

        const text = await readTextCapped(res, ctx.maxBytes);
        span.end(res.status >= 500 ? SpanStatus.Error : SpanStatus.Ok);
        return { status: res.status, url: res.url || req.url, headers: res.headers, text };
      } catch (err) {
        span.recordError(err);
        span.end(SpanStatus.Error, err instanceof Error ? err.message : String(err));
        if (isRetryableError(err) && attempt < retry.retries) {
          const delay = backoffDelay(attempt + 1, retry);
          if (Date.now() + delay < ctx.deadlineAt) {
            await sleep(delay, ctx.signal).catch((abort) => {
              throw toFailure(abort);
            });
            continue;
          }
        }
        throw toFailure(err);
      }
    }
  }

  /**
   * Send, then parse the body as JSON and validate it against `schema`.
   * When the body is not usable and the status is an HTTP error, the failure
   * is `upstream_failed` (e.g. an HTML 502 from a proxy), not `bad_response`.
   */
  async json<S extends z.ZodType>(req: HttpRequest, schema: S, ctx: HttpContext): Promise<{ response: HttpResponse; data: z.infer<S> }> {
    const response = await this.send(req, ctx);
    const failed = response.status >= 400;
    let raw: unknown;
    try {
      raw = JSON.parse(response.text);
    } catch {
      throw new ProviderFailure(
        failed ? ErrorCode.UpstreamFailed : ErrorCode.BadResponse,
        failed ? `HTTP ${response.status}` : `non-JSON response (HTTP ${response.status})`,
        response.status,
      );
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      if (failed) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}`, response.status);
      const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
      throw new ProviderFailure(ErrorCode.BadResponse, `unexpected response shape (HTTP ${response.status}): ${issues.join("; ")}`, response.status);
    }
    return { response, data: parsed.data };
  }
}

function toFailure(err: unknown): ProviderFailure {
  if (err instanceof ProviderFailure) return err;
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new ProviderFailure(ErrorCode.Timeout, "request timed out");
  }
  return new ProviderFailure(ErrorCode.UpstreamFailed, err instanceof Error ? err.message : String(err));
}
