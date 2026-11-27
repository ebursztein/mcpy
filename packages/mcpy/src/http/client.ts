import type { z } from "zod";
import { ErrorCode, HttpMethod, SpanName, SpanStatus } from "../enums.js";
import { isIdempotentMethod } from "./methods.js";
import { ProviderFailure } from "../errors.js";
import { Attr } from "../telemetry/attributes.js";
import type { Telemetry } from "../telemetry/telemetry.js";
import type { SpanContext } from "../telemetry/types.js";
import { readTextCapped } from "./body.js";
import { backoffDelay, isRetryableError, isRetryableStatus, retryAfterMs, sleep, type RetryPolicy } from "./retry.js";
import { assertPublicHttpUrl } from "./url.js";

export { HttpMethod };

export interface HttpRequest {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  /** Serialized as JSON with the matching content type. */
  json?: unknown;
  /** Sent as is (ignored when `json` is set); the content type is the caller's header. */
  body?: string;
  /**
   * Checked against the response content type before the body is read;
   * returning false fails the request with `unsupported_content` without
   * downloading it.
   */
  acceptContentType?: (contentType: string) => boolean;
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
  /** Final URL after redirects. */
  url: string;
  headers: Headers;
  text: string;
}

export interface HttpClientOptions {
  fetch: typeof fetch;
  retry: RetryPolicy;
}

export const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
/** Answers that say the server did not act on the request, so even a POST may be sent again. */
const NOT_PROCESSED = new Set([408, 425, 429]);

/**
 * The only way mcpy talks to the network. Every try gets a span; transient
 * failures are retried with jittered backoff (honoring Retry-After and the
 * deadline); redirects are followed by hand so that every hop passes the
 * private-address guard; bodies are capped and type-checked before download.
 */
export class HttpClient {
  constructor(private readonly options: HttpClientOptions) {}

  async send(req: HttpRequest, ctx: HttpContext): Promise<HttpResponse> {
    let current = req;
    for (let hop = 0; ; hop++) {
      const res = await this.withRetries(current, ctx);
      const location = res.headers.get("location");
      if (REDIRECT_STATUS.has(res.status) && location) {
        await discard(res);
        if (hop >= MAX_REDIRECTS) throw new ProviderFailure(ErrorCode.UpstreamFailed, `more than ${MAX_REDIRECTS} redirects`, res.status);
        current = nextHop(current, res.status, new URL(location, current.url).toString());
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (req.acceptContentType && !req.acceptContentType(contentType)) {
        await discard(res);
        throw new ProviderFailure(ErrorCode.UnsupportedContent, `unsupported content type: ${contentType || "none"}`, res.status);
      }
      const text = await readTextCapped(res, ctx.maxBytes).catch((err) => {
        throw toFailure(err);
      });
      return { status: res.status, url: current.url, headers: res.headers, text };
    }
  }

  /**
   * One request (no redirect following), retried on transient failures. Body unread.
   * A caller's POST or PATCH to a target may not be safe to repeat: it is
   * retried only when the answer says it was not processed (408, 425, 429),
   * never after a 5xx or a lost connection. Idempotent methods (GET, HEAD, PUT,
   * DELETE) and mcpy's own JSON calls to providers retry as GETs do.
   */
  private async withRetries(req: HttpRequest, ctx: HttpContext): Promise<Response> {
    const { retry } = this.options;
    const target = new URL(req.url);
    const unsafe = !isIdempotentMethod(req.method) && req.json === undefined;
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
          body: req.json === undefined ? req.body : JSON.stringify(req.json),
          redirect: "manual",
          signal: ctx.signal,
        });
        span.setAttributes({ [Attr.HttpStatus]: res.status });

        const retryable = unsafe ? NOT_PROCESSED.has(res.status) : isRetryableStatus(res.status);
        if (retryable && attempt < retry.retries) {
          const delay = retryAfterMs(res.headers.get("retry-after"), retry) ?? backoffDelay(attempt + 1, retry);
          if (Date.now() + delay < ctx.deadlineAt) {
            await discard(res);
            span.end(SpanStatus.Error, `retrying after HTTP ${res.status}`);
            await sleep(delay, ctx.signal).catch((abort) => {
              throw toFailure(abort);
            });
            continue;
          }
        }
        span.end(res.status >= 500 ? SpanStatus.Error : SpanStatus.Ok);
        return res;
      } catch (err) {
        if (err instanceof ProviderFailure) throw err;
        span.recordError(err);
        span.end(SpanStatus.Error, err instanceof Error ? err.message : String(err));
        if (!unsafe && isRetryableError(err) && attempt < retry.retries) {
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

/**
 * Next request in a redirect chain. The target must pass the same guard as
 * the caller's URL (throws McpyError invalid_target), so a public page cannot
 * bounce us to localhost or a metadata endpoint. A 303 (but after a HEAD), and
 * a 301/302 after a POST, become GETs without a body, as browsers do
 * (RFC 9110 15.4); every other redirect keeps the method and body.
 */
function nextHop(req: HttpRequest, status: number, url: string): HttpRequest {
  assertPublicHttpUrl(url);
  const toGet = (status === 303 && req.method !== HttpMethod.Head) || ((status === 301 || status === 302) && req.method === HttpMethod.Post);
  if (!toGet) return { ...req, url };
  const headers = req.headers && Object.fromEntries(Object.entries(req.headers).filter(([name]) => name.toLowerCase() !== "content-type"));
  return { ...req, url, method: HttpMethod.Get, json: undefined, body: undefined, headers };
}

/** Drop a body we will not read; a body that already errored must not fail the request. */
async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined);
}

function toFailure(err: unknown): ProviderFailure {
  if (err instanceof ProviderFailure) return err;
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new ProviderFailure(ErrorCode.Timeout, "request timed out");
  }
  return new ProviderFailure(ErrorCode.UpstreamFailed, err instanceof Error ? err.message : String(err));
}
