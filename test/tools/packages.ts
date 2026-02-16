/**
 * Tests for developer/packages tools: npm_info, pypi_info.
 * Requires network access.
 */
import { suite, assert } from "../lib/harness.ts";
import { call } from "../lib/mcp.ts";

export async function testPackages() {
  suite("packages");

  // npm_info -- well-known package
  const npmRes = await call("npm_info", { package_name: "zod" });
  assert("npm_info returns package name", npmRes.includes("zod"));
  assert("npm_info has license", npmRes.includes("License:"));
  assert("npm_info has downloads", npmRes.includes("Weekly downloads:"));
  assert("npm_info has description", npmRes.includes("validation"));

  // npm_info -- specific version
  const npmVer = await call("npm_info", { package_name: "zod", version: "3.22.0" });
  assert("npm_info specific version", npmVer.includes("3.22.0"));

  // npm_info -- nonexistent package
  const npmMissing = await call("npm_info", { package_name: "this-package-does-not-exist-xyz-123" });
  assert("npm_info missing package returns error", npmMissing.includes("not found"));

  // pypi_info -- well-known package
  const pypiRes = await call("pypi_info", { package_name: "requests" });
  assert("pypi_info returns package name", pypiRes.includes("requests"));
  assert("pypi_info has author", pypiRes.includes("Author:"));
  assert("pypi_info has license", pypiRes.includes("License:"));

  // pypi_info -- nonexistent package
  const pypiMissing = await call("pypi_info", { package_name: "this-package-does-not-exist-xyz-123" });
  assert("pypi_info missing package returns error", pypiMissing.includes("not found"));
}
