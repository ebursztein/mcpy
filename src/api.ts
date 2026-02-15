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
import { getToolInfoList } from "./tools/index.ts";

// Claude Desktop config path varies by platform
function getClaudeConfigPath(): string {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "win32":
      return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    default: // linux
      return join(home, ".config", "claude", "claude_desktop_config.json");
  }
}

function getMcpyBinaryPath(): string {
  const IS_COMPILED = import.meta.dir.startsWith("/$bunfs/");
  if (IS_COMPILED) {
    return process.execPath;
  }
  // Dev mode: binary is at project root
  return join(import.meta.dir, "..", "mcpy");
}

interface ClaudeDesktopConfig {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  [key: string]: unknown;
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

  if (!configExists) {
    return { installed: false, configPath, configExists, binaryPath, binaryExists };
  }

  try {
    const file = Bun.file(configPath);
    const config: ClaudeDesktopConfig = await file.json();
    const installed = !!config.mcpServers?.mcpy;
    return { installed, configPath, configExists, binaryPath, binaryExists };
  } catch {
    return { installed: false, configPath, configExists, binaryPath, binaryExists };
  }
}

async function compileBinary(): Promise<{ ok: boolean; error?: string }> {
  const IS_COMPILED = import.meta.dir.startsWith("/$bunfs/");
  if (IS_COMPILED) {
    // Already a compiled binary, no need to recompile
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

async function installToClaude(): Promise<{
  ok: boolean;
  error?: string;
}> {
  // Step 1: Compile binary if needed
  const compileResult = await compileBinary();
  if (!compileResult.ok) {
    return compileResult;
  }

  // Step 2: Build UI if needed
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

  // Step 3: Register the binary in Claude Desktop config
  const configPath = getClaudeConfigPath();
  const binaryPath = getMcpyBinaryPath();

  let config: ClaudeDesktopConfig = {};

  if (existsSync(configPath)) {
    try {
      const file = Bun.file(configPath);
      config = await file.json();
    } catch {
      config = {};
    }
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  config.mcpServers.mcpy = { command: binaryPath };

  try {
    const configDir = dirname(configPath);
    mkdirSync(configDir, { recursive: true });
    await Bun.write(configPath, JSON.stringify(config, null, 2));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function uninstallFromClaude(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const configPath = getClaudeConfigPath();

  if (!existsSync(configPath)) {
    return { ok: true };
  }

  try {
    const file = Bun.file(configPath);
    const config: ClaudeDesktopConfig = await file.json();

    if (config.mcpServers?.mcpy) {
      delete config.mcpServers.mcpy;
    }

    await Bun.write(configPath, JSON.stringify(config, null, 2));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

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

  if (path === "/api/sessions" && req.method === "GET") {
    return json(eventBus.getSessions());
  }

  // Claude Desktop install management
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

  return null;
}
