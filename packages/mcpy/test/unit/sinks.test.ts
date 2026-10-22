import { describe, expect, it } from "vitest";
import { LogLevel, SpanName, SpanStatus } from "mcpy";
import { AnalyticsEngineSink, Attr, ConsoleSink, OpenTelemetryBridgeSink, OtlpSink, Telemetry } from "mcpy/telemetry";
import type { AnalyticsDatasetLike, FinishedSpan, LogRecord, OtelTracerLike } from "mcpy/telemetry";
import { stubFetch } from "../helpers.js";

const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

function span(overrides: Partial<FinishedSpan> = {}): FinishedSpan {
  return {
    traceId: TRACE,
    spanId: "00f067aa0ba902b7",
    parentSpanId: "a3ce929d0e0e4736",
    name: SpanName.HttpClient,
    startTimeMs: T0,
    endTimeMs: T0 + 250,
    attributes: { [Attr.HttpStatus]: 200, [Attr.CostUsd]: 0.0015, [Attr.ServerAddress]: "api.firecrawl.dev", ok: true },
    status: SpanStatus.Ok,
    events: [],
    ...overrides,
  };
}

function log(overrides: Partial<LogRecord> = {}): LogRecord {
  return { timeMs: T0, level: LogLevel.Info, message: "fetch ok", attributes: { [Attr.ClientName]: "alice" }, traceId: TRACE, spanId: "00f067aa0ba902b7", ...overrides };
}

describe("ConsoleSink", () => {
  it("writes one JSON line per log with time, level, message, trace ids and attributes", () => {
    const lines: string[] = [];
    const sink = new ConsoleSink({ write: (l) => lines.push(l) });
    sink.onLog(log());
    sink.onLog(log({ level: LogLevel.Error, message: "second", traceId: undefined, spanId: undefined }));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => !l.includes("\n"))).toBe(true);
    expect(JSON.parse(lines[0])).toEqual({
      time: "2026-10-22T12:00:00.000Z",
      level: LogLevel.Info,
      message: "fetch ok",
      trace_id: TRACE,
      span_id: "00f067aa0ba902b7",
      [Attr.ClientName]: "alice",
    });
    expect(JSON.parse(lines[1])).not.toHaveProperty("trace_id");
  });

  it("ignores spans unless enabled", () => {
    const lines: string[] = [];
    new ConsoleSink({ write: (l) => lines.push(l) }).onSpan(span());
    expect(lines).toEqual([]);
  });

  it("writes span lines with duration, status and parent when enabled", () => {
    const lines: string[] = [];
    new ConsoleSink({ spans: true, write: (l) => lines.push(l) }).onSpan(span());
    expect(JSON.parse(lines[0])).toMatchObject({
      time: "2026-10-22T12:00:00.250Z",
      level: LogLevel.Debug,
      message: `span ${SpanName.HttpClient}`,
      trace_id: TRACE,
      parent_span_id: "a3ce929d0e0e4736",
      duration_ms: 250,
      status: SpanStatus.Ok,
      [Attr.HttpStatus]: 200,
    });
  });

  it("works as a Telemetry sink end to end", () => {
    const lines: string[] = [];
    new Telemetry([new ConsoleSink({ write: (l) => lines.push(l) })]).with({ [Attr.RequestId]: "r-9" }).log(LogLevel.Warn, "slow");
    expect(JSON.parse(lines[0])).toMatchObject({ level: LogLevel.Warn, message: "slow", [Attr.RequestId]: "r-9" });
  });
});

describe("OtlpSink", () => {
  const ok = () => new Response(null, { status: 200 });
  const make = (fetch: typeof globalThis.fetch, maxBuffer?: number) =>
    new OtlpSink({ endpoint: "https://otlp.example.com/", headers: { Authorization: "Bearer otlp-token" }, resource: { [Attr.ServiceName]: "mcpy", [Attr.ServiceVersion]: "0.1.0" }, fetch, maxBuffer });

  it("buffers until flush, then POSTs traces and logs with the configured headers", async () => {
    const { fetch, calls } = stubFetch(ok);
    const sink = make(fetch);
    sink.onSpan(span());
    sink.onLog(log());
    expect(calls).toHaveLength(0);
    await sink.flush();
    expect(calls.map((c) => [c.method, c.url]).sort()).toEqual([
      ["POST", "https://otlp.example.com/v1/logs"],
      ["POST", "https://otlp.example.com/v1/traces"],
    ]);
    for (const c of calls) {
      expect(c.headers.get("authorization")).toBe("Bearer otlp-token");
      expect(c.headers.get("content-type")).toBe("application/json");
    }
  });

  it("emits valid OTLP/JSON spans", async () => {
    const { fetch, calls } = stubFetch(ok);
    const sink = make(fetch);
    sink.onSpan(span({ events: [{ name: "exception", timeMs: T0 + 10, attributes: { [Attr.ErrorType]: "timeout" } }] }));
    sink.onSpan(span({ name: SpanName.Operation, spanId: "1111111111111111", parentSpanId: undefined, status: SpanStatus.Error, statusMessage: "failed", attributes: {} }));
    sink.onSpan(span({ name: SpanName.Attempt, status: SpanStatus.Unset, attributes: {} }));
    await sink.flush();
    const body = calls[0].body as { resourceSpans: { resource: { attributes: unknown[] }; scopeSpans: { scope: { name: string }; spans: Record<string, unknown>[] }[] }[] };
    const rs = body.resourceSpans[0];
    expect(rs.resource.attributes).toEqual([
      { key: Attr.ServiceName, value: { stringValue: "mcpy" } },
      { key: Attr.ServiceVersion, value: { stringValue: "0.1.0" } },
    ]);
    expect(rs.scopeSpans[0].scope.name).toBe("mcpy");
    const [http, op, attempt] = rs.scopeSpans[0].spans;
    expect(http).toMatchObject({
      traceId: TRACE,
      spanId: "00f067aa0ba902b7",
      parentSpanId: "a3ce929d0e0e4736",
      name: SpanName.HttpClient,
      kind: 3,
      startTimeUnixNano: `${T0}000000`,
      endTimeUnixNano: `${T0 + 250}000000`,
      status: { code: 1 },
    });
    expect(typeof http.startTimeUnixNano).toBe("string");
    expect(http.attributes).toEqual([
      { key: Attr.HttpStatus, value: { intValue: "200" } },
      { key: Attr.CostUsd, value: { doubleValue: 0.0015 } },
      { key: Attr.ServerAddress, value: { stringValue: "api.firecrawl.dev" } },
      { key: "ok", value: { boolValue: true } },
    ]);
    expect(http.events).toEqual([{ name: "exception", timeUnixNano: `${T0 + 10}000000`, attributes: [{ key: Attr.ErrorType, value: { stringValue: "timeout" } }] }]);
    expect(op).toMatchObject({ kind: 1, status: { code: 2, message: "failed" } });
    expect(op).not.toHaveProperty("parentSpanId");
    expect(attempt).toMatchObject({ kind: 1, status: { code: 0 } });
  });

  it("emits valid OTLP/JSON log records with severity numbers", async () => {
    const { fetch, calls } = stubFetch(ok);
    const sink = make(fetch);
    sink.onLog(log());
    sink.onLog(log({ level: LogLevel.Error, message: "boom", traceId: undefined, spanId: undefined }));
    sink.onLog(log({ level: LogLevel.Warn }));
    sink.onLog(log({ level: LogLevel.Debug }));
    await sink.flush();
    const body = calls[0].body as { resourceLogs: { resource: { attributes: unknown[] }; scopeLogs: { logRecords: Record<string, unknown>[] }[] }[] };
    expect(body.resourceLogs[0].resource.attributes).toContainEqual({ key: Attr.ServiceName, value: { stringValue: "mcpy" } });
    const [info, error, warn, debug] = body.resourceLogs[0].scopeLogs[0].logRecords;
    expect(info).toEqual({
      timeUnixNano: `${T0}000000`,
      severityNumber: 9,
      severityText: "INFO",
      body: { stringValue: "fetch ok" },
      attributes: [{ key: Attr.ClientName, value: { stringValue: "alice" } }],
      traceId: TRACE,
      spanId: "00f067aa0ba902b7",
    });
    expect(error).toMatchObject({ severityNumber: 17, severityText: "ERROR" });
    expect(error).not.toHaveProperty("traceId");
    expect([warn.severityNumber, debug.severityNumber]).toEqual([13, 5]);
  });

  it("sends nothing when nothing is buffered, and only what is buffered", async () => {
    const { fetch, calls } = stubFetch(ok);
    const sink = make(fetch);
    await sink.flush();
    expect(calls).toHaveLength(0);
    sink.onLog(log());
    await sink.flush();
    expect(calls.map((c) => c.url)).toEqual(["https://otlp.example.com/v1/logs"]);
    await sink.flush();
    expect(calls).toHaveLength(1);
  });

  it("swallows export failures and drops the batch", async () => {
    const { fetch, calls } = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const sink = make(fetch);
    sink.onSpan(span());
    await expect(sink.flush()).resolves.toBeUndefined();
    await sink.flush();
    expect(calls).toHaveLength(1);
    const rejecting = make(stubFetch(() => new Response("bad", { status: 500 })).fetch);
    rejecting.onLog(log());
    await expect(rejecting.flush()).resolves.toBeUndefined();
  });

  it("caps each buffer at maxBuffer", async () => {
    const { fetch, calls } = stubFetch(ok);
    const sink = make(fetch, 2);
    for (let i = 0; i < 5; i++) sink.onSpan(span({ spanId: `000000000000000${i}` }));
    for (let i = 0; i < 3; i++) sink.onLog(log());
    await sink.flush();
    const traces = calls.find((c) => c.url.endsWith("/v1/traces"))?.body as { resourceSpans: { scopeSpans: { spans: unknown[] }[] }[] };
    const logs = calls.find((c) => c.url.endsWith("/v1/logs"))?.body as { resourceLogs: { scopeLogs: { logRecords: unknown[] }[] }[] };
    expect(traces.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
    expect(logs.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2);
  });

  // Regression (fixed): otlp.ts:12 documents "older ones are dropped beyond this", but onSpan/onLog (otlp.ts:61-67) drop the
  // NEWEST records once full. Spans end child-first, so the root mcpy.request span is the one lost. Fix: shift()
  // the oldest before pushing (or correct the doc if keeping the oldest is intended).
  it("keeps the newest records when over maxBuffer, as documented", async () => {
    const { fetch, calls } = stubFetch(ok);
    const sink = make(fetch, 2);
    for (let i = 0; i < 5; i++) sink.onSpan(span({ spanId: `000000000000000${i}` }));
    await sink.flush();
    const spans = (calls[0].body as { resourceSpans: { scopeSpans: { spans: { spanId: string }[] }[] }[] }).resourceSpans[0].scopeSpans[0].spans;
    expect(spans.map((s) => s.spanId)).toEqual(["0000000000000003", "0000000000000004"]);
  });
});

describe("AnalyticsEngineSink", () => {
  function dataset() {
    const points: Parameters<AnalyticsDatasetLike["writeDataPoint"]>[0][] = [];
    return { points, writeDataPoint: (p: (typeof points)[number]) => void points.push(p) };
  }

  it("writes the documented column layout for an operation span", () => {
    const ds = dataset();
    new AnalyticsEngineSink(ds).onSpan(
      span({
        name: SpanName.Operation,
        attributes: {
          [Attr.ClientName]: "alice", [Attr.Operation]: "fetch", [Attr.Provider]: "firecrawl", [Attr.Outcome]: "ok",
          [Attr.TargetHost]: "example.com", [Attr.Reason]: "r".repeat(300), [Attr.Cache]: "miss", [Attr.RequestId]: "req-1",
          [Attr.ContentChars]: 1234, [Attr.CostUsd]: 0.001, [Attr.TargetStatus]: 200, [Attr.Attempts]: 2,
        },
      }),
    );
    expect(ds.points).toEqual([
      {
        indexes: ["alice"],
        blobs: [SpanName.Operation, "fetch", "firecrawl", "ok", "example.com", "r".repeat(200), "alice", "miss", "req-1"],
        doubles: [250, 1234, 0.001, 200, 2],
      },
    ]);
  });

  it("writes attempt spans with empty strings and zeros for missing attributes", () => {
    const ds = dataset();
    new AnalyticsEngineSink(ds).onSpan(span({ name: SpanName.Attempt, attributes: { [Attr.Provider]: "direct", [Attr.TargetStatus]: "n/a" } }));
    expect(ds.points[0]).toEqual({ indexes: [""], blobs: [SpanName.Attempt, "", "direct", "", "", "", "", "", ""], doubles: [250, 0, 0, 0, 0] });
  });

  it.each([SpanName.HttpClient, SpanName.Request])("ignores %s spans", (name) => {
    const ds = dataset();
    new AnalyticsEngineSink(ds).onSpan(span({ name }));
    expect(ds.points).toEqual([]);
  });
});

describe("OpenTelemetryBridgeSink", () => {
  function tracer() {
    const started: { name: string; options: Parameters<OtelTracerLike["startSpan"]>[1]; status?: unknown; events: unknown[]; endTime?: number }[] = [];
    const t: OtelTracerLike = {
      startSpan(name, options) {
        const rec: (typeof started)[number] = { name, options, events: [] };
        started.push(rec);
        return {
          setStatus: (s) => (rec.status = s),
          addEvent: (n, a, time) => rec.events.push([n, a, time]),
          end: (endTime) => void (rec.endTime = endTime),
        };
      },
    };
    return { t, started };
  }

  it("replays a span with name, start time, attributes, ids, kind, events, status and end time", () => {
    const { t, started } = tracer();
    new OpenTelemetryBridgeSink(t).onSpan(span({ events: [{ name: "exception", timeMs: T0 + 5, attributes: { a: 1 } }] }));
    expect(started).toEqual([
      {
        name: SpanName.HttpClient,
        options: {
          startTime: T0,
          attributes: { ...span().attributes, "mcpy.trace_id": TRACE, "mcpy.span_id": "00f067aa0ba902b7" },
          kind: 2,
        },
        events: [["exception", { a: 1 }, T0 + 5]],
        status: { code: 1, message: undefined },
        endTime: T0 + 250,
      },
    ]);
  });

  it.each([
    [SpanStatus.Ok, 1],
    [SpanStatus.Error, 2],
    [SpanStatus.Unset, 0],
  ])("maps status %s to code %i and internal spans to kind 0", (status, code) => {
    const { t, started } = tracer();
    new OpenTelemetryBridgeSink(t).onSpan(span({ name: SpanName.Operation, status, statusMessage: "m" }));
    expect(started[0].status).toEqual({ code, message: "m" });
    expect(started[0].options?.kind).toBe(0);
  });
});
