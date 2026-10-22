import type { FinishedSpan, LogRecord, TelemetrySink } from "../types.js";

/** Keeps every record in memory. For tests and debugging. */
export class MemorySink implements TelemetrySink {
  readonly spans: FinishedSpan[] = [];
  readonly logs: LogRecord[] = [];

  onSpan(span: FinishedSpan): void {
    this.spans.push(span);
  }

  onLog(record: LogRecord): void {
    this.logs.push(record);
  }

  clear(): void {
    this.spans.length = 0;
    this.logs.length = 0;
  }
}
