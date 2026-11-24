/**
 * /dashboard: KPIs, today's spend against each client's cap, calls and cost
 * by tool, by client stacked by tool, by backend, by store and by domain,
 * and calls per day stacked by tool. Data: GET /v1/admin/dashboard?days=N.
 */

import { page } from "./shared.js";

const SCRIPT = `
var DAYS = [1, 7, 30];
var days = Number(new URLSearchParams(location.search).get("days")) || 7;
var charts = [];
window.addEventListener("resize", function () { charts.forEach(function (c) { c.resize(); }); });

function card(id, title, hint, cls) {
  return '<section class="card ' + (cls || "") + '"><h2>' + esc(title) + '</h2><div class="hint">' + esc(hint) + '</div><div class="chart" id="' + id + '"></div></section>';
}
function kpi(label, value) { return '<div class="card"><div class="metric-label">' + esc(label) + '</div><div class="metric">' + esc(value) + "</div></div>"; }
function draw(id, option) {
  var el = document.getElementById(id);
  if (!el) return;
  if (typeof echarts === "undefined") { el.innerHTML = '<div class="empty">The chart library did not load</div>'; return; }
  var c = echarts.init(el, null, { renderer: "svg" });
  c.setOption(option);
  charts.push(c);
}
/** One color per name everywhere: tools fixed, anything else by a stable hash of its name. */
var TOOL_COLORS = { fetch: PALETTE[0], grep: PALETTE[1], search: PALETTE[2], shopping: PALETTE[3], papers: PALETTE[4], shopping_item: PALETTE[5] };
function colorFor(name) {
  if (TOOL_COLORS[name]) return TOOL_COLORS[name];
  var h = 0;
  for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[6 + (h % (PALETTE.length - 6))];
}
function note(id, text) { document.getElementById(id).innerHTML = '<div class="empty">' + esc(text) + "</div>"; }
function bars(id, groups, field, isMoney, horizontal) {
  var rows = groups.filter(function (g) { return g[field] > 0; }).slice(0, 15);
  if (!groups.length) return note(id, "No calls in this period");
  if (!rows.length) return note(id, "Nothing here cost money in this period");
  var o = baseOption();
  var names = rows.map(function (g) { return g.key; });
  var values = rows.map(function (g) { return g[field]; });
  var fmt = function (v) { return isMoney ? money(v) : num(v); };
  o.legend = { show: false };
  o.grid.top = 8;
  o.tooltip.valueFormatter = fmt;
  if (horizontal) { o.xAxis = axis("value", { axisLabel: { color: INK.faint, fontSize: 12, formatter: fmt } }); o.yAxis = axis("category", { data: names.slice().reverse() }); values = values.slice().reverse(); }
  else { o.xAxis = axis("category", { data: names }); o.yAxis = axis("value", { axisLabel: { color: INK.faint, fontSize: 12, formatter: fmt } }); }
  var ordered = horizontal ? names.slice().reverse() : names;
  o.series = [{ type: "bar", barMaxWidth: 32, itemStyle: { borderRadius: horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0] },
    data: values.map(function (v, i) { return { value: v, itemStyle: { color: colorFor(ordered[i]) } }; }) }];
  draw(id, o);
}
function stacked(id, cells, field, isMoney) {
  if (!cells.length) return note(id, "No calls in this period");
  if (!cells.some(function (c) { return c[field] > 0; })) return note(id, "Nothing here cost money in this period");
  var barsOrder = [], parts = [];
  cells.forEach(function (c) { if (barsOrder.indexOf(c.bar) < 0) barsOrder.push(c.bar); if (parts.indexOf(c.part) < 0) parts.push(c.part); });
  var fmt = function (v) { return isMoney ? money(v) : num(v); };
  var o = baseOption();
  o.tooltip.valueFormatter = fmt;
  o.xAxis = axis("category", { data: barsOrder });
  o.yAxis = axis("value", { axisLabel: { color: INK.faint, fontSize: 12, formatter: fmt } });
  o.series = parts.map(function (p, i) {
    return { name: p, type: "bar", stack: "all", barMaxWidth: 40, emphasis: { focus: "series" }, color: colorFor(p),
      itemStyle: { borderRadius: i === parts.length - 1 ? [6, 6, 0, 0] : 0 },
      data: barsOrder.map(function (b) { var c = cells.find(function (x) { return x.bar === b && x.part === p; }); return c ? c[field] : 0; }) };
  });
  draw(id, o);
}
function caps(spending) {
  if (!spending) return "";
  var rows = spending.clients.map(function (c) {
    var cap = c.cap_usd, pct = cap ? Math.min(100, (c.spent_usd / cap) * 100) : 0;
    return '<div class="cap"><div class="row"><span><b>' + esc(c.client) + "</b></span><span>" + money(c.spent_usd) + (cap !== undefined ? " of " + money(cap) : " (no cap)") + "</span></div>" +
      '<div class="bar"><div class="fill' + (cap && c.spent_usd >= cap ? " over" : "") + '" style="width:' + pct.toFixed(1) + '%"></div></div></div>';
  }).join("");
  return '<section class="card"><h2>Today against each cap</h2><div class="hint">Resets in ' + Math.floor(spending.resets_in_seconds / 3600) + " h " + Math.round((spending.resets_in_seconds % 3600) / 60) + " min (midnight UTC)</div>" + rows + "</section>";
}
function render(d) {
  var s = d.summary, t = s.totals;
  document.getElementById("sub").textContent = "Since " + s.since.slice(0, 10) + " (UTC), every client";
  var tabs = '<nav class="tabs" style="margin-bottom:16px;display:inline-flex">' + DAYS.map(function (n) {
    return '<button data-days="' + n + '"' + (n === days ? ' class="on"' : "") + ">" + (n === 1 ? "Today" : n + " days") + "</button>";
  }).join("") + "</nav>";
  var html = tabs + '<div class="kpis">' + kpi("Calls", num(t.calls)) + kpi("Cost", money(t.cost_usd)) + kpi("Cache hit rate", Math.round(t.cache_hit_rate * 100) + "%") +
    kpi("Paid calls", num(t.paid_calls)) + kpi("Errors", num(t.errors)) + kpi("Avg time", num(t.avg_ms) + " ms") + "</div>";
  html += '<div class="grid">' + caps(d.spending) +
    card("cost-client", "Cost by client", "Stacked by tool") +
    card("calls-tool", "Calls by tool", "Each call once; a shopping search over 5 stores is one call") +
    card("cost-tool", "Cost by tool", "Estimated USD, failed attempts included") +
    card("calls-client", "Calls by client", "Stacked by tool") +
    card("calls-backend", "Calls by backend", "Which backend served each call (cache hits keep the one that first served it)") +
    card("cost-backend", "Cost by backend", "Estimated USD") +
    card("cost-store", "Cost by store", "shopping_search, per store") +
    card("cost-domain", "Cost by domain", "Top 15") +
    (days > 1 ? card("calls-day", "Calls per day", "Stacked by tool", "wide") : "") + "</div>";
  document.getElementById("main").innerHTML = html;
  document.querySelectorAll("[data-days]").forEach(function (b) {
    b.onclick = function () { days = Number(b.getAttribute("data-days")); history.replaceState(null, "", "?days=" + days); start(); };
  });
  charts.forEach(function (c) { c.dispose(); }); charts = [];
  stacked("cost-client", d.stacks.client_tool, "cost_usd", true);
  bars("calls-tool", s.by_tool, "calls", false);
  bars("cost-tool", s.by_tool, "cost_usd", true);
  stacked("calls-client", d.stacks.client_tool, "calls", false);
  bars("calls-backend", s.by_backend, "calls", false);
  bars("cost-backend", s.by_backend, "cost_usd", true);
  bars("cost-store", s.by_store, "cost_usd", true, true);
  bars("cost-domain", s.by_domain, "cost_usd", true, true);
  if (days > 1) stacked("calls-day", d.stacks.day_tool, "calls", false);
}
function start() { load("/v1/admin/dashboard?days=" + days, document.getElementById("main"), render); }
start();
`;

export const DASHBOARD_HTML = page("mcpy dashboard", "dashboard", SCRIPT);
