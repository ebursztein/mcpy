import { readFileSync, existsSync } from "fs";
import { platform, homedir } from "os";
import { join } from "path";

let _isWSL: boolean | null = null;

export function isWSL(): boolean {
  if (_isWSL !== null) return _isWSL;
  try {
    _isWSL = /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    _isWSL = false;
  }
  return _isWSL;
}

export function hasDesktop(): boolean {
  if (process.env.MCPY_HEADLESS === "1") return false;
  if (platform() === "darwin") return true;
  if (isWSL()) return false;
  return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

export function openBrowser(url: string): void {
  const p = platform();
  if (p === "darwin") {
    Bun.spawn(["open", url]);
  } else if (isWSL()) {
    try {
      Bun.spawn(["wslview", url]);
    } catch {
      Bun.spawn(["explorer.exe", url]);
    }
  } else {
    Bun.spawn(["xdg-open", url]);
  }
}

export function getWindowsUsername(): string | null {
  if (!isWSL()) return null;
  try {
    const r = Bun.spawnSync(["cmd.exe", "/c", "echo", "%USERNAME%"]);
    const name = new TextDecoder().decode(r.stdout).trim();
    return name && name !== "%USERNAME%" ? name : null;
  } catch {
    return null;
  }
}

/** Check if a command exists on PATH */
export function commandExists(cmd: string): boolean {
  try {
    const r = Bun.spawnSync(["which", cmd]);
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

/** Get the WSL-aware Claude Desktop config directory */
export function getClaudeDesktopConfigDir(): string {
  const home = homedir();
  const p = platform();
  if (p === "darwin") {
    return join(home, "Library", "Application Support", "Claude");
  }
  if (isWSL()) {
    const winUser = getWindowsUsername();
    if (winUser) {
      return join("/mnt/c/Users", winUser, "AppData/Roaming/Claude");
    }
  }
  if (p === "win32") {
    return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude");
  }
  return join(home, ".config", "claude");
}
