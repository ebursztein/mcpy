import { ErrorCode, FetchResultSchema, GrepResultSchema, RestRoute, SpanName, ToolName } from "mcpy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mentionsProvider } from "../../../../packages/mcpy/test/helpers.js";
import {
  ARTICLE_TITLE,
  articleUrl,
  INITIALIZE,
  makeCtx,
  makeEnv,
  OTLP_ENDPOINT,
  rpc,
  stubNetwork,
  USER_KEY,
  call,
  type OtlpSpan,
} from "./harness.js";

let net: ReturnType<typeof stubNetwork>;
beforeEach(() => {
  net = stubNetwork();
  vi.spyOn(console, "log").mockImplementation(() => undefined); // keep JSON log lines out of the test output
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type ToolCallResult = { content: { type: string; text: string }[]; structuredContent?: unknown; isError?: boolean };

describe("MCP over /mcp", () => {
  it("initializes, then lists exactly the four tools", async () => {
    const env = makeEnv();
    const init = await rpc("initialize", INITIALIZE, { env });
    expect(init.response.status).toBe(200);
    expect(init.response.headers.get("X-Request-Id")).toBeTruthy();
    expect(init.message.result?.serverInfo).toMatchObject({ name: "mcpy" });

    const { message } = await rpc("tools/list", {}, { env });
    const tools = (message.result?.tools ?? []) as { name: string; inputSchema: unknown; outputSchema?: unknown }[];
    expect(tools.map((t) => t.name).sort()).toEqual([ToolName.Fetch, ToolName.Grep, ToolName.Search, ToolName.Papers].sort());
    for (const tool of tools) {
      expect(tool.outputSchema).toBeTruthy();
      expect(mentionsProvider(tool)).toBe(false);
    }
  });

  it("tools/call web_fetch returns structuredContent and a readable text", async () => {
    const url = articleUrl("mcp");
    const { message } = await rpc("tools/call", { name: ToolName.Fetch, arguments: { url, max_chars: 500 } });
    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    const structured = FetchResultSchema.parse(result.structuredContent);
    expect(structured.title).toBe(ARTICLE_TITLE);
    expect(structured.content.length).toBeLessThanOrEqual(500);
    expect(result.content[0].text).toContain(`Title: ${ARTICLE_TITLE}`);
    expect(mentionsProvider(result)).toBe(false);
  });

  it("tools/call web_grep returns matches", async () => {
    const { message } = await rpc("tools/call", { name: ToolName.Grep, arguments: { url: articleUrl("mcpgrep"), pattern: "salt" } });
    const result = message.result as ToolCallResult;
    expect(GrepResultSchema.parse(result.structuredContent).matches).toBeGreaterThan(0);
  });

  it("reports tool failures as isError results with an ErrorBody", async () => {
    const { message } = await rpc("tools/call", { name: ToolName.Search, arguments: { query: "gardens" } });
    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ error: { code: ErrorCode.NoProviders } });
  });

  it("rejects unauthenticated MCP calls with 401", async () => {
    const { response, message } = await rpc("tools/list", {}, { key: null });
    expect(response.status).toBe(401);
    expect(message).toMatchObject({ error: { code: ErrorCode.Unauthorized } });
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("accepts the key via ?key= on /mcp", async () => {
    const env = makeEnv();
    const response = await call(`/mcp?key=${USER_KEY}`, {
      env,
      key: null,
      headers: { Accept: "application/json, text/event-stream" },
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE },
    });
    expect(response.status).toBe(200);
  });

  it("answers CORS preflight without credentials", async () => {
    const response = await call("/mcp", { method: "OPTIONS", key: null, headers: { "Access-Control-Request-Method": "POST" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("agents SDK contract: rejects browser origins outside the allow-list (DNS-rebinding protection)", async () => {
    const response = await call("/mcp", { method: "OPTIONS", key: null, headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    expect(response.status).toBe(403);
  });
});

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT_SPAN = "00f067aa0ba902b7";
const TRACEPARENT = `00-${TRACE_ID}-${PARENT_SPAN}-01`;

describe("trace propagation", () => {
  function exportedSpans(): OtlpSpan[] {
    return net.otlp
      .filter((p) => p.path === "/v1/traces")
      .flatMap((p) => p.body.resourceSpans ?? [])
      .flatMap((r) => r.scopeSpans.flatMap((s) => s.spans));
  }

  it("parents the request and operation spans on an incoming traceparent (OTLP export)", async () => {
    const env = makeEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20otel" });
    const ctx = makeCtx();
    const response = await call(RestRoute.Fetch, { body: { url: articleUrl("trace") }, env, ctx, headers: { traceparent: TRACEPARENT } });
    expect(response.status).toBe(200);
    expect(ctx.pending.length).toBeGreaterThan(0);

    const spans = exportedSpans();
    const request = spans.find((s) => s.name === SpanName.Request);
    const operation = spans.find((s) => s.name === SpanName.Operation);
    expect(request).toBeDefined();
    expect(operation).toBeDefined();
    expect(request?.traceId).toBe(TRACE_ID);
    expect(request?.parentSpanId).toBe(PARENT_SPAN);
    expect(operation?.traceId).toBe(TRACE_ID);
    expect(operation?.parentSpanId).toBe(request?.spanId);
    for (const span of spans) expect(span.traceId, span.name).toBe(TRACE_ID);
    expect(spans.map((s) => s.name)).toEqual(expect.arrayContaining([SpanName.Attempt, SpanName.HttpClient]));

    const otlpCall = net.fetchStub.mock.calls.find(([u]) => String(u).startsWith(OTLP_ENDPOINT));
    expect(new Headers(otlpCall?.[1]?.headers).get("Authorization")).toBe("Bearer otel");
  });

  it("starts a fresh trace for a malformed traceparent", async () => {
    const env = makeEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT });
    await call(RestRoute.Fetch, { body: { url: articleUrl("badtrace") }, env, headers: { traceparent: "00-zzz-yyy-01" } });
    const request = exportedSpans().find((s) => s.name === SpanName.Request);
    expect(request?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(request?.parentSpanId).toBeUndefined();
  });

  // Regression (fixed): apps/server/src/index.ts:47-52 (finish) flushes telemetry via
  // ctx.waitUntil(base.flush()) as soon as the handler returns. For MCP the
  // response is an SSE stream and the tool runs while the body is read, i.e.
  // after the flush: the operation/attempt/http.client spans and the
  // "fetch ok" log land in the OtlpSink buffer and are never exported, and
  // the mcpy.request span ends before the work it covers. Repro: tools/call
  // web_fetch with OTEL_EXPORTER_OTLP_ENDPOINT set -> /v1/traces carries only
  // mcpy.request. Fix: flush (and end the request span) when the streamed
  // body completes, e.g. pipe it through a TransformStream whose flush()
  // ends the span and whose completion promise goes to ctx.waitUntil.
  it("exports MCP tool-call spans under the incoming trace", async () => {
    const env = makeEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT });
    await rpc("tools/call", { name: ToolName.Fetch, arguments: { url: articleUrl("mcptrace") } }, { env, headers: { traceparent: TRACEPARENT } });
    const operation = exportedSpans().find((s) => s.name === SpanName.Operation);
    expect(operation?.traceId).toBe(TRACE_ID);
  });

  it("writes Analytics Engine rows tagged with client and request id", async () => {
    const rows: { indexes?: string[]; blobs?: string[]; doubles?: number[] }[] = [];
    const env = makeEnv({ TELEMETRY: { writeDataPoint: (row: (typeof rows)[number]) => void rows.push(row) } });
    const response = await call(RestRoute.Fetch, { body: { url: articleUrl("ae") }, env, headers: { "cf-ray": "ray-ae-1" } });
    const operation = rows.find((r) => r.blobs?.[0] === SpanName.Operation);
    const attempt = rows.find((r) => r.blobs?.[0] === SpanName.Attempt);
    expect(operation?.indexes).toEqual(["alice"]);
    expect(operation?.blobs?.[8]).toBe(response.headers.get("X-Request-Id"));
    expect(attempt?.blobs?.[6]).toBe("alice");
  });
});
