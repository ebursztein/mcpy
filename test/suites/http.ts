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
  assert("api/tools includes notes_add", toolNames.includes("notes_add"));
  assert("api/tools includes notes_list", toolNames.includes("notes_list"));

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

  // GET /api/clients
  const clientsRes = await fetch(`${HTTP_BASE}/api/clients`);
  assert("GET /api/clients 200", clientsRes.status === 200);
  const clientsData = (await clientsRes.json()) as {
    clients: Array<{ id: string; name: string; configPath: string; configExists: boolean; installed: boolean }>;
    binaryPath: string;
  };
  assert("api/clients has clients array", Array.isArray(clientsData.clients) && clientsData.clients.length > 0);
  assert("api/clients has binaryPath", typeof clientsData.binaryPath === "string" && clientsData.binaryPath.length > 0);

  // Verify all expected client IDs are present
  const clientIds = clientsData.clients.map((c) => c.id);
  assert("api/clients has claude-desktop", clientIds.includes("claude-desktop"));
  assert("api/clients has claude-code", clientIds.includes("claude-code"));
  assert("api/clients has cursor", clientIds.includes("cursor"));
  assert("api/clients has vscode", clientIds.includes("vscode"));
  assert("api/clients has codex", clientIds.includes("codex"));

  // Each client has required fields
  for (const client of clientsData.clients) {
    assert(`api/clients ${client.id} has name`, typeof client.name === "string" && client.name.length > 0);
    assert(`api/clients ${client.id} has configPath`, typeof client.configPath === "string" && client.configPath.length > 0);
  }

  // GET /api/groups
  const groupsRes = await fetch(`${HTTP_BASE}/api/groups`);
  assert("GET /api/groups 200", groupsRes.status === 200);
  const groups = (await groupsRes.json()) as Array<{
    id: string; category: string; label: string; enabledByDefault: boolean;
  }>;
  assert("GET /api/groups returns array", Array.isArray(groups) && groups.length > 0);

  // Verify expected groups exist
  const groupIds = groups.map((g) => g.id);
  assert("api/groups has notes", groupIds.includes("notes"));
  assert("api/groups has mcpy", groupIds.includes("mcpy"));
  assert("api/groups has fetch", groupIds.includes("fetch"));
  assert("api/groups has npm", groupIds.includes("npm"));
  assert("api/groups has pypi", groupIds.includes("pypi"));

  // Groups have required fields
  for (const group of groups) {
    assert(`api/groups ${group.id} has category`, typeof group.category === "string");
    assert(`api/groups ${group.id} has label`, typeof group.label === "string");
    assert(`api/groups ${group.id} has enabledByDefault`, typeof group.enabledByDefault === "boolean");
  }
}
