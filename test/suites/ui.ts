/**
 * Tests for the web UI serving.
 * Assumes the MCP server is already running with ui/build/ adjacent to the binary.
 */
import { suite, assert, HTTP_BASE } from "../lib/harness.ts";

export async function testUi() {
  suite("ui");

  // Main page
  const res = await fetch(`${HTTP_BASE}/`);
  assert("GET / status 200", res.status === 200, `status: ${res.status}`);

  const html = await res.text();
  assert("GET / returns HTML", html.includes("<!") && html.includes("html"));
  assert("GET / has substantial content", html.length > 500, `length: ${html.length}`);

  // Static assets should be served (CSS/JS from the SvelteKit build)
  assert("HTML references app assets", html.includes("/_app/"));

  // SPA routes should return HTML (SvelteKit fallback)
  const toolsPage = await fetch(`${HTTP_BASE}/tools`);
  assert("GET /tools status 200", toolsPage.status === 200);

  const settingsPage = await fetch(`${HTTP_BASE}/settings`);
  assert("GET /settings status 200", settingsPage.status === 200);
}
