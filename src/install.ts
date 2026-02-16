/**
 * Interactive install wizard using @clack/prompts.
 *
 * Scans for AI clients, lets the user pick which to register,
 * choose tool groups, and optionally set up the tray auto-launch.
 * Group choices are driven by ALL_GROUPS so the TUI stays in sync
 * with the tool registry automatically.
 */
import { join, dirname } from "path";
import { homedir, platform } from "os";
import { existsSync, mkdirSync, copyFileSync, chmodSync, writeFileSync, unlinkSync } from "fs";
import * as clack from "@clack/prompts";
import { MCP_CLIENTS, type McpClientDef } from "./api.ts";
import { ALL_GROUPS } from "./tools/index.ts";
import { TOOL_CATALOG } from "./tools/catalog.ts";
import { loadSettings, saveSettings } from "./settings.ts";
import { hasDesktop } from "./platform.ts";

const INSTALL_DIR = join(homedir(), ".mcpy", "bin");
const INSTALL_PATH = join(INSTALL_DIR, "mcpy");

// ---------------------------------------------------------------------------
// Client scanning
// ---------------------------------------------------------------------------

interface ScannedClient {
  client: McpClientDef;
  detected: boolean;
}

function scanClients(): ScannedClient[] {
  return MCP_CLIENTS.map((client) => ({
    client,
    detected: client.detect(),
  }));
}

// ---------------------------------------------------------------------------
// Group choices -- built dynamically from the tool registry
// ---------------------------------------------------------------------------

interface GroupChoice {
  value: string;
  label: string;
  hint: string;
}

function buildGroupChoices(): { choices: GroupChoice[]; defaults: string[] } {
  const choices: GroupChoice[] = [];
  const defaults: string[] = [];

  for (const g of ALL_GROUPS) {
    let label = g.label;
    if (g.requiresConfig) label += " (requires config)";
    if (g.remote) label += " (remote)";

    let hint = g.description;
    if (g.url && g.requiresConfig) hint += ` -- ${g.url}`;

    choices.push({ value: g.id, label, hint });

    // Pre-select groups that are enabled by default and don't need config
    if (g.enabledByDefault && !g.requiresConfig) {
      defaults.push(g.id);
    }
  }

  return { choices, defaults };
}

// ---------------------------------------------------------------------------
// Config writers
// ---------------------------------------------------------------------------

interface McpConfig {
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
  [key: string]: unknown;
}

async function registerJsonClient(configPath: string, binaryPath: string): Promise<void> {
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
  mkdirSync(dirname(configPath), { recursive: true });
  await Bun.write(configPath, JSON.stringify(config, null, 2));
}

async function registerTomlClient(configPath: string, binaryPath: string): Promise<void> {
  const tomlBlock = `\n[mcp_servers.mcpy]\ntype = "stdio"\ncommand = "${binaryPath}"\n`;
  mkdirSync(dirname(configPath), { recursive: true });

  if (existsSync(configPath)) {
    let content = await Bun.file(configPath).text();
    if (content.includes("[mcp_servers.mcpy]")) {
      content = content.replace(
        /\n?\[mcp_servers\.mcpy\][^[]*?(?=\[|$)/s,
        tomlBlock
      );
    } else {
      content += tomlBlock;
    }
    await Bun.write(configPath, content);
  } else {
    await Bun.write(configPath, tomlBlock.trimStart());
  }
}

async function registerClient(client: McpClientDef, binaryPath: string): Promise<void> {
  const configPath = client.getConfigPath();
  if (client.configFormat === "toml") {
    await registerTomlClient(configPath, binaryPath);
  } else {
    await registerJsonClient(configPath, binaryPath);
  }
}

// ---------------------------------------------------------------------------
// Tool selection persistence
// ---------------------------------------------------------------------------

async function saveToolSelection(selectedGroupIds: string[]): Promise<void> {
  const settings = await loadSettings();
  const selected = new Set(selectedGroupIds);

  for (const group of ALL_GROUPS) {
    const userWants = selected.has(group.id);
    // Only write overrides for groups that differ from their default
    if (userWants === group.enabledByDefault) continue;

    // Find tool names from the catalog
    const catalogGroup = TOOL_CATALOG.find((g) => g.id === group.id);
    if (!catalogGroup) continue;

    for (const tool of catalogGroup.tools) {
      settings.tools[tool.name] = { enabled: userWants };
    }
  }

  await saveSettings(settings);
}

// ---------------------------------------------------------------------------
// Tray auto-launch
// ---------------------------------------------------------------------------

const LAUNCH_AGENT_PATH = join(homedir(), "Library", "LaunchAgents", "app.mcpy.tray.plist");
const AUTOSTART_DIR = join(homedir(), ".config", "autostart");
const AUTOSTART_PATH = join(AUTOSTART_DIR, "mcpy-tray.desktop");

function setupTrayAutoLaunch(binaryPath: string): void {
  const p = platform();

  if (p === "darwin") {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>app.mcpy.tray</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binaryPath}</string>
    <string>tray</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>`;
    mkdirSync(dirname(LAUNCH_AGENT_PATH), { recursive: true });
    writeFileSync(LAUNCH_AGENT_PATH, plist);
    try {
      Bun.spawnSync(["launchctl", "load", LAUNCH_AGENT_PATH]);
    } catch {
      // launchctl may not be available in some contexts
    }
    return;
  }

  if (p === "linux" && hasDesktop()) {
    const desktop = `[Desktop Entry]
Type=Application
Name=mcpy Tray
Exec=${binaryPath} tray
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
    mkdirSync(AUTOSTART_DIR, { recursive: true });
    writeFileSync(AUTOSTART_PATH, desktop);
  }
}

export function removeTrayAutoLaunch(): void {
  try {
    if (existsSync(LAUNCH_AGENT_PATH)) {
      try { Bun.spawnSync(["launchctl", "unload", LAUNCH_AGENT_PATH]); } catch {}
      unlinkSync(LAUNCH_AGENT_PATH);
    }
  } catch {}

  try {
    if (existsSync(AUTOSTART_PATH)) {
      unlinkSync(AUTOSTART_PATH);
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Interactive install
// ---------------------------------------------------------------------------

export async function interactiveInstall(): Promise<void> {
  clack.intro("mcpy setup");

  // 1. Copy binary
  const src = process.execPath;
  const s = clack.spinner();

  s.start("Installing binary");
  mkdirSync(INSTALL_DIR, { recursive: true });
  if (src !== INSTALL_PATH) {
    copyFileSync(src, INSTALL_PATH);
    chmodSync(INSTALL_PATH, 0o755);
  }
  s.stop(`Binary installed to ${INSTALL_PATH}`);

  // 2. Scan for AI clients
  s.start("Scanning for AI clients");
  const scanned = scanClients();
  const detected = scanned.filter((s) => s.detected);
  s.stop(
    detected.length > 0
      ? `Found: ${detected.map((d) => d.client.name).join(", ")}`
      : "No AI clients detected"
  );

  // 3. Client selection
  const clientChoices = scanned.map((sc) => ({
    value: sc.client.id,
    label: `${sc.client.name}${sc.detected ? " (detected)" : ""}`,
  }));

  const selectedClients = await clack.multiselect({
    message: "Register mcpy with:",
    options: clientChoices,
    initialValues: detected.map((d) => d.client.id),
    required: false,
  });

  if (clack.isCancel(selectedClients)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  // 4. Tool group selection (dynamic from registry)
  const { choices: groupChoices, defaults: groupDefaults } = buildGroupChoices();

  const selectedGroups = await clack.multiselect({
    message: "Enable tool groups:",
    options: groupChoices,
    initialValues: groupDefaults,
    required: false,
  });

  if (clack.isCancel(selectedGroups)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Show setup URLs for selected groups that need configuration
  const configUrls: string[] = [];
  for (const gid of selectedGroups) {
    const g = ALL_GROUPS.find((gr) => gr.id === gid);
    if (g?.requiresConfig && g.url) {
      configUrls.push(`${g.label}: ${g.url}`);
    }
  }
  if (configUrls.length > 0) {
    clack.note(configUrls.join("\n"), "Configure API keys at");
  }

  // 5. Tray auto-launch (only on desktop platforms)
  let enableTray = false;
  if (hasDesktop()) {
    const trayAnswer = await clack.confirm({
      message: "Start menu bar icon on login?",
      initialValue: true,
    });

    if (clack.isCancel(trayAnswer)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }
    enableTray = trayAnswer;
  }

  // 6. Execute
  s.start("Registering with AI clients");
  const registered: string[] = [];
  for (const clientId of selectedClients) {
    const client = MCP_CLIENTS.find((c) => c.id === clientId);
    if (!client) continue;
    try {
      await registerClient(client, INSTALL_PATH);
      registered.push(client.name);
    } catch {
      // Silently skip failed registrations
    }
  }
  s.stop(
    registered.length > 0
      ? `Registered: ${registered.join(", ")}`
      : "No clients registered"
  );

  // Save tool selection
  s.start("Saving tool configuration");
  await saveToolSelection(selectedGroups);
  s.stop(`${selectedGroups.length} tool group${selectedGroups.length === 1 ? "" : "s"} enabled`);

  // Tray setup
  if (enableTray) {
    s.start("Setting up tray auto-launch");
    setupTrayAutoLaunch(INSTALL_PATH);
    s.stop("Tray auto-launch configured");
  }

  // Summary
  const lines = [];
  if (registered.length > 0) lines.push(`Registered: ${registered.join(", ")}`);
  lines.push(`Tools: ${selectedGroups.length} groups enabled`);
  if (enableTray) lines.push("Tray: auto-starts on login");
  lines.push(`Dashboard: http://localhost:${process.env.PORT || "3713"}`);
  lines.push("");
  lines.push("Restart your AI clients to connect.");

  clack.note(lines.join("\n"), "mcpy installed");
  clack.outro("done");
}

// ---------------------------------------------------------------------------
// Non-interactive install (defaults only)
// ---------------------------------------------------------------------------

export async function nonInteractiveInstall(): Promise<void> {
  const src = process.execPath;

  // Copy binary
  mkdirSync(INSTALL_DIR, { recursive: true });
  if (src !== INSTALL_PATH) {
    copyFileSync(src, INSTALL_PATH);
    chmodSync(INSTALL_PATH, 0o755);
    console.log(`binary installed to ${INSTALL_PATH}`);
  }

  // Register with all detected clients
  const scanned = scanClients();
  for (const { client, detected } of scanned) {
    if (!detected) continue;
    try {
      await registerClient(client, INSTALL_PATH);
      console.log(`registered with ${client.name}`);
    } catch {
      // skip
    }
  }

  console.log(`\nrestart your AI clients to connect. dashboard: http://localhost:${process.env.PORT || "3713"}`);
}

// ---------------------------------------------------------------------------
// Uninstall (enhanced -- all clients + tray cleanup)
// ---------------------------------------------------------------------------

export async function interactiveUninstall(): Promise<void> {
  clack.intro("mcpy uninstall");
  const s = clack.spinner();

  // Remove from all client configs
  s.start("Removing from AI client configs");
  for (const client of MCP_CLIENTS) {
    const configPath = client.getConfigPath();
    if (!existsSync(configPath)) continue;
    try {
      if (client.configFormat === "toml") {
        let content = await Bun.file(configPath).text();
        content = content.replace(/\n?\[mcp_servers\.mcpy\][^[]*?(?=\[|$)/s, "");
        await Bun.write(configPath, content);
      } else {
        const config = (await Bun.file(configPath).json()) as McpConfig;
        if (config.mcpServers?.mcpy) {
          delete config.mcpServers.mcpy;
          await Bun.write(configPath, JSON.stringify(config, null, 2));
        }
      }
    } catch {
      // skip
    }
  }
  s.stop("Removed from all client configs");

  // Remove tray auto-launch
  s.start("Removing tray auto-launch");
  removeTrayAutoLaunch();
  s.stop("Tray auto-launch removed");

  clack.note("Binary remains at ~/.mcpy/bin/mcpy -- delete manually if needed.", "mcpy uninstalled");
  clack.outro("done");
}
