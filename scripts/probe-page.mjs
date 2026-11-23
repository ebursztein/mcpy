#!/usr/bin/env node
// Fetches a page through the deployed mcpy (tools.ly.tl, Cloudflare IPs) and saves the raw
// body, so store readers are written against what production actually sees.
// Usage: node scripts/probe-page.mjs <url> <out-file> [--markdown] [--ua chrome|default|mobile]
// Reads MCPY_URL and ELIE_ADMIN_KEY from apps/server/.dev.vars.clients (never printed).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const env = Object.fromEntries(readFileSync(fileURLToPath(new URL("../apps/server/.dev.vars.clients", import.meta.url)), "utf8")
  .split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
const [url, out, ...flags] = process.argv.slice(2);
if (!url || !out) { console.error("usage: probe-page.mjs <url> <out-file> [--markdown] [--ua profile]"); process.exit(2); }
const ua = flags.includes("--ua") ? flags[flags.indexOf("--ua") + 1] : "chrome";
const format = flags.includes("--markdown") ? "markdown" : "html";
const call = async (body) => {
  const res = await fetch(`${env.MCPY_URL}/v1/fetch`, { method: "POST", headers: { authorization: `Bearer ${env.ELIE_ADMIN_KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
};
let offset = 0, version, parts = [], first;
for (let i = 0; i < 60; i++) {
  const r = await call({ url, format, user_agent: ua, max_chars: 50000, offset, ...(version ? { version } : {}) });
  if (r.error) { console.log(JSON.stringify({ error: r.error })); process.exit(1); }
  first ??= r; parts.push(r.content); version = r.version;
  if (r.next_offset == null) break;
  offset = r.next_offset;
}
writeFileSync(out, parts.join(""));
console.log(JSON.stringify({ status: first.status, final_url: first.final_url, title: first.title?.slice(0, 80), chars: first.total_chars, attempts: first.meta.attempts, cache: first.meta.cache }));
