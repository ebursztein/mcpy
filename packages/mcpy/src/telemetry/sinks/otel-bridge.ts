import { SpanName, SpanStatus } from "../../enums.js";
import type { Attributes, FinishedSpan, TelemetrySink } from "../types.js";

/**
 * The parts of `@opentelemetry/api` this bridge uses, typed structurally so
 * mcpy has no hard dependency on it. Pass `trace.getTracer("mcpy")`.
 */
export interface OtelTracerLike {
  startSpan(
    name: string,
    options?: { startTime?: number; attributes?: Attributes; kind?: number },
  ): {
    setStatus(status: { code: number; message?: string }): unknown;
    addEvent(name: string, attributes?: Attributes, time?: number): unknown;
    end(endTime?: number): void;
  };
}

/**
 * Replays finished mcpy spans into an existing OpenTelemetry SDK (Node, Bun),
 * so they flow through whatever exporter the host app already configured.
 * Parent links across the bridge are not preserved; attributes carry the
 * request id and client name for correlation.
 */
export class OpenTelemetryBridgeSink implements TelemetrySink {
  constructor(private readonly tracer: OtelTracerLike) {}

  onSpan(span: FinishedSpan): void {
    const otel = this.tracer.startSpan(span.name, {
      startTime: span.startTimeMs,
      attributes: { ...span.attributes, "mcpy.trace_id": span.traceId, "mcpy.span_id": span.spanId },
      kind: span.name === SpanName.HttpClient ? 2 : 0, // api SpanKind: CLIENT=2, INTERNAL=0
    });
    for (const e of span.events) otel.addEvent(e.name, e.attributes, e.timeMs);
    // api SpanStatusCode: UNSET=0, OK=1, ERROR=2
    const code = span.status === SpanStatus.Ok ? 1 : span.status === SpanStatus.Error ? 2 : 0;
    otel.setStatus({ code, message: span.statusMessage });
    otel.end(span.endTimeMs);
  }
}
