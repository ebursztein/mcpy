import { describe, expect, it } from "vitest";
import { LogLevel, SpanName, SpanStatus } from "mcpy";
import { Attr, MemorySink, newSpanId, newTraceId, parseTraceparent, Telemetry, type TelemetrySink } from "mcpy/telemetry";

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;

function setup(minLevel: LogLevel = LogLevel.Debug) {
  const sink = new MemorySink();
  return { sink, telemetry: new Telemetry([sink], {}, minLevel) };
}

describe("ids", () => {
  it("makes 32/16 lowercase hex trace and span ids that differ per call", () => {
    expect(newTraceId()).toMatch(HEX32);
    expect(newSpanId()).toMatch(HEX16);
    expect(newTraceId()).not.toBe(newTraceId());
  });
});

describe("parseTraceparent", () => {
  const trace = "4bf92f3577b34da6a3ce929d0e0e4736";
  const span = "00f067aa0ba902b7";

  it("parses a valid W3C header (trimmed)", () => {
    expect(parseTraceparent(`00-${trace}-${span}-01`)).toEqual({ traceId: trace, spanId: span });
    expect(parseTraceparent(`  00-${trace}-${span}-00 `)).toEqual({ traceId: trace, spanId: span });
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["unknown version", `01-${trace}-${span}-01`],
    ["short trace id", `00-${trace.slice(1)}-${span}-01`],
    ["uppercase", `00-${trace.toUpperCase()}-${span}-01`],
    ["missing flags", `00-${trace}-${span}`],
    ["garbage", "not a traceparent"],
    ["all-zero trace id", `00-${"0".repeat(32)}-${span}-01`],
    ["all-zero span id", `00-${trace}-${"0".repeat(16)}-01`],
  ])("rejects %s", (_name, header) => {
    expect(parseTraceparent(header)).toBeUndefined();
  });
});

describe("spans", () => {
  it("emits a finished span with ids, times, attributes and status", () => {
    const { sink, telemetry } = setup();
    const span = telemetry.startSpan(SpanName.Operation, { a: 1 });
    span.setAttributes({ b: "two", a: 3 });
    span.end(SpanStatus.Ok);
    expect(sink.spans).toHaveLength(1);
    const s = sink.spans[0];
    expect(s.traceId).toMatch(HEX32);
    expect(s.spanId).toMatch(HEX16);
    expect(s.parentSpanId).toBeUndefined();
    expect(s).toMatchObject({ name: SpanName.Operation, status: SpanStatus.Ok, attributes: { a: 3, b: "two" }, events: [] });
    expect(s.endTimeMs).toBeGreaterThanOrEqual(s.startTimeMs);
    expect(span.context).toEqual({ traceId: s.traceId, spanId: s.spanId });
  });

  it("children share the trace id and point at their parent", () => {
    const { sink, telemetry } = setup();
    const root = telemetry.startSpan(SpanName.Request);
    const child = telemetry.startSpan(SpanName.Operation, {}, root.context);
    const grandchild = telemetry.startSpan(SpanName.Attempt, {}, child.context);
    grandchild.end();
    child.end();
    root.end();
    const [g, c, r] = sink.spans;
    expect(new Set([g.traceId, c.traceId, r.traceId]).size).toBe(1);
    expect(c.parentSpanId).toBe(r.spanId);
    expect(g.parentSpanId).toBe(c.spanId);
    expect(new Set([g.spanId, c.spanId, r.spanId]).size).toBe(3);
  });

  it("continues a remote trace from a traceparent", () => {
    const { sink, telemetry } = setup();
    const parent = parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
    telemetry.startSpan(SpanName.Request, {}, parent).end();
    expect(sink.spans[0]).toMatchObject({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736", parentSpanId: "00f067aa0ba902b7" });
  });

  it("end() is idempotent: the first status wins and only one record is emitted", () => {
    const { sink, telemetry } = setup();
    const span = telemetry.startSpan(SpanName.Attempt);
    span.end(SpanStatus.Error, "first");
    span.end(SpanStatus.Ok);
    expect(sink.spans).toHaveLength(1);
    expect(sink.spans[0]).toMatchObject({ status: SpanStatus.Error, statusMessage: "first" });
  });

  // Regression (fixed): telemetry.ts:66-75 (LiveSpan.end) emits `this.attributes` and `this.events` by reference, so a
  // setAttributes/addEvent/recordError after end() mutates the record a sink already holds (e.g. buffered
  // in OtlpSink until flush). Fix: emit copies ({ ...this.attributes }, [...this.events]) or ignore writes after end.
  it("a finished span record is not changed by writes after end()", () => {
    const { sink, telemetry } = setup();
    const span = telemetry.startSpan(SpanName.Attempt);
    span.end(SpanStatus.Ok);
    span.setAttributes({ late: true });
    span.addEvent("late");
    expect(sink.spans[0].attributes).not.toHaveProperty("late");
    expect(sink.spans[0].events).toEqual([]);
  });

  it("defaults the status to unset", () => {
    const { sink, telemetry } = setup();
    telemetry.startSpan(SpanName.HttpClient).end();
    expect(sink.spans[0].status).toBe(SpanStatus.Unset);
  });

  it("recordError adds an exception event and error.type (code when present, else name)", () => {
    const { sink, telemetry } = setup();
    const span = telemetry.startSpan(SpanName.Attempt);
    span.recordError(Object.assign(new Error("boom"), { code: "upstream_failed" }));
    span.recordError(new RangeError("x".repeat(600)));
    span.recordError("plain string");
    span.end();
    const [e1, e2, e3] = sink.spans[0].events;
    expect(e1).toMatchObject({ name: "exception", attributes: { [Attr.ErrorType]: "upstream_failed", "exception.message": "boom" } });
    expect(e2.attributes[Attr.ErrorType]).toBe("RangeError");
    expect(String(e2.attributes["exception.message"])).toHaveLength(500);
    expect(e3.attributes).toEqual({ [Attr.ErrorType]: "unknown", "exception.message": "plain string" });
    expect(sink.spans[0].attributes[Attr.ErrorType]).toBe("unknown");
  });

  it("addEvent records name, time and attributes", () => {
    const { sink, telemetry } = setup();
    const span = telemetry.startSpan(SpanName.Operation);
    span.addEvent("cache.miss", { key: "k" });
    span.addEvent("bare");
    span.end();
    expect(sink.spans[0].events.map((e) => [e.name, e.attributes])).toEqual([
      ["cache.miss", { key: "k" }],
      ["bare", {}],
    ]);
    expect(sink.spans[0].events[0].timeMs).toBeTypeOf("number");
  });
});

describe("span() helper", () => {
  it("ends with ok and returns the result", async () => {
    const { sink, telemetry } = setup();
    const out = await telemetry.span(SpanName.Operation, { x: 1 }, undefined, async (span) => {
      span.setAttributes({ y: 2 });
      return 42;
    });
    expect(out).toBe(42);
    expect(sink.spans[0]).toMatchObject({ status: SpanStatus.Ok, attributes: { x: 1, y: 2 } });
  });

  it("records the exception, ends with error and rethrows the same error", async () => {
    const { sink, telemetry } = setup();
    const err = new Error("kaput");
    await expect(telemetry.span(SpanName.Attempt, {}, undefined, async () => Promise.reject(err))).rejects.toBe(err);
    expect(sink.spans[0]).toMatchObject({ status: SpanStatus.Error, statusMessage: "kaput" });
    expect(sink.spans[0].events[0]).toMatchObject({ name: "exception", attributes: { "exception.message": "kaput" } });
  });

  it("parents the span when given a context", async () => {
    const { sink, telemetry } = setup();
    const root = telemetry.startSpan(SpanName.Request);
    await telemetry.span(SpanName.Operation, {}, root.context, async () => undefined);
    expect(sink.spans[0]).toMatchObject({ traceId: root.context.traceId, parentSpanId: root.context.spanId });
  });
});

describe("scoping with with()", () => {
  it("merges scope into spans and logs; call attributes override scope", () => {
    const { sink, telemetry } = setup();
    const scoped = telemetry.with({ [Attr.ClientName]: "alice", shared: "scope" }).with({ [Attr.RequestId]: "r-1" });
    scoped.startSpan(SpanName.Operation, { shared: "call" }).end();
    scoped.log(LogLevel.Info, "hello", { extra: 1 });
    expect(sink.spans[0].attributes).toEqual({ [Attr.ClientName]: "alice", [Attr.RequestId]: "r-1", shared: "call" });
    expect(sink.logs[0].attributes).toEqual({ [Attr.ClientName]: "alice", [Attr.RequestId]: "r-1", shared: "scope", extra: 1 });
  });

  it("is immutable: the original has no scope", () => {
    const { sink, telemetry } = setup();
    telemetry.with({ a: 1 });
    telemetry.log(LogLevel.Info, "plain");
    expect(sink.logs[0].attributes).toEqual({});
  });

  it("keeps sinks and minLevel", () => {
    const { sink, telemetry } = setup(LogLevel.Warn);
    const scoped = telemetry.with({ a: 1 });
    scoped.log(LogLevel.Info, "dropped");
    scoped.log(LogLevel.Warn, "kept");
    expect(sink.logs.map((l) => l.message)).toEqual(["kept"]);
  });
});

describe("logs", () => {
  it("carries level, message, time and the span's trace context", () => {
    const { sink, telemetry } = setup();
    const span = telemetry.startSpan(SpanName.Operation);
    telemetry.log(LogLevel.Error, "failed", { why: "x" }, span.context);
    expect(sink.logs[0]).toMatchObject({ level: LogLevel.Error, message: "failed", traceId: span.context.traceId, spanId: span.context.spanId });
    expect(sink.logs[0].timeMs).toBeTypeOf("number");
  });

  it.each([
    [LogLevel.Debug, [LogLevel.Debug, LogLevel.Info, LogLevel.Warn, LogLevel.Error]],
    [LogLevel.Info, [LogLevel.Info, LogLevel.Warn, LogLevel.Error]],
    [LogLevel.Warn, [LogLevel.Warn, LogLevel.Error]],
    [LogLevel.Error, [LogLevel.Error]],
  ])("minLevel %s keeps %j", (min, kept) => {
    const { sink, telemetry } = setup(min);
    for (const level of [LogLevel.Debug, LogLevel.Info, LogLevel.Warn, LogLevel.Error]) telemetry.log(level, level);
    expect(sink.logs.map((l) => l.level)).toEqual(kept);
  });

  it("defaults minLevel to info", () => {
    const sink = new MemorySink();
    const telemetry = new Telemetry([sink]);
    telemetry.log(LogLevel.Debug, "no");
    telemetry.log(LogLevel.Info, "yes");
    expect(sink.logs.map((l) => l.message)).toEqual(["yes"]);
  });
});

describe("sink isolation", () => {
  const throwing: TelemetrySink = {
    onSpan: () => {
      throw new Error("span sink down");
    },
    onLog: () => {
      throw new Error("log sink down");
    },
    flush: () => Promise.reject(new Error("flush down")),
  };

  it("never propagates sink exceptions and still feeds the other sinks", async () => {
    const good = new MemorySink();
    const telemetry = new Telemetry([throwing, good], {}, LogLevel.Debug);
    expect(() => telemetry.startSpan(SpanName.Operation).end()).not.toThrow();
    expect(() => telemetry.log(LogLevel.Info, "x")).not.toThrow();
    await expect(telemetry.flush()).resolves.toBeUndefined();
    expect(good.spans).toHaveLength(1);
    expect(good.logs).toHaveLength(1);
  });

  it("noop telemetry accepts everything", async () => {
    const t = Telemetry.noop();
    t.startSpan(SpanName.Operation).end();
    t.log(LogLevel.Error, "x");
    await expect(t.flush()).resolves.toBeUndefined();
  });

  it("flush waits for every sink", async () => {
    let flushed = 0;
    const slow: TelemetrySink = { flush: () => new Promise((r) => setTimeout(() => r(void flushed++), 5)) };
    await new Telemetry([slow, slow, {}]).flush();
    expect(flushed).toBe(2);
  });
});
