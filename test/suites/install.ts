/**
 * Tests for the mcpy install command.
 * Runs the compiled binary's `install` subcommand and verifies results.
 */
import { suite, assert } from "../lib/harness.ts";
import { homedir, platform } from "os";
import { join } from "path";
import { existsSync, accessSync, constants } from "fs";

const INSTALLED_BINARY = join(homedir(), ".mcpy", "bin", "mcpy");

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

export async function testInstall(builtBinary: string) {
  suite("install");

  // Run mcpy install
  const proc = Bun.spawn([builtBinary, "install"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  assert("install exits 0", exitCode === 0, `exit: ${exitCode}`);
  assert("install copies binary", existsSync(INSTALLED_BINARY));

  // Check executable permission
  let executable = false;
  try {
    accessSync(INSTALLED_BINARY, constants.X_OK);
    executable = true;
  } catch {}
  assert("installed binary is executable", executable);

  // Verify config registration (only if Claude Desktop is detected on this system)
  const configPath = getClaudeConfigPath();
  if (existsSync(configPath)) {
    let registered = false;
    try {
      const config = JSON.parse(await Bun.file(configPath).text());
      registered = config?.mcpServers?.mcpy?.command === INSTALLED_BINARY;
    } catch {}
    assert("registered in Claude Desktop config", registered);
  }

  // Verify the installed copy runs
  const versionProc = Bun.spawn([INSTALLED_BINARY, "version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const versionOut = await new Response(versionProc.stdout).text();
  await versionProc.exited;
  assert("installed binary outputs version", /\d+\.\d+\.\d+/.test(versionOut), versionOut.trim());

  // Test explicit -y flag (non-interactive)
  const yProc = Bun.spawn([builtBinary, "install", "-y"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const yStdout = await new Response(yProc.stdout).text();
  const yExit = await yProc.exited;
  assert("install -y exits 0", yExit === 0, `exit: ${yExit}`);
  assert("install -y produces output", yStdout.length > 0);

  // Test tray command on headless (should exit gracefully, not hang)
  const trayProc = Bun.spawn([builtBinary, "tray"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, MCPY_HEADLESS: "1" },
  });
  const trayExit = await Promise.race([
    trayProc.exited,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5000)),
  ]);
  if (trayExit === "timeout") {
    trayProc.kill();
    await trayProc.exited;
  }
  assert("tray headless exits within 5s", trayExit !== "timeout", "timed out -- tray hung");
  assert("tray headless does not crash", trayExit === 0 || trayExit === 1, `exit: ${trayExit}`);
}
