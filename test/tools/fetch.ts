/**
 * Tests for web tools: web_fetch_text, web_fetch_raw, web_http_headers, web_grep.
 * Requires network access + HTTP server running.
 */
import { suite, assert } from "../lib/harness.ts";
import { call } from "../lib/mcp.ts";
import { HTTP_BASE } from "../lib/harness.ts";

export async function testFetch() {
  suite("web");

  // --- web_fetch_text ---

  // HTML page -- Readability extraction
  const fetchRes = await call("web_fetch_text", { url: "https://example.com" });
  assert("fetch_text returns URL", fetchRes.includes("URL:"));
  assert("fetch_text extracts content", fetchRes.includes("Example Domain"));
  assert("fetch_text has total length", fetchRes.includes("Total length:"));
  assert("fetch_text has Title for HTML", fetchRes.includes("Title:"));

  // JSON endpoint -- should skip Readability, return raw JSON
  const jsonRes = await call("web_fetch_text", { url: `${HTTP_BASE}/api/version` });
  assert("fetch_text JSON returns data", jsonRes.includes("current"));
  assert("fetch_text JSON has Content-Type", jsonRes.includes("Content-Type:") || jsonRes.includes("application/json"));

  // Pagination
  const p1 = await call("web_fetch_text", { url: "https://example.com", max_length: 50, start_index: 0 });
  assert("fetch_text pagination has range", p1.includes("Showing:"));
  assert("fetch_text pagination has more", p1.includes("Has more: true"));

  const p2 = await call("web_fetch_text", { url: "https://example.com", max_length: 50, start_index: 50 });
  assert("fetch_text page 2 differs", p2 !== p1);

  // Bad URL
  const badUrl = await call("web_fetch_text", { url: "https://this-domain-does-not-exist-xyz.invalid" });
  assert("fetch_text bad url errors", badUrl.includes("Failed") || badUrl.includes("fetch"));

  // --- web_fetch_raw ---

  const rawRes = await call("web_fetch_raw", { url: "https://example.com" });
  assert("fetch_raw has html tags", rawRes.includes("<"));
  assert("fetch_raw has doctype or html tag", rawRes.toLowerCase().includes("<!doctype") || rawRes.toLowerCase().includes("<html"));
  assert("fetch_raw has URL header", rawRes.includes("URL:"));
  assert("fetch_raw has total length", rawRes.includes("Total length:"));

  // Raw pagination
  const rawP = await call("web_fetch_raw", { url: "https://example.com", max_length: 100 });
  assert("fetch_raw pagination has range", rawP.includes("Showing:"));

  // Raw on JSON endpoint -- returns raw JSON string
  const rawJson = await call("web_fetch_raw", { url: `${HTTP_BASE}/api/version` });
  assert("fetch_raw JSON has braces", rawJson.includes("{") && rawJson.includes("}"));

  // --- web_http_headers ---

  const hdr = await call("web_http_headers", { url: "https://example.com" });
  assert("headers has URL", hdr.includes("URL:"));
  assert("headers has Final URL", hdr.includes("Final URL:"));
  assert("headers has status 200", hdr.includes("200"));
  assert("headers has content-type", hdr.toLowerCase().includes("content-type"));

  // Redirect detection
  const redir = await call("web_http_headers", { url: "http://example.com" });
  assert("headers handles redirect", redir.includes("Status:"));

  // GET method
  const hdrGet = await call("web_http_headers", { url: "https://example.com", method: "GET" });
  assert("headers GET method works", hdrGet.includes("Status:"));

  // --- web_grep ---

  // Basic grep on HTML content
  const g1 = await call("web_grep", { url: "https://example.com", pattern: "domain" });
  assert("grep has URL", g1.includes("URL:"));
  assert("grep has matches count", g1.includes("Matches:"));
  assert("grep highlights match line", g1.includes(">>>"));
  assert("grep has line numbers", /\d+ \|/.test(g1));

  // Context lines
  const g0ctx = await call("web_grep", { url: "https://example.com", pattern: "domain", context_lines: 0 });
  assert("grep 0 context works", g0ctx.includes("Matches:"));

  // No match
  const gNone = await call("web_grep", { url: "https://example.com", pattern: "xyznonexistent123" });
  assert("grep no match reports it", gNone.includes("No matches"));

  // Invalid regex
  const gBad = await call("web_grep", { url: "https://example.com", pattern: "[invalid" });
  assert("grep bad regex errors", gBad.includes("Invalid regex"));

  // Raw mode -- finds HTML tags
  const gRaw = await call("web_grep", { url: "https://example.com", pattern: "<title>", raw: true });
  assert("grep raw finds HTML tags", gRaw.includes("Matches:") && !gRaw.includes("No matches"));
  assert("grep raw title shows (raw)", gRaw.includes("(raw)"));

  // Max matches cap
  const gCap = await call("web_grep", { url: "https://example.com", pattern: ".", max_matches: 1 });
  assert("grep max_matches caps", gCap.includes("Matches: 1"));
  assert("grep shows capped indicator", gCap.includes("capped"));

  // Grep on non-HTML (JSON) -- should auto-skip Readability
  const gJson = await call("web_grep", { url: `${HTTP_BASE}/api/version`, pattern: "current" });
  assert("grep JSON auto-detects non-HTML", gJson.includes("Matches:") && !gJson.includes("No matches"));

  // --- web_fetch_binary ---

  // Clean up any leftover test files
  const { unlinkSync } = await import("fs");
  const { join } = await import("path");
  const dlDir = join(process.env.HOME || "~", ".mcpy", "downloads");
  for (const name of ["test-download.html"]) {
    try { unlinkSync(join(dlDir, name)); } catch {}
  }

  // Download a small text file
  const dlRes = await call("web_fetch_binary", { url: "https://example.com" });
  assert("fetch_binary has Downloaded path", dlRes.includes("Downloaded:"));
  assert("fetch_binary has Size", dlRes.includes("Size:"));
  assert("fetch_binary has Content-Type", dlRes.includes("Content-Type:"));
  assert("fetch_binary writes to downloads dir", dlRes.includes("downloads/"));

  // Download with custom filename
  const dlCustom = await call("web_fetch_binary", { url: "https://example.com", filename: "test-download.html" });
  assert("fetch_binary custom filename used", dlCustom.includes("test-download.html"));

  // Bad URL
  const dlBad = await call("web_fetch_binary", { url: "https://this-domain-does-not-exist-xyz.invalid" });
  assert("fetch_binary bad url errors", dlBad.includes("Download failed") || dlBad.includes("fetch"));
}
