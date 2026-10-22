/** `mcpy/telemetry`: OpenTelemetry-shaped instrumentation and its sinks. */

export { Telemetry, parseTraceparent, newSpanId, newTraceId } from "./telemetry.js";
export { Attr, type AttrKey } from "./attributes.js";
export type { AttributeValue, Attributes, FinishedSpan, LogRecord, Span, SpanContext, SpanEvent, TelemetrySink } from "./types.js";
export { ConsoleSink, type ConsoleSinkOptions } from "./sinks/console.js";
export { OtlpSink, toOtlpLog, toOtlpSpan, type OtlpSinkOptions } from "./sinks/otlp.js";
export { AnalyticsEngineSink, type AnalyticsDatasetLike } from "./sinks/analytics.js";
export { OpenTelemetryBridgeSink, type OtelTracerLike } from "./sinks/otel-bridge.js";
export { MemorySink } from "./sinks/memory.js";
