/**
 * /dashboard/log: every client's calls, newest first, filterable; a row
 * opens its args. Data: GET /v1/usage/log?client=*&... (admin key).
 */

import { page } from "./shared.js";

const SCRIPT = `
var TOOLS = ["", "fetch", "grep", "search", "papers", "shopping", "shopping_item"];
var f = new URLSearchParams(location.search);

function field(name, placeholder, width) {
  return '<input name="' + name + '" placeholder="' + placeholder + '" value="' + esc(f.get(name) || "") + '" style="width:' + width + 'px">';
}
function check(name, label) {
  return '<label><input type="checkbox" name="' + name + '"' + (f.get(name) === "true" ? " checked" : "") + "> " + label + "</label>";
}
function filters() {
  return '<form class="filters card" id="filters">' +
    '<select name="tool">' + TOOLS.map(function (t) { return '<option value="' + t + '"' + (f.get("tool") === t ? " selected" : "") + ">" + (t || "every tool") + "</option>"; }).join("") + "</select>" +
    field("client", "client (all)", 120) + field("domain", "domain", 170) + field("store", "store", 120) + field("query", "query contains", 200) +
    '<select name="days">' + [1, 7, 30].map(function (n) { return '<option value="' + n + '"' + (String(n) === (f.get("days") || "7") ? " selected" : "") + ">" + (n === 1 ? "today" : n + " days") + "</option>"; }).join("") + "</select>" +
    check("paid_only", "paid") + check("errors_only", "errors") + check("cache_hits_only", "cache hits") +
    '<button class="primary">Filter</button></form>';
}
function status(c) {
  var cls = c.status === "ok" ? "ok" : c.status === "error" || c.status === "failed" ? "bad" : "";
  return '<span class="pill ' + cls + '">' + esc(c.status + (c.error ? " · " + c.error : "")) + "</span>";
}
function row(c, i) {
  return '<tr class="call" data-i="' + i + '"><td>' + esc(c.time.replace("T", " ").slice(5, 19)) + "</td><td>" + esc(c.client) + "</td><td>" + esc(c.tool) + "</td><td>" + esc(c.store || c.search_type || "") +
    '</td><td class="q" title="' + esc(c.query || "") + '">' + esc(c.query || "") + "</td><td>" + esc(c.domain || "") + "</td><td>" + esc(c.backend || (c.backend_id != null ? "#" + c.backend_id : "")) +
    "</td><td>" + status(c) + "</td><td>" + (c.cache_hit ? '<span class="pill hit">hit</span>' : esc(c.attempts != null ? c.attempts : "")) + "</td><td>" + num(c.duration_ms) + "</td><td>" + money(c.cost_usd) + "</td></tr>";
}
function render(d) {
  document.getElementById("sub").textContent = d.calls.length + " calls, newest first" + (d.more ? " (older ones match too: narrow the filters or raise the limit)" : "");
  var head = "<tr><th>Time (UTC)</th><th>Client</th><th>Tool</th><th>Store / type</th><th>Query</th><th>Domain</th><th>Backend</th><th>Status</th><th>Attempts</th><th>ms</th><th>Cost</th></tr>";
  var body = d.calls.length ? d.calls.map(row).join("") : '<tr><td colspan="11" class="empty">No matching calls</td></tr>';
  document.getElementById("main").innerHTML = filters() + '<div class="card" style="overflow-x:auto"><table>' + head + body + "</table></div>";
  document.getElementById("filters").onsubmit = function (e) {
    e.preventDefault();
    var q = new URLSearchParams();
    new FormData(e.target).forEach(function (v, k) { if (v) q.set(k, v === "on" ? "true" : String(v)); });
    location.search = q.toString();
  };
  document.querySelectorAll("tr.call").forEach(function (tr) {
    tr.onclick = function () {
      var next = tr.nextElementSibling;
      if (next && next.classList.contains("args")) { next.remove(); return; }
      var c = d.calls[Number(tr.getAttribute("data-i"))];
      var extra = document.createElement("tr");
      extra.className = "args";
      extra.innerHTML = '<td colspan="11"><pre class="args">' + esc(JSON.stringify({ query: c.query, args: c.args, call_id: c.call_id, transport: c.transport, results: c.results }, null, 2)) + "</pre></td>";
      tr.after(extra);
    };
  });
}
var q = new URLSearchParams(f);
if (!q.get("client")) q.set("client", "*");
if (!q.get("days")) q.set("days", "7");
q.set("limit", q.get("limit") || "200");
load("/v1/usage/log?" + q.toString(), document.getElementById("main"), render);
`;

export const LOG_HTML = page("mcpy call log", "log", SCRIPT);
