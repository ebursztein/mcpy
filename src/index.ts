/**
 * mcpy -- single process running both:
 *   1. stdio MCP transport (for Claude Desktop, Cursor, etc.)
 *   2. HTTP server for the web UI + REST API
 *
 * CLI:
 *   mcpy              Start MCP server (stdio + HTTP)
 *   mcpy install      Interactive install wizard (scan clients, pick tools, tray)
 *   mcpy install -y   Non-interactive install (all defaults)
 *   mcpy uninstall    Remove from all AI client configs
 *   mcpy tray         Start system tray icon
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
import { VERSION } from "./version.ts";
import { checkForUpdate, performUpdate } from "./update.ts";
import { setHttpServer, shutdownHttpServer } from "./server.ts";

// Handle CLI commands before starting the server
const cmd = process.argv[2];
if (cmd === "install") {
  const silent =
    process.argv.includes("-y") ||
    process.argv.includes("--yes") ||
    process.argv.includes("--non-interactive") ||
    !process.stdin.isTTY;
  const { interactiveInstall, nonInteractiveInstall } = await import("./install.ts");
  if (silent) await nonInteractiveInstall();
  else await interactiveInstall();
  process.exit(0);
}
if (cmd === "uninstall") {
  const silent = !process.stdin.isTTY;
  if (silent) {
    // Minimal uninstall for non-interactive contexts
    const { MCP_CLIENTS } = await import("./api.ts");
    const { existsSync } = await import("fs");
    for (const client of MCP_CLIENTS) {
      const configPath = client.getConfigPath();
      if (!existsSync(configPath)) continue;
      try {
        if (client.configFormat === "toml") {
          let content = await Bun.file(configPath).text();
          content = content.replace(/\n?\[mcp_servers\.mcpy\][^[]*?(?=\[|$)/s, "");
          await Bun.write(configPath, content);
        } else {
          const config = (await Bun.file(configPath).json()) as Record<string, unknown>;
          const servers = config.mcpServers as Record<string, unknown> | undefined;
          if (servers?.mcpy) {
            delete servers.mcpy;
            await Bun.write(configPath, JSON.stringify(config, null, 2));
          }
        }
      } catch {}
    }
    const { removeTrayAutoLaunch } = await import("./install.ts");
    removeTrayAutoLaunch();
    console.log("uninstalled. binary remains at ~/.mcpy/bin/mcpy -- delete manually if needed.");
  } else {
    const { interactiveUninstall } = await import("./install.ts");
    await interactiveUninstall();
  }
  process.exit(0);
}
if (cmd === "tray") {
  const { startTray } = await import("./tray.ts");
  await startTray();
  // startTray returns but the systray child process + setInterval keep the event loop alive.
  // We must not fall through to the MCP server setup below.
  // Using an empty await to suspend top-level execution indefinitely.
  await new Promise(() => {});
}

if (cmd === "version" || cmd === "--version" || cmd === "-v") {
  console.log(`mcpy ${VERSION}`);
  process.exit(0);
}
if (cmd === "update") {
  console.log(`mcpy ${VERSION} -- checking for updates...`);
  try {
    const update = await checkForUpdate();
    if (!update) {
      console.log("already up to date.");
      process.exit(0);
    }
    console.log(`update available: ${update.current} -> ${update.latest}`);
    console.log(`downloading ${update.asset}...`);
    await performUpdate(update);
    console.log(`updated to ${update.latest}. restart mcpy to use the new version.`);
  } catch (err) {
    console.error(`update failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  process.exit(0);
}

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
const LOG_DIR = process.env.MCPY_DATA_DIR || join(homedir(), ".mcpy");
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
  version: VERSION,
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
    reusePort: true,
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

  setHttpServer(httpServer);

  eventBus.emit({
    id: makeEventId(),
    type: "server_start",
    timestamp: new Date().toISOString(),
  });

  log(`web UI running on http://localhost:${httpServer.port}`);
} catch {
  log(`web UI unavailable (port ${PORT} in use) -- stdio MCP transport is active`);
}
