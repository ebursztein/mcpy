import { LogLevel, SpanStatus, type SpanName } from "../enums.js";
import { Attr } from "./attributes.js";
import type { Attributes, FinishedSpan, LogRecord, Span, SpanContext, SpanEvent, TelemetrySink } from "./types.js";

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const newTraceId = () => randomHex(16);
export const newSpanId = () => randomHex(8);

/** Parse a W3C `traceparent` header into a parent span context. */
export function parseTraceparent(header: string | null): SpanContext | undefined {
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(header?.trim() ?? "");
  if (!m || /^0+$/.test(m[1]) || /^0+$/.test(m[2])) return undefined;
  return { traceId: m[1], spanId: m[2] };
}

function errorAttributes(error: unknown): Attributes {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return { [Attr.ErrorType]: typeof code === "string" ? code : error.name, "exception.message": error.message.slice(0, 500) };
  }
  return { [Attr.ErrorType]: "unknown", "exception.message": String(error).slice(0, 500) };
}

class LiveSpan implements Span {
  readonly context: SpanContext;
  private readonly attributes: Attributes;
  private readonly events: SpanEvent[] = [];
  private readonly startTimeMs = Date.now();
  private ended = false;

  constructor(
    private readonly name: SpanName,
    attributes: Attributes,
    private readonly parent: SpanContext | undefined,
    private readonly emit: (span: FinishedSpan) => void,
  ) {
    this.context = { traceId: parent?.traceId ?? newTraceId(), spanId: newSpanId() };
    this.attributes = { ...attributes };
  }

  // Writes after end() are ignored: the finished record belongs to the sinks.
  setAttributes(attributes: Attributes): void {
    if (!this.ended) Object.assign(this.attributes, attributes);
  }

  addEvent(name: string, attributes: Attributes = {}): void {
    if (!this.ended) this.events.push({ name, timeMs: Date.now(), attributes: { ...attributes } });
  }

  recordError(error: unknown): void {
    this.addEvent("exception", errorAttributes(error));
    this.setAttributes({ [Attr.ErrorType]: errorAttributes(error)[Attr.ErrorType] });
  }

  end(status: SpanStatus = SpanStatus.Unset, message?: string): void {
    if (this.ended) return;
    this.ended = true;
    this.emit({
      ...this.context,
      parentSpanId: this.parent?.spanId,
      name: this.name,
      startTimeMs: this.startTimeMs,
      endTimeMs: Date.now(),
      attributes: { ...this.attributes },
      status,
      statusMessage: message,
      events: [...this.events],
    });
  }
}

/**
 * Entry point for instrumentation. Immutable: `with()` returns a scoped copy
 * whose attributes (client name, request id, ...) land on every span and log
 * record it produces, so each key's client name shows up everywhere.
 */
export class Telemetry {
  constructor(
    private readonly sinks: TelemetrySink[] = [],
    private readonly scope: Attributes = {},
    private readonly minLevel: LogLevel = LogLevel.Info,
  ) {}

  static noop(): Telemetry {
    return new Telemetry([]);
  }

  with(attributes: Attributes): Telemetry {
    return new Telemetry(this.sinks, { ...this.scope, ...attributes }, this.minLevel);
  }

  startSpan(name: SpanName, attributes: Attributes = {}, parent?: SpanContext): Span {
    return new LiveSpan(name, { ...this.scope, ...attributes }, parent, (span) => {
      for (const sink of this.sinks) safely(() => sink.onSpan?.(span));
    });
  }

  /** Run `fn` inside a span; status and errors are recorded automatically. */
  async span<T>(name: SpanName, attributes: Attributes, parent: SpanContext | undefined, fn: (span: Span) => Promise<T>): Promise<T> {
    const span = this.startSpan(name, attributes, parent);
    try {
      const result = await fn(span);
      span.end(SpanStatus.Ok);
      return result;
    } catch (err) {
      span.recordError(err);
      span.end(SpanStatus.Error, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  log(level: LogLevel, message: string, attributes: Attributes = {}, span?: SpanContext): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;
    const record: LogRecord = {
      timeMs: Date.now(),
      level,
      message,
      attributes: { ...this.scope, ...attributes },
      traceId: span?.traceId,
      spanId: span?.spanId,
    };
    for (const sink of this.sinks) safely(() => sink.onLog?.(record));
  }

  async flush(): Promise<void> {
    await Promise.all(this.sinks.map((s) => s.flush?.().catch(() => undefined)));
  }
}

const LEVEL_RANK: Record<LogLevel, number> = {
  [LogLevel.Debug]: 0,
  [LogLevel.Info]: 1,
  [LogLevel.Warn]: 2,
  [LogLevel.Error]: 3,
};

/** Telemetry must never break a request. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // ignore sink failures
  }
}
