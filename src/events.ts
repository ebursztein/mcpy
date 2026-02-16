import type {
  McpEvent,
  SessionInfo,
  AggregateStats,
  ToolStats,
  TimeseriesPoint,
} from "./types.ts";

type Subscriber = (event: McpEvent) => void;

class EventBus {
  private subscribers = new Set<Subscriber>();
  private recentEvents: McpEvent[] = [];
  private maxRecent = 200;

  private timeseries: TimeseriesPoint[] = [];
  private maxTimeseries = 1000;

  private stats: AggregateStats = {
    totalInvocations: 0,
    successCount: 0,
    errorCount: 0,
    tools: {},
  };

  private sessions = new Map<string, SessionInfo>();

  emit(event: McpEvent): void {
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxRecent) {
      this.recentEvents.shift();
    }

    // Update stats
    if (event.type === "tool_result" && event.tool) {
      this.stats.totalInvocations++;
      this.stats.successCount++;
      this.updateToolStats(event, true);
      this.recordTimeseries(event, true);
    } else if (event.type === "tool_error" && event.tool) {
      this.stats.totalInvocations++;
      this.stats.errorCount++;
      this.updateToolStats(event, false);
      this.recordTimeseries(event, false);
    }

    // Update sessions
    if (event.type === "session_connect" && event.sessionId) {
      this.sessions.set(event.sessionId, {
        sessionId: event.sessionId,
        clientName: event.clientName || "Unknown",
        connectedAt: event.timestamp,
      });
    } else if (event.type === "session_disconnect" && event.sessionId) {
      this.sessions.delete(event.sessionId);
    }

    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
        // Don't let a failing subscriber break others
      }
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  getRecentEvents(): McpEvent[] {
    return [...this.recentEvents];
  }

  getStats(): AggregateStats {
    return structuredClone(this.stats);
  }

  getSessions(): SessionInfo[] {
    return [...this.sessions.values()];
  }

  createSSEStream(): { stream: ReadableStream; unsubscribe: () => void } {
    let unsub: (() => void) | null = null;

    const stream = new ReadableStream({
      start: (controller) => {
        // Send recent events as replay
        for (const event of this.recentEvents) {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(new TextEncoder().encode(data));
        }

        unsub = this.subscribe((event) => {
          try {
            const data = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(new TextEncoder().encode(data));
          } catch {
            // Stream closed
          }
        });
      },
      cancel: () => {
        unsub?.();
      },
    });

    return {
      stream,
      unsubscribe: () => unsub?.(),
    };
  }

  getTimeseries(): TimeseriesPoint[] {
    return [...this.timeseries];
  }

  private recordTimeseries(event: McpEvent, success: boolean): void {
    this.timeseries.push({
      timestamp: event.timestamp,
      tool: event.tool!,
      duration: event.duration ?? 0,
      success,
    });
    if (this.timeseries.length > this.maxTimeseries) {
      this.timeseries.shift();
    }
  }

  private updateToolStats(event: McpEvent, success: boolean): void {
    const name = event.tool!;
    if (!this.stats.tools[name]) {
      this.stats.tools[name] = {
        name,
        category: event.category || "unknown",
        totalCalls: 0,
        successCount: 0,
        errorCount: 0,
        lastInvoked: null,
        avgDuration: 0,
      };
    }

    const ts = this.stats.tools[name];
    ts.totalCalls++;
    if (success) ts.successCount++;
    else ts.errorCount++;
    ts.lastInvoked = event.timestamp;

    if (event.duration != null) {
      // Running average
      ts.avgDuration =
        (ts.avgDuration * (ts.totalCalls - 1) + event.duration) /
        ts.totalCalls;
    }
  }
}

export const eventBus = new EventBus();

export function makeEventId(): string {
  return crypto.randomUUID();
}
