import { LogLevel, SpanName, SpanStatus } from "../../enums.js";
import type { AttributeValue, Attributes, FinishedSpan, LogRecord, TelemetrySink } from "../types.js";

export interface OtlpSinkOptions {
  /** Collector base URL, e.g. https://otlp.example.com (we append /v1/traces and /v1/logs). */
  endpoint: string;
  /** Extra headers, e.g. { Authorization: "Bearer ..." }. */
  headers?: Record<string, string>;
  /** Resource attributes (service.name, deployment.environment, ...). */
  resource: Attributes;
  /** Records kept between flushes; older ones are dropped beyond this. */
  maxBuffer?: number;
  fetch?: typeof fetch;
}

const SEVERITY: Record<LogLevel, number> = {
  [LogLevel.Debug]: 5,
  [LogLevel.Info]: 9,
  [LogLevel.Warn]: 13,
  [LogLevel.Error]: 17,
};

// OTLP status codes: 0 unset, 1 ok, 2 error.
const STATUS_CODE: Record<SpanStatus, number> = {
  [SpanStatus.Unset]: 0,
  [SpanStatus.Ok]: 1,
  [SpanStatus.Error]: 2,
};

function anyValue(v: AttributeValue) {
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: v };
}

function keyValues(attrs: Attributes) {
  return Object.entries(attrs).map(([key, value]) => ({ key, value: anyValue(value) }));
}

const nanos = (ms: number) => `${BigInt(Math.round(ms)) * 1_000_000n}`;
const SCOPE = { name: "mcpy" };

/**
 * OTLP/HTTP JSON exporter for traces and logs. Buffers records during the
 * request; `flush()` posts them (run it in ctx.waitUntil on Workers).
 * Works with Cloudflare Traces' OTLP destinations and any OTel collector.
 */
export class OtlpSink implements TelemetrySink {
  private spans: FinishedSpan[] = [];
  private logs: LogRecord[] = [];
  private readonly maxBuffer: number;
  private readonly fetchFn: typeof fetch;
  private readonly base: string;

  constructor(private readonly options: OtlpSinkOptions) {
    this.maxBuffer = options.maxBuffer ?? 2_000;
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.base = options.endpoint.replace(/\/$/, "");
  }

  // Past maxBuffer the oldest records go: spans end child-first, so the
  // newest ones include the root request span.
  onSpan(span: FinishedSpan): void {
    this.spans.push(span);
    if (this.spans.length > this.maxBuffer) this.spans.shift();
  }

  onLog(record: LogRecord): void {
    this.logs.push(record);
    if (this.logs.length > this.maxBuffer) this.logs.shift();
  }

  async flush(): Promise<void> {
    const spans = this.spans;
    const logs = this.logs;
    this.spans = [];
    this.logs = [];
    const resource = { attributes: keyValues(this.options.resource) };
    await Promise.all([
      spans.length && this.post("/v1/traces", { resourceSpans: [{ resource, scopeSpans: [{ scope: SCOPE, spans: spans.map(toOtlpSpan) }] }] }),
      logs.length && this.post("/v1/logs", { resourceLogs: [{ resource, scopeLogs: [{ scope: SCOPE, logRecords: logs.map(toOtlpLog) }] }] }),
    ]);
  }

  private async post(path: string, body: unknown): Promise<void> {
    try {
      const res = await this.fetchFn(`${this.base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.options.headers },
        body: JSON.stringify(body),
      });
      await res.body?.cancel();
    } catch {
      // Export is best effort; never fail the request over it.
    }
  }
}

export function toOtlpSpan(span: FinishedSpan) {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    name: span.name,
    kind: span.name === SpanName.HttpClient ? 3 : 1, // CLIENT : INTERNAL
    startTimeUnixNano: nanos(span.startTimeMs),
    endTimeUnixNano: nanos(span.endTimeMs),
    attributes: keyValues(span.attributes),
    events: span.events.map((e) => ({ name: e.name, timeUnixNano: nanos(e.timeMs), attributes: keyValues(e.attributes) })),
    status: { code: STATUS_CODE[span.status], ...(span.statusMessage ? { message: span.statusMessage } : {}) },
  };
}

export function toOtlpLog(record: LogRecord) {
  return {
    timeUnixNano: nanos(record.timeMs),
    severityNumber: SEVERITY[record.level],
    severityText: record.level.toUpperCase(),
    body: { stringValue: record.message },
    attributes: keyValues(record.attributes),
    ...(record.traceId ? { traceId: record.traceId } : {}),
    ...(record.spanId ? { spanId: record.spanId } : {}),
  };
}
