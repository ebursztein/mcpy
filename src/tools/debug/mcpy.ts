import { z } from "zod";
import { join } from "path";
import { homedir } from "os";
import { existsSync, statSync } from "fs";
import type { ToolDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";

const DATA_DIR = join(homedir(), ".mcpy");
const LOG_FILE = join(DATA_DIR, "mcpy.log");
const startTime = Date.now();

// --- mcpy_log ---

const mcpyLog: ToolDefinition = {
  name: "mcpy_log",
  category: "agent",
  group: "mcpy",
  title: "mcpy Server Log",
  description:
    "Read the mcpy server log file (~/.mcpy/mcpy.log). Use to debug server startup issues, tool errors, and connection problems. Returns the last N lines by default.",
  inputSchema: {
    action: z
      .enum(["read", "tail", "clear"])
      .default("tail")
      .describe("Action: 'tail' (last N lines, default), 'read' (full log), 'clear' (truncate log)"),
    lines: z
      .number()
      .optional()
      .default(50)
      .describe("Number of lines to return for 'tail' action (default: 50)"),
  },
  async handler(params) {
    const { action = "tail", lines = 50 } = params as {
      action?: string;
      lines?: number;
    };

    if (!existsSync(LOG_FILE)) {
      return errorResult("No log file found at " + LOG_FILE);
    }

    switch (action) {
      case "read": {
        const content = await Bun.file(LOG_FILE).text();
        if (!content.trim()) return textResult("Log file is empty.");
        return textResult(content);
      }
      case "tail": {
        const content = await Bun.file(LOG_FILE).text();
        if (!content.trim()) return textResult("Log file is empty.");
        const allLines = content.trimEnd().split("\n");
        const n = Math.min(lines, allLines.length);
        const tail = allLines.slice(-n);
        const stat = statSync(LOG_FILE);
        const size = (stat.size / 1024).toFixed(1);
        return textResult(
          `--- mcpy.log (${allLines.length} total lines, ${size} KB) last ${n} ---\n${tail.join("\n")}`
        );
      }
      case "clear": {
        await Bun.write(LOG_FILE, "");
        return textResult("Log file cleared.");
      }
      default:
        return errorResult(`Unknown action: ${action}`);
    }
  },
};

// --- mcpy_restart ---

const mcpyRestart: ToolDefinition = {
  name: "mcpy_restart",
  category: "agent",
  group: "mcpy",
  title: "Restart mcpy",
  description:
    "Restart the mcpy server process. Use after recompiling or changing configuration. The MCP client (Claude Desktop, etc.) will automatically reconnect.",
  inputSchema: {
    confirm: z
      .boolean()
      .describe("Must be true to confirm restart"),
  },
  async handler(params) {
    const { confirm } = params as { confirm: boolean };
    if (!confirm) {
      return errorResult("Set confirm=true to restart the server.");
    }
    setTimeout(() => process.exit(0), 100);
    return textResult("mcpy is restarting. The MCP client will reconnect automatically.");
  },
};

// --- mcpy_stats ---

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const mcpyStats: ToolDefinition = {
  name: "mcpy_stats",
  category: "agent",
  group: "mcpy",
  title: "mcpy Server Stats",
  description:
    "Show mcpy server runtime statistics: uptime, process info, data directory size, and tool invocation counts.",
  inputSchema: {},
  async handler(_params, context) {
    const uptime = Date.now() - startTime;

    const lines: string[] = [
      `mcpy server stats`,
      `---`,
      `pid: ${process.pid}`,
      `uptime: ${formatDuration(uptime)}`,
      `compiled: ${import.meta.dir.startsWith("/$bunfs/")}`,
      `bun: ${Bun.version}`,
      `platform: ${process.platform} ${process.arch}`,
      `memory: ${(process.memoryUsage.rss() / 1024 / 1024).toFixed(1)} MB RSS`,
      `data dir: ${DATA_DIR}`,
    ];

    const settingsFile = join(DATA_DIR, "settings.json");
    if (existsSync(settingsFile)) {
      lines.push(`settings: ${(statSync(settingsFile).size / 1024).toFixed(1)} KB`);
    }
    if (existsSync(LOG_FILE)) {
      lines.push(`log: ${(statSync(LOG_FILE).size / 1024).toFixed(1)} KB`);
    }

    const stats = context.eventBus.getStats();
    lines.push(`---`);
    lines.push(`total invocations: ${stats.totalInvocations}`);
    lines.push(`success: ${stats.successCount}`);
    lines.push(`errors: ${stats.errorCount}`);

    if (Object.keys(stats.tools).length > 0) {
      lines.push(`---`);
      lines.push(`tool breakdown:`);
      for (const [name, ts] of Object.entries(stats.tools)) {
        lines.push(`  ${name}: ${ts.totalCalls} calls (${ts.successCount} ok, ${ts.errorCount} err, avg ${ts.avgDuration.toFixed(0)}ms)`);
      }
    }

    return textResult(lines.join("\n"));
  },
};

export { mcpyLog, mcpyRestart, mcpyStats };
