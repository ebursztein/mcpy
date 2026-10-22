import { SpanName } from "../../enums.js";
import { Attr } from "../attributes.js";
import type { Attributes, FinishedSpan, TelemetrySink } from "../types.js";

/** The subset of a Workers Analytics Engine dataset this sink needs. */
export interface AnalyticsDatasetLike {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

const str = (a: Attributes, k: string) => (a[k] === undefined ? "" : String(a[k]));
const num = (a: Attributes, k: string) => (typeof a[k] === "number" ? (a[k] as number) : 0);

/**
 * One Analytics Engine data point per operation and per provider attempt,
 * for cheap SQL metrics (cost, latency, cache hit rate, per client).
 *
 * Column layout (keep stable; queries depend on it):
 *   index1  client.name
 *   blob1   span name (mcpy.operation | mcpy.attempt)
 *   blob2   operation      blob3 provider     blob4 outcome
 *   blob5   target host    blob6 reason       blob7 client.name
 *   blob8   cache status   blob9 request id
 *   double1 duration ms    double2 content chars   double3 cost USD
 *   double4 target status  double5 attempts
 */
export class AnalyticsEngineSink implements TelemetrySink {
  constructor(private readonly dataset: AnalyticsDatasetLike) {}

  onSpan(span: FinishedSpan): void {
    if (span.name !== SpanName.Operation && span.name !== SpanName.Attempt) return;
    const a = span.attributes;
    this.dataset.writeDataPoint({
      indexes: [str(a, Attr.ClientName)],
      blobs: [
        span.name,
        str(a, Attr.Operation),
        str(a, Attr.Provider),
        str(a, Attr.Outcome),
        str(a, Attr.TargetHost),
        str(a, Attr.Reason).slice(0, 200),
        str(a, Attr.ClientName),
        str(a, Attr.Cache),
        str(a, Attr.RequestId),
      ],
      doubles: [
        span.endTimeMs - span.startTimeMs,
        num(a, Attr.ContentChars),
        num(a, Attr.CostUsd),
        num(a, Attr.TargetStatus),
        num(a, Attr.Attempts),
      ],
    });
  }
}
