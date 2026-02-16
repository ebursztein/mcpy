/**
 * mcpy -- single process running both:
 *   1. stdio MCP transport (for Claude Desktop, Cursor, etc.)
 *   2. HTTP server for the web UI + REST API
 *
 * CLI:
 *   mcpy              Start MCP server (stdio + HTTP)
 *   mcpy install      Install binary to ~/.mcpy/bin/ and register with Claude Desktop
 *   mcpy uninstall    Remove from Claude Desktop config
 */
import { join, dirname } from "path";
import { appendFileSync, mkdirSync, existsSync, copyFileSync, chmodSync } from "fs";
import { homedir, platform } from "os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { handleApiRequest } from "./api.ts";
import { eventBus, makeEventId } from "./events.ts";
import { loadSettings } from "./settings.ts";
import { discoverTools, registerTools } from "./tools/index.ts";
import { VERSION } from "./version.ts";
import { checkForUpdate, performUpdate } from "./update.ts";

// --- CLI commands (install / uninstall) ---

const INSTALL_DIR = join(homedir(), ".mcpy", "bin");
const INSTALL_PATH = join(INSTALL_DIR, "mcpy");

function getClaudeConfigPath(): string {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "win32":
      return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    default:
      return join(home, ".config", "claude", "claude_desktop_config.json");
  }
}

function getClaudeCodeConfigPath(): string {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, ".claude.json");
    default:
      return join(home, ".claude.json");
  }
}

async function cliInstall(): Promise<void> {
  const src = process.execPath;

  // 1. Copy binary to ~/.mcpy/bin/mcpy
  mkdirSync(INSTALL_DIR, { recursive: true });
  if (src !== INSTALL_PATH) {
    copyFileSync(src, INSTALL_PATH);
    chmodSync(INSTALL_PATH, 0o755);
    console.log(`binary installed to ${INSTALL_PATH}`);
  } else {
    console.log(`binary already at ${INSTALL_PATH}`);
  }

  // 2. Register with Claude Desktop
  const configPath = getClaudeConfigPath();
  let config: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      config = await Bun.file(configPath).json();
    } catch {
      config = {};
    }
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }
  (config.mcpServers as Record<string, unknown>).mcpy = { command: INSTALL_PATH };

  const configDir = dirname(configPath);
  mkdirSync(configDir, { recursive: true });
  await Bun.write(configPath, JSON.stringify(config, null, 2));
  console.log(`registered in Claude Desktop config: ${configPath}`);

  // 3. Register with Claude Code
  try {
    const proc = Bun.spawn(["claude", "mcp", "add", "mcpy", "--", INSTALL_PATH], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      console.log("registered with Claude Code");
    }
  } catch {
    // Claude Code CLI not available, skip silently
  }

  console.log("\nrestart Claude Desktop to connect. for Claude Code, start a new session.");
}

async function cliUninstall(): Promise<void> {
  // Remove from Claude Desktop config
  const configPath = getClaudeConfigPath();
  if (existsSync(configPath)) {
    try {
      const config = await Bun.file(configPath).json() as Record<string, unknown>;
      const servers = config.mcpServers as Record<string, unknown> | undefined;
      if (servers?.mcpy) {
        delete servers.mcpy;
        await Bun.write(configPath, JSON.stringify(config, null, 2));
        console.log(`removed from Claude Desktop config: ${configPath}`);
      }
    } catch {
      // ignore
    }
  }

  // Remove from Claude Code
  try {
    const proc = Bun.spawn(["claude", "mcp", "remove", "mcpy"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    console.log("removed from Claude Code");
  } catch {
    // Claude Code CLI not available, skip silently
  }

  console.log("uninstalled. binary remains at ~/.mcpy/bin/mcpy -- delete manually if needed.");
}

// Handle CLI commands before starting the server
const cmd = process.argv[2];
if (cmd === "install") {
  await cliInstall();
  process.exit(0);
}
if (cmd === "uninstall") {
  await cliUninstall();
  process.exit(0);
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
