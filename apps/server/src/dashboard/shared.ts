/**
 * What the two dashboard pages share: deepmine's look (Inter, slate ink,
 * white cards, Tailwind 500 hues, dashed grid; packages/ui in deepmine) as
 * plain CSS, and the browser code that holds the admin key and loads data.
 * The pages are static: data comes from admin-only JSON routes, with the key
 * the viewer enters, kept in this browser's localStorage.
 *
 * Browser code is plain strings (no template literals inside), so these
 * TypeScript templates never interpolate it by accident.
 */

/** The chart bundle (charts.browser.ts), a static asset of this Worker. */
export const CHARTS_PATH = "/dashboard/charts.js";

export const CSS = `
:root { --bg:#f8fafc; --card:#ffffff; --edge:#e2e8f0; --ink:#0f172a; --body:#475569; --muted:#64748b; --faint:#94a3b8; --track:#f1f5f9;
  --brand:#6366f1; --bad:#f43f5e; --good:#10b981; --warn:#f59e0b; }
@media (prefers-color-scheme: dark) { :root { --bg:#0c111d; --card:#161b26; --edge:#22262f; --ink:#f1f5f9; --body:#cbd5e1; --muted:#cbd5e1; --faint:#94a3b8; --track:#22262f; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/20px Inter, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
a { color:var(--brand); text-decoration:none; font-weight:600; } a:hover { text-decoration:underline; }
.wrap { max-width:1280px; margin:0 auto; padding:24px 16px 48px; }
header { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; margin-bottom:20px; }
h1 { font-size:24px; line-height:32px; font-weight:600; margin:0; letter-spacing:-0.3px; }
.sub { color:var(--muted); font-size:13px; }
.tabs { display:flex; gap:4px; background:var(--track); padding:4px; border-radius:10px; }
.tabs a, .tabs button { padding:6px 12px; border-radius:8px; color:var(--body); font:600 13px Inter, sans-serif; background:none; border:0; cursor:pointer; }
.tabs .on { background:var(--card); color:var(--ink); box-shadow:0 1px 2px rgba(0,0,0,.06); }
.grid { display:grid; gap:16px; grid-template-columns:repeat(2, minmax(0, 1fr)); }
.kpis { display:grid; gap:16px; grid-template-columns:repeat(6, minmax(0, 1fr)); margin-bottom:16px; }
@media (max-width: 1000px) { .kpis { grid-template-columns:repeat(3, minmax(0, 1fr)); } }
@media (max-width: 720px) { .grid { grid-template-columns:1fr; } .kpis { grid-template-columns:repeat(2, minmax(0, 1fr)); } }
.card { background:var(--card); border:1px solid var(--edge); border-radius:12px; padding:20px; box-shadow:0 1px 2px rgba(0,0,0,.05); min-width:0; }
.card.wide { grid-column:1 / -1; }
.card h2 { font-size:14px; font-weight:600; color:var(--ink); margin:0 0 2px; }
.card .hint { color:var(--muted); font-size:12px; margin-bottom:8px; }
.metric-label { color:var(--muted); font-size:13px; font-weight:500; }
.metric { font-size:30px; line-height:38px; font-weight:600; letter-spacing:-0.4px; font-variant-numeric:tabular-nums; margin-top:4px; }
.chart { height:280px; }
.chart.tall { height:340px; }
.cap { margin:10px 0; } .cap .row { display:flex; justify-content:space-between; font-size:13px; color:var(--body); }
.cap .bar { height:8px; background:var(--track); border-radius:99px; overflow:hidden; margin-top:4px; }
.cap .fill { height:100%; background:var(--brand); border-radius:99px; } .cap .fill.over { background:var(--bad); }
.empty { color:var(--muted); padding:32px 0; text-align:center; }
form.key { max-width:420px; margin:80px auto; } input, select { font:14px Inter, sans-serif; color:var(--ink); background:var(--card); border:1px solid var(--edge); border-radius:8px; padding:8px 10px; }
button.primary { font:600 14px Inter, sans-serif; background:var(--brand); color:#fff; border:0; border-radius:8px; padding:9px 14px; cursor:pointer; }
.error { color:var(--bad); margin:12px 0; }
table { width:100%; border-collapse:collapse; font-size:13px; font-variant-numeric:tabular-nums; }
th { text-align:left; color:var(--muted); font-weight:500; padding:8px; border-bottom:1px solid var(--edge); white-space:nowrap; }
td { padding:8px; border-bottom:1px solid var(--edge); color:var(--body); vertical-align:top; }
tr.call { cursor:pointer; } tr.call:hover td { background:var(--track); }
td.q { max-width:360px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ink); }
td:first-child, td:nth-child(8) { white-space:nowrap; }
.pill { display:inline-block; white-space:nowrap; padding:1px 8px; border-radius:99px; font-size:12px; font-weight:500; background:var(--track); color:var(--body); }
.pill.ok { color:var(--good); } .pill.bad { color:var(--bad); } .pill.hit { color:var(--brand); }
pre.args { margin:0; white-space:pre-wrap; word-break:break-all; font:12px ui-monospace, Menlo, monospace; color:var(--body); }
.filters { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:12px; } .filters label { color:var(--body); font-size:13px; display:flex; gap:4px; align-items:center; }
`;

/** Browser helpers: the key, JSON loading, escaping, money, and the chart theme. */
export const CLIENT_JS = `
var KEY_NAME = "mcpy.admin.key";
function getKey() { try { return localStorage.getItem(KEY_NAME) || ""; } catch (e) { return ""; } }
function setKey(k) { try { if (k) localStorage.setItem(KEY_NAME, k); else localStorage.removeItem(KEY_NAME); } catch (e) {} }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function money(n) { n = Number(n || 0); return n === 0 ? "$0" : n < 0.01 ? "$" + n.toFixed(4) : "$" + n.toFixed(2); }
function num(n) { return Number(n || 0).toLocaleString("en-US"); }
function askKey(main, message, then) {
  main.innerHTML = '<form class="key card"><h2>Admin key</h2><div class="hint">Kept in this browser only; sent as a Bearer token to this server.</div>' +
    (message ? '<div class="error">' + esc(message) + "</div>" : "") +
    '<input type="password" name="k" style="width:100%;margin:8px 0 12px" autocomplete="off" placeholder="admin key"><button class="primary">Open</button></form>';
  main.querySelector("form").onsubmit = function (e) { e.preventDefault(); setKey(main.querySelector("input").value.trim()); then(); };
}
function load(path, main, then) {
  var key = getKey();
  if (!key) return askKey(main, "", function () { load(path, main, then); });
  fetch(path, { headers: { Authorization: "Bearer " + key } }).then(function (r) {
    return r.json().then(function (body) { return { status: r.status, body: body }; });
  }).then(function (res) {
    if (res.status === 401 || res.status === 403) { setKey(""); return askKey(main, "That key was refused (admin keys only).", function () { load(path, main, then); }); }
    if (res.status >= 400) { main.innerHTML = '<div class="error">' + esc((res.body.error && res.body.error.message) || "HTTP " + res.status) + "</div>"; return; }
    then(res.body);
  }).catch(function (e) { main.innerHTML = '<div class="error">' + esc(e.message) + "</div>"; });
}
var DARK = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
var INK = DARK ? { strong: "#f1f5f9", body: "#cbd5e1", faint: "#94a3b8", grid: "#22262f", card: "#161b26" } : { strong: "#0f172a", body: "#475569", faint: "#94a3b8", grid: "#e2e8f0", card: "#ffffff" };
var PALETTE = ["#6366f1", "#8b5cf6", "#10b981", "#f43f5e", "#f59e0b", "#f97316", "#eab308", "#3b82f6", "#0ea5e9", "#14b8a6", "#d946ef"];
function baseOption() {
  return {
    color: PALETTE, animation: false,
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: INK.body },
    grid: { left: 8, right: 16, top: 36, bottom: 8, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    legend: { top: 0, left: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: INK.body, fontSize: 12 } },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: INK.card, borderColor: INK.grid, borderWidth: 1, padding: [8, 12],
      textStyle: { color: INK.strong, fontSize: 12 }, extraCssText: "border-radius:10px;box-shadow:0 12px 16px -4px rgba(10,13,18,.08);" }
  };
}
function axis(kind, extra) {
  var a = { type: kind, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: INK.faint, fontSize: 12 },
    splitLine: kind === "value" ? { lineStyle: { color: INK.grid, type: [4, 4] } } : { show: false } };
  for (var k in extra || {}) a[k] = extra[k];
  return a;
}
`;

/** One page: the shared head, a header with the two tabs, and the page's own script. */
export function page(title: string, tab: "dashboard" | "log", script: string): string {
  const on = (t: string) => (t === tab ? ' class="on"' : "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="robots" content="noindex"><style>${CSS}</style></head>
<body><div class="wrap">
<header><div><h1>mcpy usage</h1><div class="sub" id="sub">Every client's calls, cost and cache, from the call log</div></div>
<nav class="tabs"><a href="/dashboard"${on("dashboard")}>Dashboard</a><a href="/dashboard/log"${on("log")}>Call log</a></nav></header>
<main id="main"><div class="empty">Loading…</div></main></div>
<script src="${CHARTS_PATH}"></script>
<script>${CLIENT_JS}${script}</script>
</body></html>`;
}

/** Response headers for the pages: no caching, no framing, scripts only from this server. */
export const PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'",
};
