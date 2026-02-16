import { join, dirname } from "path";
import { homedir, platform } from "os";
import { existsSync, mkdirSync } from "fs";
import { eventBus } from "./events.ts";
import {
  loadSettings,
  updateSettings,
  redactSettings,
  saveSettings,
} from "./settings.ts";
import { getToolInfoList, getGroupInfoList } from "./tools/index.ts";
import { getVersionInfo, checkForUpdate, performUpdate } from "./update.ts";
import { shutdownHttpServer } from "./server.ts";

// --- MCP client config paths (from official docs) ---

interface McpClientDef {
  id: string;
  name: string;
  getConfigPath: () => string;
}

const MCP_CLIENTS: McpClientDef[] = [
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    getConfigPath: () => {
      const home = homedir();
      switch (platform()) {
        case "darwin":
          return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
        case "win32":
          return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
        default:
          return join(home, ".config", "claude", "claude_desktop_config.json");
      }
    },
  },
  {
    id: "claude-code",
    name: "Claude Code",
    getConfigPath: () => join(homedir(), ".claude.json"),
  },
  {
    id: "cursor",
    name: "Cursor",
    getConfigPath: () => join(homedir(), ".cursor", "mcp.json"),
  },
];

function getClaudeConfigPath(): string {
  return MCP_CLIENTS[0].getConfigPath();
}

function getMcpyBinaryPath(): string {
  const IS_COMPILED = import.meta.dir.startsWith("/$bunfs/");
  if (IS_COMPILED) {
    return process.execPath;
  }
  // Dev mode: binary is at project root
  return join(import.meta.dir, "..", "mcpy");
}

interface McpConfig {
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
  [key: string]: unknown;
}

interface ClientInfo {
  id: string;
  name: string;
  configPath: string;
  configExists: boolean;
  installed: boolean;
}

async function checkClientInstalled(configPath: string): Promise<boolean> {
  if (!existsSync(configPath)) return false;
  try {
    const config: McpConfig = await Bun.file(configPath).json();
    return !!config.mcpServers?.mcpy;
  } catch {
    return false;
  }
}

async function getClientsStatus(): Promise<{ clients: ClientInfo[]; binaryPath: string }> {
  const binaryPath = getMcpyBinaryPath();
  const clients: ClientInfo[] = await Promise.all(
    MCP_CLIENTS.map(async (client) => {
      const configPath = client.getConfigPath();
      const configExists = existsSync(configPath);
      const installed = await checkClientInstalled(configPath);
      return { id: client.id, name: client.name, configPath, configExists, installed };
    })
  );
  return { clients, binaryPath };
}

async function getInstallStatus(): Promise<{
  installed: boolean;
  configPath: string;
  configExists: boolean;
  binaryPath: string;
  binaryExists: boolean;
}> {
  const configPath = getClaudeConfigPath();
  const binaryPath = getMcpyBinaryPath();
  const configExists = existsSync(configPath);
  const binaryExists = existsSync(binaryPath);
  const installed = await checkClientInstalled(configPath);
  return { installed, configPath, configExists, binaryPath, binaryExists };
}

async function compileBinary(): Promise<{ ok: boolean; error?: string }> {
  const IS_COMPILED = import.meta.dir.startsWith("/$bunfs/");
  if (IS_COMPILED) {
    return { ok: true };
  }

  const projectRoot = join(import.meta.dir, "..");
  const proc = Bun.spawn(["bun", "build", "src/index.ts", "--compile", "--outfile", "mcpy"], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    return { ok: false, error: `Compilation failed: ${stderr}` };
  }

  return { ok: true };
}

async function installToClient(clientId: string): Promise<{ ok: boolean; error?: string }> {
  const client = MCP_CLIENTS.find((c) => c.id === clientId);
  if (!client) return { ok: false, error: `Unknown client: ${clientId}` };

  // Compile binary if needed (dev mode only)
  const compileResult = await compileBinary();
  if (!compileResult.ok) return compileResult;

  // Build UI if needed (dev mode only)
  const IS_COMPILED = import.meta.dir.startsWith("/$bunfs/");
  if (!IS_COMPILED) {
    const projectRoot = join(import.meta.dir, "..");
    const uiDir = join(projectRoot, "ui");
    if (!existsSync(join(uiDir, "build"))) {
      const proc = Bun.spawn(["bun", "run", "build"], {
        cwd: uiDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        return { ok: false, error: `UI build failed: ${stderr}` };
      }
    }
  }

  const configPath = client.getConfigPath();
  const binaryPath = getMcpyBinaryPath();

  let config: McpConfig = {};
  if (existsSync(configPath)) {
    try {
      config = await Bun.file(configPath).json();
    } catch {
      config = {};
    }
  }

  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.mcpy = { command: binaryPath };

  try {
    mkdirSync(dirname(configPath), { recursive: true });
    await Bun.write(configPath, JSON.stringify(config, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function uninstallFromClient(clientId: string): Promise<{ ok: boolean; error?: string }> {
  const client = MCP_CLIENTS.find((c) => c.id === clientId);
  if (!client) return { ok: false, error: `Unknown client: ${clientId}` };

  const configPath = client.getConfigPath();
  if (!existsSync(configPath)) return { ok: true };

  try {
    const config: McpConfig = await Bun.file(configPath).json();
    if (config.mcpServers?.mcpy) {
      delete config.mcpServers.mcpy;
    }
    await Bun.write(configPath, JSON.stringify(config, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Legacy wrappers for backwards compat
async function installToClaude() { return installToClient("claude-desktop"); }
async function uninstallFromClaude() { return uninstallFromClient("claude-desktop"); }

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function cors(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function handleApiRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    return cors();
  }

  if (path === "/api/tools" && req.method === "GET") {
    const settings = await loadSettings();
    return json(getToolInfoList(settings));
  }

  if (path === "/api/groups" && req.method === "GET") {
    return json(getGroupInfoList());
  }

  if (path === "/api/tools" && req.method === "POST") {
    const body = (await req.json()) as { name: string; enabled: boolean };
    const settings = await loadSettings();
    settings.tools[body.name] = { enabled: body.enabled };
    await saveSettings(settings);
    return json({ ok: true });
  }

  if (path === "/api/settings" && req.method === "GET") {
    const settings = await loadSettings();
    return json(redactSettings(settings));
  }

  if (path === "/api/settings" && req.method === "POST") {
    const body = await req.json();
    const updated = await updateSettings(body as Record<string, unknown>);
    return json(redactSettings(updated));
  }

  if (path === "/api/events" && req.method === "GET") {
    const { stream } = eventBus.createSSEStream();
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (path === "/api/stats" && req.method === "GET") {
    return json(eventBus.getStats());
  }

  if (path === "/api/stats/timeseries" && req.method === "GET") {
    return json(eventBus.getTimeseries());
  }

  if (path === "/api/sessions" && req.method === "GET") {
    return json(eventBus.getSessions());
  }

  // MCP client detection and per-client install/uninstall
  if (path === "/api/clients" && req.method === "GET") {
    return json(await getClientsStatus());
  }

  const clientMatch = path.match(/^\/api\/clients\/([^/]+)\/install$/);
  if (clientMatch && req.method === "POST") {
    const result = await installToClient(clientMatch[1]);
    return json(result, result.ok ? 200 : 500);
  }
  if (clientMatch && req.method === "DELETE") {
    const result = await uninstallFromClient(clientMatch[1]);
    return json(result, result.ok ? 200 : 500);
  }

  // Legacy Claude Desktop install management
  if (path === "/api/install" && req.method === "GET") {
    return json(await getInstallStatus());
  }

  if (path === "/api/install" && req.method === "POST") {
    const result = await installToClaude();
    return json(result, result.ok ? 200 : 500);
  }

  if (path === "/api/install" && req.method === "DELETE") {
    const result = await uninstallFromClaude();
    return json(result, result.ok ? 200 : 500);
  }

  // Version and update management
  if (path === "/api/version" && req.method === "GET") {
    return json(await getVersionInfo());
  }

  if (path === "/api/update" && req.method === "POST") {
    try {
      const update = await checkForUpdate();
      if (!update) {
        return json({ ok: true, message: "Already up to date" });
      }
      await performUpdate(update);
      // Stop HTTP server to release port, then exit so MCP client respawns us
      setTimeout(async () => {
        await shutdownHttpServer();
        process.exit(0);
      }, 500);
      return json({ ok: true, message: `Updated to ${update.latest}. Restarting...` });
    } catch (err) {
      return json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  }

  return null;
}
