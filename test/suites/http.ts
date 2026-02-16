/**
 * Tests for the HTTP REST API.
 * Assumes the MCP server is already running (HTTP starts as a side effect).
 */
import { suite, assert, HTTP_BASE } from "../lib/harness.ts";

export async function waitForHttp(ms = 10000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${HTTP_BASE}/api/stats`);
      if (res.ok) return true;
    } catch {}
    await Bun.sleep(200);
  }
  return false;
}

export async function testHttp() {
  suite("http");

  const ready = await waitForHttp();
  assert("HTTP server reachable", ready);
  if (!ready) return;

  // GET /api/tools
  const toolsRes = await fetch(`${HTTP_BASE}/api/tools`);
  assert("GET /api/tools 200", toolsRes.status === 200);
  const tools = (await toolsRes.json()) as Array<{ name: string; enabled: boolean }>;
  assert("GET /api/tools returns array", Array.isArray(tools) && tools.length > 0, `count: ${tools.length}`);

  // Verify some known tools are in the list
  const toolNames = tools.map((t) => t.name);
  assert("api/tools includes todo_list", toolNames.includes("todo_list"));
  assert("api/tools includes memory", toolNames.includes("memory"));

  // GET /api/version
  const verRes = await fetch(`${HTTP_BASE}/api/version`);
  assert("GET /api/version 200", verRes.status === 200);
  const ver = (await verRes.json()) as { current?: string; updateAvailable?: boolean };
  assert("api/version has current", typeof ver.current === "string", `current: ${ver.current}`);
  assert("api/version has updateAvailable", typeof ver.updateAvailable === "boolean");

  // GET /api/stats
  const statsRes = await fetch(`${HTTP_BASE}/api/stats`);
  assert("GET /api/stats 200", statsRes.status === 200);
  const stats = (await statsRes.json()) as { totalInvocations?: number; successCount?: number };
  assert("api/stats has totalInvocations", typeof stats.totalInvocations === "number");
  assert("api/stats has successCount", typeof stats.successCount === "number");

  // GET /api/settings (should return redacted settings)
  const settingsRes = await fetch(`${HTTP_BASE}/api/settings`);
  assert("GET /api/settings 200", settingsRes.status === 200);
  const settings = (await settingsRes.json()) as { tools?: object };
  assert("api/settings has tools key", typeof settings.tools === "object");

  // GET /api/sessions
  const sessionsRes = await fetch(`${HTTP_BASE}/api/sessions`);
  assert("GET /api/sessions 200", sessionsRes.status === 200);
}
