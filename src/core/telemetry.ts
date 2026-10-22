/**
 * One event per provider attempt and one per tool call. Written to Workers
 * Analytics Engine (queryable with SQL) and to structured logs.
 *
 * Analytics Engine layout (keep stable; dashboards depend on it):
 *   index1  = tool
 *   blob1   = event ("attempt" | "call")
 *   blob2   = tool
 *   blob3   = provider ("cache" for cache hits, "" when none)
 *   blob4   = outcome ("ok" | "final" | "escalate" | "error" | "hit")
 *   blob5   = target host or search query hash
 *   blob6   = reason (short, for failures)
 *   double1 = latency ms
 *   double2 = content chars
 *   double3 = estimated cost USD
 *   double4 = target HTTP status (0 if unknown)
 */

export interface TelemetryEvent {
  event: "attempt" | "call";
  tool: string;
  provider: string;
  outcome: "ok" | "final" | "escalate" | "error" | "hit";
  target: string;
  reason?: string;
  latencyMs: number;
  chars?: number;
  costUsd?: number;
  status?: number;
}

export interface Telemetry {
  record(e: TelemetryEvent): void;
}

export class AnalyticsTelemetry implements Telemetry {
  constructor(private readonly dataset?: AnalyticsEngineDataset) {}

  record(e: TelemetryEvent): void {
    try {
      this.dataset?.writeDataPoint({
        indexes: [e.tool],
        blobs: [e.event, e.tool, e.provider, e.outcome, e.target, (e.reason ?? "").slice(0, 200)],
        doubles: [e.latencyMs, e.chars ?? 0, e.costUsd ?? 0, e.status ?? 0],
      });
    } catch {
      // Telemetry must never fail a request.
    }
    console.log(JSON.stringify({ msg: "telemetry", ...e }));
  }
}

export class MemoryTelemetry implements Telemetry {
  readonly events: TelemetryEvent[] = [];
  record(e: TelemetryEvent): void {
    this.events.push(e);
  }
}
