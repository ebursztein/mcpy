import { AnalyticsEngineSink, Attr, ConsoleSink, OtlpSink, Telemetry, type TelemetrySink } from "mcpy/telemetry";
import type { Env, ServerEnv } from "./env.js";

export const SERVICE_VERSION = "0.1.0";

/**
 * Sinks for one request:
 * - ConsoleSink: structured JSON logs -> Workers Logs (always)
 * - AnalyticsEngineSink: per-operation/attempt metrics (when bound)
 * - OtlpSink: traces + logs to any OTLP collector (when configured)
 * Built per request because the OTLP sink buffers until flush.
 */
export function requestTelemetry(env: Env, config: ServerEnv): Telemetry {
  const sinks: TelemetrySink[] = [new ConsoleSink()];
  if (env.TELEMETRY) sinks.push(new AnalyticsEngineSink(env.TELEMETRY));
  if (config.OTEL_EXPORTER_OTLP_ENDPOINT) {
    sinks.push(
      new OtlpSink({
        endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
        headers: config.OTEL_EXPORTER_OTLP_HEADERS,
        resource: {
          [Attr.ServiceName]: config.OTEL_SERVICE_NAME,
          [Attr.ServiceVersion]: SERVICE_VERSION,
          "deployment.environment.name": config.DEPLOYMENT_ENV,
          "cloud.provider": "cloudflare",
          "cloud.platform": "cloudflare_workers",
        },
      }),
    );
  }
  return new Telemetry(sinks, {}, config.LOG_LEVEL);
}
