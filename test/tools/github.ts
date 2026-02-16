/**
 * Tests for GitHub tools: github_search, github_file, github_grep.
 * Requires apiKeys.github to be configured in ~/.mcpy/settings.json.
 * If no token is configured, tests are skipped gracefully.
 */
import { suite, assert } from "../lib/harness.ts";
import { call, getClient } from "../lib/mcp.ts";

export async function testGithub() {
  suite("github");

  // Check if github tools are registered (requires token in settings)
  const tools = await getClient().listTools();
  const names = tools.tools.map((t) => t.name);
  const hasGithub = names.includes("github_file");

  if (!hasGithub) {
    console.log("  SKIP  github tools not registered (no apiKeys.github configured)");
    return;
  }

  assert("tool registered: github_file", names.includes("github_file"));
  assert("tool registered: github_grep", names.includes("github_grep"));
  assert("tool registered: github_search", names.includes("github_search"));

  // --- github_file ---

  // Fetch a known small file
  const readme = await call("github_file", {
    owner: "modelcontextprotocol",
    repo: "servers",
    path: "README.md",
  });
  assert("file has File: header", readme.includes("File:"));
  assert("file has Total: header", readme.includes("Total:"));
  assert("file has content", readme.includes("MCP") || readme.includes("Model Context Protocol"));

  // Pagination: fetch with start_index
  const page2 = await call("github_file", {
    owner: "modelcontextprotocol",
    repo: "servers",
    path: "README.md",
    start_index: 100,
    max_length: 200,
  });
  assert("file pagination shows offset", page2.includes("Showing: 100-"));

  // Non-existent file
  const noFile = await call("github_file", {
    owner: "modelcontextprotocol",
    repo: "servers",
    path: "this-file-does-not-exist.xyz",
  });
  assert("file 404 returns error", noFile.includes("Failed") || noFile.includes("404"));

  // --- github_grep ---

  // Grep for a known pattern
  const grepRes = await call("github_grep", {
    owner: "modelcontextprotocol",
    repo: "servers",
    path: "README.md",
    pattern: "MCP",
  });
  assert("grep has File: header", grepRes.includes("File:"));
  assert("grep has Matches:", grepRes.includes("Matches:"));
  assert("grep highlights match line", grepRes.includes(">>>"));

  // Grep with context_lines=0
  const grepNoCtx = await call("github_grep", {
    owner: "modelcontextprotocol",
    repo: "servers",
    path: "README.md",
    pattern: "MCP",
    context_lines: 0,
  });
  assert("grep 0 context has matches", grepNoCtx.includes("Matches:"));

  // Grep no match
  const grepNone = await call("github_grep", {
    owner: "modelcontextprotocol",
    repo: "servers",
    path: "README.md",
    pattern: "xyzzy_no_match_here_12345",
  });
  assert("grep no match reports it", grepNone.includes("No matches"));

  // Grep bad regex
  const grepBad = await call("github_grep", {
    owner: "modelcontextprotocol",
    repo: "servers",
    path: "README.md",
    pattern: "[invalid",
  });
  assert("grep bad regex errors", grepBad.includes("Invalid regex"));

  // --- github_search ---

  const searchRes = await call("github_search", {
    query: "McpServer language:typescript repo:modelcontextprotocol/typescript-sdk",
    per_page: 3,
  });
  assert("search has results count", searchRes.includes("Found") && searchRes.includes("results"));
  assert("search has repo paths", searchRes.includes("modelcontextprotocol/"));

  // Search with no results
  const searchNone = await call("github_search", {
    query: "xyzzy_unique_gibberish_no_results_12345",
    per_page: 1,
  });
  assert("search 0 results", searchNone.includes("Found 0") || searchNone.includes("0 results"));
}
