/**
 * mcpy -- single process running both:
 *   1. stdio MCP transport (for Claude Desktop, Cursor, etc.)
 *   2. HTTP server for the web UI + REST API
 *
 * Claude Desktop config (~/.config/claude/claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "mcpy": {
 *       "command": "/path/to/mcpy"
 *     }
 *   }
 * }
 */
import { join, dirname } from "path";
import { appendFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { handleApiRequest } from "./api.ts";
import { eventBus, makeEventId } from "./events.ts";
import { loadSettings } from "./settings.ts";
import { discoverTools, registerTools } from "./tools/index.ts";

const PORT = parseInt(process.env.PORT || "3713", 10);

// Resolve UI build dir: works for both compiled binary and dev mode
// Compiled: binary sits next to ui/build (or in the project root)
// Dev: import.meta.dir is src/, go up one level
const IS_COMPILED = import.meta.dir.startsWith("/$bunfs/");
const PROJECT_ROOT = IS_COMPILED
  ? dirname(process.execPath)
  : join(import.meta.dir, "..");
const UI_BUILD_DIR = join(PROJECT_ROOT, "ui", "build");

// Log to both stderr and ~/.mcpy/mcpy.log
const LOG_DIR = join(homedir(), ".mcpy");
const LOG_FILE = join(LOG_DIR, "mcpy.log");
mkdirSync(LOG_DIR, { recursive: true });

const log = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stderr.write(line);
  try { appendFileSync(LOG_FILE, line); } catch {}
};

log(`starting pid=${process.pid} compiled=${IS_COMPILED}`);

// --- Shared setup ---
const settings = await loadSettings();
await discoverTools();
log("tools discovered");

// --- stdio MCP server ---
const mcpServer = new McpServer({
  name: "mcpy",
  version: "0.1.0",
});

await registerTools(mcpServer, settings);
log("tools registered");

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
log("stdio transport connected");

// --- HTTP server (UI + API) ---
async function serveStatic(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let filePath = join(UI_BUILD_DIR, url.pathname);

  let file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file);
  }

  // Try with index.html for directories
  filePath = join(filePath, "index.html");
  file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file);
  }

  // SPA fallback
  const fallback = Bun.file(join(UI_BUILD_DIR, "index.html"));
  if (await fallback.exists()) {
    return new Response(fallback);
  }

  return new Response("Not Found", { status: 404 });
}

try {
  const httpServer = Bun.serve({
    port: PORT,
    idleTimeout: 255,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      // API endpoints
      if (path.startsWith("/api/")) {
        const response = await handleApiRequest(req);
        if (response) return response;
      }

      // Static files
      return serveStatic(req);
    },
  });

  eventBus.emit({
    id: makeEventId(),
    type: "server_start",
    timestamp: new Date().toISOString(),
  });

  log(`web UI running on http://localhost:${httpServer.port}`);
} catch {
  log(`web UI unavailable (port ${PORT} in use) -- stdio MCP transport is active`);
}
