/**
 * Tests for mcpy agent tools: mcpy_stats, mcpy_log, mcpy_update.
 * (mcpy_restart is skipped -- it kills the process.)
 */
import { suite, assert } from "../lib/harness.ts";
import { call } from "../lib/mcp.ts";

export async function testMcpy() {
  suite("mcpy");

  // mcpy_stats
  const stats = await call("mcpy_stats", {});
  assert("stats has header", stats.includes("mcpy server stats"));
  assert("stats has version", stats.includes("version:"));
  assert("stats has pid", stats.includes("pid:"));
  assert("stats has uptime", stats.includes("uptime:"));
  assert("stats has compiled flag", stats.includes("compiled:"));
  assert("stats has platform", stats.includes("platform:"));
  assert("stats has memory", stats.includes("RSS"));
  assert("stats has invocation counts", stats.includes("total invocations:"));

  // mcpy_log tail
  const logTail = await call("mcpy_log", { action: "tail", lines: 5 });
  assert("log tail returns content", logTail.includes("mcpy.log"));

  // mcpy_log read
  const logRead = await call("mcpy_log", { action: "read" });
  assert("log read returns content", logRead.length > 0);

  // mcpy_update check (apply=false, default)
  const updateCheck = await call("mcpy_update", { apply: false });
  // Either "up to date" or "Update available" -- both are valid
  const isValidResponse = updateCheck.includes("up to date") || updateCheck.includes("Update available");
  assert("update check returns status", isValidResponse, updateCheck.slice(0, 80));

  // mcpy_restart with confirm=false should refuse
  const restartRefused = await call("mcpy_restart", { confirm: false });
  assert("restart refuses without confirm", restartRefused.includes("confirm=true"));
}
