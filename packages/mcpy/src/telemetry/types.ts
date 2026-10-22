/**
 * Telemetry model, shaped after OpenTelemetry so records map 1:1 onto OTLP:
 * spans (with trace/span ids and parent links) and log records, carrying
 * attributes that use OTel semantic-convention names where one exists.
 */

import type { LogLevel, SpanName, SpanStatus } from "../enums.js";

export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue>;

/** W3C trace context of a span: enough to parent a child span. */
export interface SpanContext {
  traceId: string; // 32 hex chars
  spanId: string; // 16 hex chars
}

export interface SpanEvent {
  name: string;
  timeMs: number;
  attributes: Attributes;
}

export interface FinishedSpan extends SpanContext {
  parentSpanId?: string;
  name: SpanName;
  startTimeMs: number;
  endTimeMs: number;
  attributes: Attributes;
  status: SpanStatus;
  statusMessage?: string;
  events: SpanEvent[];
}

export interface LogRecord {
  timeMs: number;
  level: LogLevel;
  message: string;
  attributes: Attributes;
  traceId?: string;
  spanId?: string;
}

/** Destination for finished records (console, OTLP, Analytics Engine, ...). */
export interface TelemetrySink {
  onSpan?(span: FinishedSpan): void;
  onLog?(record: LogRecord): void;
  /** Push buffered records out; call after the response (e.g. ctx.waitUntil). */
  flush?(): Promise<void>;
}

/** A live span. `end` is idempotent. */
export interface Span {
  readonly context: SpanContext;
  setAttributes(attributes: Attributes): void;
  addEvent(name: string, attributes?: Attributes): void;
  recordError(error: unknown): void;
  end(status?: SpanStatus, message?: string): void;
}
