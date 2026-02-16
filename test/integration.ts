/**
 * mcpy integration test
 *
 * Builds from source, then tests everything end-to-end:
 *   - Install command (binary copy + config registration)
 *   - MCP stdio protocol (connect, list tools)
 *   - All tool groups (todo, memory, mcpy, packages, github, fetch)
 *   - HTTP REST API
 *   - Web UI serving
 */
import { join } from "path";
import { existsSync } from "fs";
import { suite, assert, summary } from "./lib/harness.ts";
import { connect, disconnect, getClient } from "./lib/mcp.ts";

// Tool tests
import { testTodo } from "./tools/todo.ts";
import { testMemory } from "./tools/memory.ts";
import { testMcpy } from "./tools/mcpy.ts";
import { testPackages } from "./tools/packages.ts";
import { testFetch } from "./tools/fetch.ts";
import { testGithub } from "./tools/github.ts";
import { testLib } from "./tools/lib.ts";

// Suite tests
import { testInstall } from "./suites/install.ts";
import { testHttp, waitForHttp } from "./suites/http.ts";
import { testUi } from "./suites/ui.ts";

// The binary compiled from source at /app/mcpy
const BINARY = join(import.meta.dir, "..", "mcpy");

async function main() {
  console.log("\n=== mcpy integration test ===\n");

  // --- Build verification ---
  suite("build");
  assert("compiled binary exists", existsSync(BINARY));

  const proc = Bun.spawn([BINARY, "version"], { stdout: "pipe", stderr: "pipe" });
  const version = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  assert("version command works", /\d+\.\d+\.\d+/.test(version), version);
  console.log("");

  // --- Install ---
  await testInstall(BINARY);
  console.log("");

  // --- MCP connection ---
  suite("mcp");
  const client = await connect(BINARY);
  assert("connected via stdio", true);

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  assert("listTools returns tools", names.length > 0, `count: ${names.length}`);
  for (const name of ["todo_list", "memory", "mcpy_stats", "mcpy_log", "npm_info", "pypi_info", "web_fetch_text", "web_fetch_raw", "web_http_headers", "web_grep", "web_fetch_binary"]) {
    assert(`tool registered: ${name}`, names.includes(name));
  }
  console.log("");

  // --- Unit tests (no MCP/HTTP needed) ---
  await testLib();
  console.log("");

  // --- Tool tests (MCP only) ---
  await testTodo();
  console.log("");

  await testMemory();
  console.log("");

  await testMcpy();
  console.log("");

  await testPackages();
  console.log("");

  await testGithub();
  console.log("");

  // --- HTTP API (server starts as side effect of MCP connection) ---
  const httpReady = await waitForHttp();
  if (httpReady) {
    // Web fetch tests need HTTP server for JSON endpoint tests
    await testFetch();
    console.log("");

    await testHttp();
    console.log("");

    await testUi();
    console.log("");
  } else {
    suite("http");
    assert("HTTP server reachable", false);
    console.log("");
  }

  // --- Cleanup ---
  await disconnect();

  // --- Summary ---
  const { failed } = summary();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
