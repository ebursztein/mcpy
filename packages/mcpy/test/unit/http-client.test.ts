import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ErrorCode, LogLevel, SpanName, SpanStatus } from "mcpy";
import { Attr, MemorySink, Telemetry, type SpanContext } from "mcpy/telemetry";
import { ProviderFailure } from "../../src/errors.js";
import { HttpClient, HttpMethod, type HttpContext } from "../../src/http/client.js";
import type { RetryPolicy } from "../../src/http/retry.js";
import { responseAt, stubFetch } from "../helpers.js";

const URL_A = "https://api.example.com/v1/thing";
const FAST: RetryPolicy = { retries: 2, baseDelayMs: 1, maxDelayMs: 2 };

function setup(reply: Parameters<typeof stubFetch>[0], retry: RetryPolicy = FAST, over: Partial<HttpContext> = {}) {
  const sink = new MemorySink();
  const { fetch, calls } = stubFetch(reply);
  const client = new HttpClient({ fetch, retry });
  const ctx: HttpContext = {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 10_000,
    maxBytes: 1_000_000,
    telemetry: new Telemetry([sink], {}, LogLevel.Debug),
    ...over,
  };
  return { client, ctx, calls, sink, httpSpans: () => sink.spans.filter((s) => s.name === SpanName.HttpClient) };
}

/** A fetch that never answers until its signal aborts, like a hung upstream. */
function hang(_url: string, _n: number, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init!.signal!;
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

async function failure(p: Promise<unknown>): Promise<ProviderFailure> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ProviderFailure);
  return err as ProviderFailure;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HttpClient.send", () => {
  it("returns status, final url, headers and text on success", async () => {
    const { client, ctx, calls, httpSpans } = setup((url) =>
      responseAt("https://api.example.com/final", "hello", { status: 200, headers: { "x-test": "1" } }),
    );
    const res = await client.send({ url: URL_A, headers: { accept: "text/plain" } }, ctx);
    expect(res).toMatchObject({ status: 200, url: "https://api.example.com/final", text: "hello" });
    expect(res.headers.get("x-test")).toBe("1");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: URL_A, method: HttpMethod.Get });
    expect(calls[0].headers.get("accept")).toBe("text/plain");
    const [span] = httpSpans();
    expect(span.status).toBe(SpanStatus.Ok);
    expect(span.attributes).toMatchObject({
      [Attr.HttpMethod]: HttpMethod.Get,
      [Attr.ServerAddress]: "api.example.com",
      [Attr.UrlPath]: "/v1/thing",
      [Attr.HttpResendCount]: 0,
      [Attr.HttpStatus]: 200,
    });
  });

  it("sends a JSON body with its content type, and falls back to the request url", async () => {
    const { client, ctx, calls } = setup(() => new Response("{}"));
    const res = await client.send({ url: URL_A, method: HttpMethod.Post, json: { a: 1 }, headers: { authorization: "Bearer t" } }, ctx);
    expect(res.url).toBe(URL_A);
    expect(calls[0].method).toBe(HttpMethod.Post);
    expect(calls[0].body).toEqual({ a: 1 });
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(calls[0].headers.get("authorization")).toBe("Bearer t");
  });

  it("retries a 503 and emits one http.client span per try with its resend count", async () => {
    const parent: SpanContext = { traceId: "a".repeat(32), spanId: "b".repeat(16) };
    const { client, ctx, calls, httpSpans } = setup((url, n) => responseAt(url, n < 3 ? "busy" : "ok", { status: n < 3 ? 503 : 200 }), FAST, {
      parent,
    });
    const res = await client.send({ url: URL_A }, ctx);
    expect(res.status).toBe(200);
    expect(res.text).toBe("ok");
    expect(calls).toHaveLength(3);
    const spans = httpSpans();
    expect(spans.map((s) => s.attributes[Attr.HttpResendCount])).toEqual([0, 1, 2]);
    expect(spans.map((s) => s.attributes[Attr.HttpStatus])).toEqual([503, 503, 200]);
    expect(spans.map((s) => s.status)).toEqual([SpanStatus.Error, SpanStatus.Error, SpanStatus.Ok]);
    for (const s of spans) expect(s).toMatchObject({ traceId: parent.traceId, parentSpanId: parent.spanId });
  });

  it("returns the last retryable response once retries are exhausted", async () => {
    const { client, ctx, calls, httpSpans } = setup((url) => responseAt(url, "down", { status: 503 }));
    const res = await client.send({ url: URL_A }, ctx);
    expect(res.status).toBe(503);
    expect(res.text).toBe("down");
    expect(calls).toHaveLength(FAST.retries + 1);
    expect(httpSpans().at(-1)!.status).toBe(SpanStatus.Error);
  });

  it("honors Retry-After instead of a backoff that would pass the deadline", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1); // backoff would be the full 1000 ms
    const slow: RetryPolicy = { retries: 1, baseDelayMs: 1_000, maxDelayMs: 1_000 };
    const reply = (retryAfter?: string) => (url: string, n: number) =>
      responseAt(url, "x", { status: n === 1 ? 429 : 200, headers: retryAfter ? { "retry-after": retryAfter } : {} });

    const honored = setup(reply("0.001"), slow, { deadlineAt: Date.now() + 500 });
    expect((await honored.client.send({ url: URL_A }, honored.ctx)).status).toBe(200);
    expect(honored.calls).toHaveLength(2);

    const withoutHeader = setup(reply(), slow, { deadlineAt: Date.now() + 500 });
    expect((await withoutHeader.client.send({ url: URL_A }, withoutHeader.ctx)).status).toBe(429);
    expect(withoutHeader.calls).toHaveLength(1);
  });

  it("caps a long Retry-After at maxDelayMs", async () => {
    const { client, ctx, calls } = setup((url, n) => responseAt(url, "x", { status: n === 1 ? 503 : 200, headers: { "retry-after": "3600" } }), {
      retries: 1,
      baseDelayMs: 1,
      maxDelayMs: 5,
    });
    const started = Date.now();
    expect((await client.send({ url: URL_A }, ctx)).status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it.each([400, 401, 403, 404, 410])("does not retry HTTP %i", async (status) => {
    const { client, ctx, calls, httpSpans } = setup((url) => responseAt(url, "nope", { status }));
    const res = await client.send({ url: URL_A }, ctx);
    expect(res.status).toBe(status);
    expect(calls).toHaveLength(1);
    expect(httpSpans()[0].status).toBe(SpanStatus.Ok);
  });

  it("retries a network TypeError, then succeeds", async () => {
    const { client, ctx, calls, httpSpans } = setup((url, n) => {
      if (n === 1) throw new TypeError("fetch failed");
      return responseAt(url, "ok");
    });
    expect((await client.send({ url: URL_A }, ctx)).text).toBe("ok");
    expect(calls).toHaveLength(2);
    const [first, second] = httpSpans();
    expect(first.status).toBe(SpanStatus.Error);
    expect(first.events.map((e) => e.name)).toContain("exception");
    expect(second.attributes[Attr.HttpResendCount]).toBe(1);
  });

  it("gives up on network errors after the retries as upstream_failed", async () => {
    const { client, ctx, calls } = setup(() => {
      throw new TypeError("fetch failed");
    });
    const err = await failure(client.send({ url: URL_A }, ctx));
    expect(err.code).toBe(ErrorCode.UpstreamFailed);
    expect(err.message).toBe("fetch failed");
    expect(calls).toHaveLength(FAST.retries + 1);
  });

  it("does not retry when the next delay would pass deadlineAt", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const policy: RetryPolicy = { retries: 3, baseDelayMs: 1_000, maxDelayMs: 1_000 };

    const status = setup((url) => responseAt(url, "busy", { status: 503 }), policy, { deadlineAt: Date.now() + 50 });
    expect((await status.client.send({ url: URL_A }, status.ctx)).status).toBe(503);
    expect(status.calls).toHaveLength(1);

    const network = setup(
      () => {
        throw new TypeError("fetch failed");
      },
      policy,
      { deadlineAt: Date.now() + 50 },
    );
    expect((await failure(network.client.send({ url: URL_A }, network.ctx))).code).toBe(ErrorCode.UpstreamFailed);
    expect(network.calls).toHaveLength(1);
  });

  it("maps a timeout signal to a timeout failure without retrying", async () => {
    const { client, ctx, calls, httpSpans } = setup(hang, FAST, { signal: AbortSignal.timeout(5) });
    const err = await failure(client.send({ url: URL_A }, ctx));
    expect(err.code).toBe(ErrorCode.Timeout);
    expect(calls).toHaveLength(1);
    expect(httpSpans()[0].status).toBe(SpanStatus.Error);
  });

  it("maps a caller abort to a timeout failure", async () => {
    const ac = new AbortController();
    const { client, ctx } = setup(hang, FAST, { signal: ac.signal });
    const pending = client.send({ url: URL_A }, ctx);
    ac.abort();
    expect((await failure(pending)).code).toBe(ErrorCode.Timeout);
  });

  it("stops a retry wait when the signal fires", async () => {
    const { client, ctx, calls } = setup((url) => responseAt(url, "x", { status: 503, headers: { "retry-after": "10" } }), {
      retries: 2,
      baseDelayMs: 1,
      maxDelayMs: 10_000,
    }, { signal: AbortSignal.timeout(10), deadlineAt: Date.now() + 60_000 });
    expect((await failure(client.send({ url: URL_A }, ctx))).code).toBe(ErrorCode.Timeout);
    expect(calls).toHaveLength(1);
  });

  it("rejects a body whose content-length exceeds maxBytes", async () => {
    const { client, ctx, calls } = setup((url) => responseAt(url, "x".repeat(500), { headers: { "content-length": "500" } }), FAST, {
      maxBytes: 100,
    });
    const err = await failure(client.send({ url: URL_A }, ctx));
    expect(err.code).toBe(ErrorCode.TooLarge);
    expect(calls).toHaveLength(1);
  });

  it("rejects a streamed body once it grows past maxBytes", async () => {
    let pulled = 0;
    const stream = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled++;
          controller.enqueue(new TextEncoder().encode("y".repeat(40)));
          if (pulled > 50) controller.close();
        },
      });
    const { client, ctx, calls } = setup((url) => responseAt(url, stream()), FAST, { maxBytes: 100 });
    const err = await failure(client.send({ url: URL_A }, ctx));
    expect(err.code).toBe(ErrorCode.TooLarge);
    expect(calls).toHaveLength(1);
    expect(pulled).toBeLessThan(10);
  });

  it("accepts a body exactly at maxBytes", async () => {
    const { client, ctx } = setup((url) => responseAt(url, "z".repeat(100)), FAST, { maxBytes: 100 });
    expect((await client.send({ url: URL_A }, ctx)).text).toHaveLength(100);
  });
});

describe("HttpClient.json", () => {
  const Schema = z.object({ data: z.object({ id: z.string() }) });

  it("parses and validates a JSON body", async () => {
    const { client, ctx } = setup((url) => responseAt(url, JSON.stringify({ data: { id: "x1" }, extra: true })));
    const { data, response } = await client.json({ url: URL_A }, Schema, ctx);
    expect(data).toEqual({ data: { id: "x1" } });
    expect(response.status).toBe(200);
  });

  it("rejects a non-JSON success body as bad_response", async () => {
    const { client, ctx } = setup((url) => responseAt(url, "<html>oops</html>", { status: 200 }));
    const err = await failure(client.json({ url: URL_A }, Schema, ctx));
    expect(err.code).toBe(ErrorCode.BadResponse);
    expect(err.status).toBe(200);
    expect(err.message).toMatch(/non-JSON/);
  });

  // Regression: an HTML error page from a proxy is an upstream failure, not a
  // malformed response (it used to surface as bad_response).
  it("maps a non-JSON HTTP error body to upstream_failed", async () => {
    const { client, ctx } = setup((url) => responseAt(url, "<html>oops</html>", { status: 502 }));
    const err = await failure(client.json({ url: URL_A }, Schema, ctx));
    expect(err.code).toBe(ErrorCode.UpstreamFailed);
    expect(err.status).toBe(502);
  });

  it("rejects a wrongly shaped body as bad_response naming the field", async () => {
    const { client, ctx } = setup((url) => responseAt(url, JSON.stringify({ data: { id: 42 } })));
    const err = await failure(client.json({ url: URL_A }, Schema, ctx));
    expect(err.code).toBe(ErrorCode.BadResponse);
    expect(err.message).toContain("data.id");
  });

  it("names the body when the top-level value has the wrong type", async () => {
    const { client, ctx } = setup((url) => responseAt(url, "[1,2]"));
    const err = await failure(client.json({ url: URL_A }, Schema, ctx));
    expect(err.message).toContain("body:");
  });
});
