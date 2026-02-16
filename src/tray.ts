/**
 * System tray icon using systray2.
 * Connects to the mcpy HTTP server to show live activity and stats.
 * Run with: mcpy tray
 */
import SysTrayModule from "systray2";
import type { ClickEvent, Menu, MenuItem } from "systray2";
import { ICON_IDLE, ICON_ACTIVE } from "./tray-icon.ts";
import { hasDesktop, openBrowser } from "./platform.ts";
import type { AggregateStats, McpEvent } from "./types.ts";
import { appendFileSync } from "fs";

const TRAY_LOG = "/tmp/mcpy-tray.log";
function trayLog(msg: string) {
  try { appendFileSync(TRAY_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// bun build --compile double-wraps CJS default exports
const SysTray = typeof SysTrayModule === "function"
  ? SysTrayModule
  : (SysTrayModule as any).default as typeof SysTrayModule;

const PORT = parseInt(process.env.PORT || "3713", 10);
const BASE = `http://localhost:${PORT}`;
const POLL_INTERVAL = 5_000; // 5s stats poll
const FLASH_DURATION = 2_000; // 2s active icon flash

// Menu item seq_ids (separators count as items in the flat array)
const SEQ_DASHBOARD = 0;
const SEQ_TOOLS = 1;
const SEQ_SETTINGS = 2;
// 3 = separator
const SEQ_STATUS = 4;
// 5 = separator
const SEQ_QUIT = 6;

function buildMenu(statusText: string): Menu {
  return {
    icon: ICON_IDLE,
    isTemplateIcon: true,
    title: "",
    tooltip: "mcpy",
    items: [
      { title: "Dashboard", tooltip: "Open mcpy dashboard in browser", enabled: true },
      { title: "Tool Config", tooltip: "Open tool configuration page", enabled: true },
      { title: "AI Clients", tooltip: "Open AI clients configuration page", enabled: true },
      SysTray.separator,
      { title: statusText, tooltip: statusText, enabled: false },
      SysTray.separator,
      { title: "Quit", tooltip: "Close tray icon", enabled: true },
    ],
  };
}

export async function startTray(): Promise<void> {
  if (!hasDesktop()) {
    console.error(`tray not available (no desktop environment). dashboard: ${BASE}`);
    process.exit(0);
  }

  const menu = buildMenu("connecting...");

  const systray = new SysTray({
    menu,
    debug: false,
    copyDir: true,
  });

  let flashTimeout: ReturnType<typeof setTimeout> | null = null;

  // Flash the icon to active state, then revert after FLASH_DURATION
  function flashActive() {
    if (flashTimeout) clearTimeout(flashTimeout);
    systray.sendAction({
      type: "update-menu",
      menu: { ...menu, icon: ICON_ACTIVE },
    });
    flashTimeout = setTimeout(() => {
      systray.sendAction({
        type: "update-menu",
        menu: { ...menu, icon: ICON_IDLE },
      });
      flashTimeout = null;
    }, FLASH_DURATION);
  }

  // Update the status line in the menu
  function updateStatus(text: string) {
    systray.sendAction({
      type: "update-item",
      item: { title: text, tooltip: text, enabled: false },
      seq_id: SEQ_STATUS,
    });
  }

  // Poll stats every POLL_INTERVAL
  async function pollStats() {
    try {
      const res = await fetch(`${BASE}/api/stats`);
      if (!res.ok) {
        updateStatus(`server error (${res.status})`);
        return;
      }
      const stats: AggregateStats = await res.json();
      const sessions = stats.totalInvocations > 0 ? "active" : "idle";
      updateStatus(`${sessions} | ${stats.totalInvocations} calls | ${stats.errorCount} errors`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`tray poll failed: ${msg}`);
      updateStatus("server unreachable");
    }
  }

  // SSE connection for live activity
  function connectSSE() {
    try {
      const eventSource = new EventSource(`${BASE}/api/events`);

      eventSource.onmessage = (event) => {
        try {
          const data: McpEvent = JSON.parse(event.data);
          if (data.type === "tool_result" || data.type === "tool_error") {
            flashActive();
          }
        } catch {
          // ignore parse errors
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        // Reconnect after a delay
        setTimeout(connectSSE, 5_000);
      };
    } catch {
      // EventSource not available or failed to connect, retry
      setTimeout(connectSSE, 5_000);
    }
  }

  await systray.ready();

  // Attach handlers after ready (process is spawned)
  systray.onError((err: Error) => {
    console.error(`tray error: ${err.message}`);
  });

  systray.onClick((event: ClickEvent) => {
    switch (event.seq_id) {
      case SEQ_DASHBOARD:
        openBrowser(BASE);
        break;
      case SEQ_TOOLS:
        openBrowser(`${BASE}/tools`);
        break;
      case SEQ_SETTINGS:
        openBrowser(`${BASE}/settings`);
        break;
      case SEQ_QUIT:
        systray.kill(true);
        break;
    }
  });

  // Start polling and SSE
  pollStats();
  setInterval(pollStats, POLL_INTERVAL);
  connectSSE();
}
