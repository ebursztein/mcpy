/**
 * Tests for developer/pypi tools: pypi_info, pypi_versions, pypi_readme.
 * Requires network access.
 */
import { suite, assert } from "../lib/harness.ts";
import { call } from "../lib/mcp.ts";

export async function testPypi() {
  suite("pypi");

  // --- pypi_info ---

  const pypiRes = await call("pypi_info", { package_name: "requests" });
  assert("info returns package name", pypiRes.includes("requests"));
  assert("info has author", pypiRes.includes("Author:"));
  assert("info has license", pypiRes.includes("License:"));
  assert("info has python requires", pypiRes.includes("Python requires:"));
  assert("info has dependencies", pypiRes.includes("Dependencies"));
  assert("info has total versions", pypiRes.includes("Total versions:"));
  assert("info has package size", pypiRes.includes("Package size:"));
  assert("info has distributions", pypiRes.includes("Distributions:"));

  const pypiVer = await call("pypi_info", { package_name: "requests", version: "2.31.0" });
  assert("info specific version", pypiVer.includes("2.31.0"));

  const pypiLinks = await call("pypi_info", { package_name: "flask" });
  assert("info has links section", pypiLinks.includes("Links:"));

  const pypiDjango = await call("pypi_info", { package_name: "django" });
  assert("info django has author", pypiDjango.includes("Author:"));
  assert("info django has published date", pypiDjango.includes("Published:"));

  const pypiMissing = await call("pypi_info", { package_name: "this-package-does-not-exist-xyz-123" });
  assert("info missing package returns error", pypiMissing.includes("not found"));

  // --- pypi_versions ---

  const versRes = await call("pypi_versions", { package_name: "requests" });
  assert("versions has header", versRes.includes("requests"));
  assert("versions has count", versRes.includes("versions"));
  assert("versions has latest label", versRes.includes("Latest:"));
  assert("versions has latest tag", versRes.includes("[latest]"));
  assert("versions has dates", /\d{4}-\d{2}-\d{2}/.test(versRes));
  assert("versions has dist types", versRes.includes("sdist") || versRes.includes("bdist_wheel"));

  const versMissing = await call("pypi_versions", { package_name: "this-package-does-not-exist-xyz-123" });
  assert("versions missing package errors", versMissing.includes("not found"));

  // --- pypi_readme ---

  const readmeRes = await call("pypi_readme", { package_name: "requests" });
  assert("readme has header", readmeRes.includes("README: requests"));
  assert("readme has content type", readmeRes.includes("text/"));
  assert("readme has total length", readmeRes.includes("Total length:"));
  assert("readme has content", readmeRes.length > 200);

  const readmePaged = await call("pypi_readme", { package_name: "requests", start_index: 100, max_length: 50 });
  assert("readme pagination works", readmePaged.includes("Showing:"));

  const readmeVersion = await call("pypi_readme", { package_name: "requests", version: "2.31.0" });
  assert("readme specific version works", readmeVersion.includes("README: requests@2.31.0"));

  const readmeMissing = await call("pypi_readme", { package_name: "this-package-does-not-exist-xyz-123" });
  assert("readme missing package errors", readmeMissing.includes("not found"));
}
