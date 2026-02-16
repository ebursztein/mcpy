/**
 * Tests for developer/npm tools: npm_info, npm_search, npm_versions, npm_readme.
 * Requires network access.
 */
import { suite, assert } from "../lib/harness.ts";
import { call } from "../lib/mcp.ts";

export async function testNpm() {
  suite("npm");

  // --- npm_info ---

  const npmRes = await call("npm_info", { package_name: "zod" });
  assert("info returns package name", npmRes.includes("zod"));
  assert("info has license", npmRes.includes("License:"));
  assert("info has downloads", npmRes.includes("Weekly downloads:"));
  assert("info has description", npmRes.includes("validation"));
  assert("info has dist-tags", npmRes.includes("Dist-tags:"));
  assert("info has published date", npmRes.includes("Published:"));
  assert("info has total versions", npmRes.includes("Total versions:"));

  const npmVer = await call("npm_info", { package_name: "zod", version: "3.22.0" });
  assert("info specific version", npmVer.includes("3.22.0"));

  const npmEngines = await call("npm_info", { package_name: "typescript" });
  assert("info engines field", npmEngines.includes("Engines:"));

  const npmPeer = await call("npm_info", { package_name: "react-dom" });
  assert("info peer deps", npmPeer.includes("Peer dependencies"));

  const npmKw = await call("npm_info", { package_name: "express" });
  assert("info has keywords", npmKw.includes("Keywords:"));
  assert("info has maintainers", npmKw.includes("Maintainers:"));

  const npmScoped = await call("npm_info", { package_name: "@types/node" });
  assert("info scoped package works", npmScoped.includes("@types/node"));

  const npmMissing = await call("npm_info", { package_name: "this-package-does-not-exist-xyz-123" });
  assert("info missing package returns error", npmMissing.includes("not found"));

  // --- npm_search ---

  const searchRes = await call("npm_search", { query: "zod", size: 3 });
  assert("search has results count", searchRes.includes("Found"));
  assert("search has package entries", searchRes.includes("---"));
  assert("search includes zod", searchRes.includes("zod"));

  const searchPage = await call("npm_search", { query: "react", size: 2, from: 2 });
  assert("search pagination works", searchPage.includes("showing 3-"));

  const searchQualifier = await call("npm_search", { query: "author:sindresorhus", size: 3 });
  assert("search qualifiers work", searchQualifier.includes("Found"));

  // --- npm_versions ---

  const versRes = await call("npm_versions", { package_name: "zod" });
  assert("versions has header", versRes.includes("zod"));
  assert("versions has count", versRes.includes("versions"));
  assert("versions has dist-tags", versRes.includes("Dist-tags:"));
  assert("versions has latest tag", versRes.includes("[latest]"));
  assert("versions has dates", /\d{4}-\d{2}-\d{2}/.test(versRes));

  const versMissing = await call("npm_versions", { package_name: "this-package-does-not-exist-xyz-123" });
  assert("versions missing package errors", versMissing.includes("not found"));

  // --- npm_readme ---

  const readmeRes = await call("npm_readme", { package_name: "zod" });
  assert("readme has header", readmeRes.includes("README: zod"));
  assert("readme has total length", readmeRes.includes("Total length:"));
  assert("readme has content", readmeRes.length > 200);

  const readmePaged = await call("npm_readme", { package_name: "zod", start_index: 100, max_length: 50 });
  assert("readme pagination works", readmePaged.includes("Showing:"));

  const readmeMissing = await call("npm_readme", { package_name: "this-package-does-not-exist-xyz-123" });
  assert("readme missing package errors", readmeMissing.includes("not found"));
}
