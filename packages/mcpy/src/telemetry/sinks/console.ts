import type { FinishedSpan, LogRecord, TelemetrySink } from "../types.js";

export interface ConsoleSinkOptions {
  /** Also print one line per finished span (noisy; useful locally). */
  spans?: boolean;
  /** Where lines go; defaults to console.log. */
  write?: (line: string) => void;
}

/**
 * Structured JSON lines, one per log record (and optionally per span).
 * Cloudflare Workers Logs indexes these fields, so they are queryable.
 */
export class ConsoleSink implements TelemetrySink {
  private readonly write: (line: string) => void;

  constructor(private readonly options: ConsoleSinkOptions = {}) {
    this.write = options.write ?? ((line) => console.log(line));
  }

  onLog(record: LogRecord): void {
    this.write(
      // Attributes first so they can never overwrite the base fields.
      JSON.stringify({
        ...record.attributes,
        time: new Date(record.timeMs).toISOString(),
        level: record.level,
        message: record.message,
        trace_id: record.traceId,
        span_id: record.spanId,
      }),
    );
  }

  onSpan(span: FinishedSpan): void {
    if (!this.options.spans) return;
    this.write(
      JSON.stringify({
        time: new Date(span.endTimeMs).toISOString(),
        level: "debug",
        message: `span ${span.name}`,
        trace_id: span.traceId,
        span_id: span.spanId,
        parent_span_id: span.parentSpanId,
        duration_ms: span.endTimeMs - span.startTimeMs,
        status: span.status,
        ...span.attributes,
      }),
    );
  }
}
