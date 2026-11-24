/**
 * The call log: one SQLite table in one Durable Object (UsageLog), every
 * client's rows in it. Summaries are GROUP BYs over it; rows older than
 * RETENTION_DAYS are deleted as new ones arrive. Writes come from the
 * recorder after each response; reads from the usage tools.
 */

import { z } from "zod";
import { stacks } from "./stacks.js";
import { CallRowSchema, RETENTION_DAYS, UsageLogInputSchema, UsageInputSchema, type CallRow, type Group, type UsageLogInput } from "./schema.js";

/** The SQL calls this module makes (Durable Object `storage.sql`, or node:sqlite in tests). */
export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

const DAY_MS = 86_400_000;
/** Everyone's rows; one client's rows when a name is given. */
export const ALL_CLIENTS = "*";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time INTEGER NOT NULL, client TEXT NOT NULL, call_id TEXT NOT NULL, tool TEXT NOT NULL,
    query TEXT, domain TEXT, store TEXT, search_type TEXT, args TEXT NOT NULL, transport TEXT, backend_id INTEGER,
    status TEXT NOT NULL, error TEXT, cache TEXT, cache_hit INTEGER NOT NULL, attempts INTEGER,
    duration_ms INTEGER NOT NULL, cost_usd REAL NOT NULL, results INTEGER)`,
  // Backends by opaque number: calls keep the number, only admins are shown the name.
  "CREATE TABLE IF NOT EXISTS backends (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)",
  "CREATE INDEX IF NOT EXISTS calls_client_time ON calls (client, time)",
  "CREATE INDEX IF NOT EXISTS calls_time ON calls (time)",
];

export function migrate(sql: SqlLike): void {
  for (const statement of SCHEMA) sql.exec(statement);
}

const nul = (v: unknown) => (v === undefined ? null : v);

function backendId(sql: SqlLike, name: string | undefined): number | null {
  if (!name) return null;
  sql.exec("INSERT OR IGNORE INTO backends (name) VALUES (?)", name);
  const [row] = sql.exec("SELECT id FROM backends WHERE name = ?", name).toArray();
  return row ? Number(row["id"]) : null;
}

export function insertRows(sql: SqlLike, rows: readonly CallRow[], now = Date.now()): void {
  for (const raw of rows) {
    const r = CallRowSchema.parse(raw);
    sql.exec(
      `INSERT INTO calls (time, client, call_id, tool, query, domain, store, search_type, args, transport, backend_id, status, error, cache, cache_hit, attempts, duration_ms, cost_usd, results)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      Date.parse(r.time), r.client, r.call_id, r.tool, nul(r.query), nul(r.domain), nul(r.store), nul(r.search_type), JSON.stringify(r.args), nul(r.transport),
      backendId(sql, r.backend), r.status, nul(r.error), nul(r.cache), r.cache_hit ? 1 : 0, nul(r.attempts), r.duration_ms, r.cost_usd, nul(r.results),
    );
  }
  sql.exec("DELETE FROM calls WHERE time < ?", now - RETENTION_DAYS * DAY_MS);
}

/** UTC midnight `days - 1` days before `now`. */
export const periodStart = (now: number, days: number) => Math.floor(now / DAY_MS) * DAY_MS - (days - 1) * DAY_MS;

function scope(client: string, since: number): { where: string; bindings: unknown[] } {
  return client === ALL_CLIENTS ? { where: "time >= ?", bindings: [since] } : { where: "client = ? AND time >= ?", bindings: [client, since] };
}

const FROM = "calls LEFT JOIN backends ON backends.id = calls.backend_id";
const GROUP_COLUMNS = `COUNT(DISTINCT call_id) AS calls,
  COUNT(DISTINCT CASE WHEN cost_usd > 0 THEN call_id END) AS paid_calls,
  COUNT(DISTINCT CASE WHEN cache_hit = 1 THEN call_id END) AS cache_hits,
  SUM(CASE WHEN status IN ('error', 'failed') THEN 1 ELSE 0 END) AS errors,
  ROUND(COALESCE(SUM(cost_usd), 0), 6) AS cost_usd,
  CAST(COALESCE(AVG(duration_ms), 0) AS INTEGER) AS avg_ms`;

const toGroup = (r: Record<string, unknown>): Group => ({
  key: String(r["key"] ?? ""),
  calls: Number(r["calls"] ?? 0),
  paid_calls: Number(r["paid_calls"] ?? 0),
  cache_hits: Number(r["cache_hits"] ?? 0),
  errors: Number(r["errors"] ?? 0),
  cost_usd: Number(r["cost_usd"] ?? 0),
  avg_ms: Number(r["avg_ms"] ?? 0),
});

function groupBy(sql: SqlLike, by: string, client: string, since: number, order = "cost_usd DESC, calls DESC", limit = 50): Group[] {
  const s = scope(client, since);
  return sql
    .exec(`SELECT ${by} AS key, ${GROUP_COLUMNS} FROM ${FROM} WHERE ${s.where} AND ${by} IS NOT NULL GROUP BY key ORDER BY ${order} LIMIT ${limit}`, ...s.bindings)
    .toArray()
    .map(toGroup);
}

/** Totals and breakdowns for one client (or ALL_CLIENTS) since `since`; backends by name for admins only. */
export function summarize(sql: SqlLike, client: string, since: number, admin = false) {
  const s = scope(client, since);
  const [row = {}] = sql.exec(`SELECT 'all' AS key, ${GROUP_COLUMNS}, COALESCE(MAX(duration_ms), 0) AS max_ms FROM calls WHERE ${s.where}`, ...s.bindings).toArray();
  const totals = toGroup(row);
  return {
    totals: { ...totals, cache_hit_rate: totals.calls ? Math.round((totals.cache_hits / totals.calls) * 1000) / 1000 : 0, max_ms: Number(row["max_ms"] ?? 0) },
    by_day: groupBy(sql, "strftime('%Y-%m-%d', time / 1000, 'unixepoch')", client, since, "key DESC", RETENTION_DAYS),
    by_tool: groupBy(sql, "tool", client, since),
    by_domain: groupBy(sql, "domain", client, since),
    by_store: groupBy(sql, "store", client, since),
    by_backend: groupBy(sql, admin ? "backends.name" : "CAST(backend_id AS TEXT)", client, since),
    by_search_type: groupBy(sql, "search_type", client, since),
    ...(client === ALL_CLIENTS ? { by_client: groupBy(sql, "client", client, since) } : {}),
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** The newest rows matching the filters. */
export function readLog(sql: SqlLike, client: string, input: UsageLogInput, now = Date.now(), admin = false): { calls: CallRow[]; more: boolean } {
  const s = scope(client, periodStart(now, input.days));
  const where = [s.where];
  const bindings = [...s.bindings];
  const add = (clause: string, ...values: unknown[]) => {
    where.push(clause);
    bindings.push(...values);
  };
  if (input.tool) add("tool = ?", input.tool);
  if (input.domain) add("(domain = ? OR domain = ?)", bare(input.domain), `www.${bare(input.domain)}`);
  if (input.store) add("store = ?", input.store);
  if (input.search_type) add("search_type = ?", input.search_type);
  if (input.query) add("query LIKE ? ESCAPE '\\'", `%${escapeLike(input.query)}%`);
  if (input.paid_only) where.push("cost_usd > 0");
  if (input.errors_only) where.push("status IN ('error', 'failed')");
  if (input.cache_hits_only) where.push("cache_hit = 1");
  const rows = sql.exec(`SELECT calls.*, backends.name AS backend FROM ${FROM} WHERE ${where.join(" AND ")} ORDER BY calls.id DESC LIMIT ?`, ...bindings, input.limit + 1).toArray();
  return { calls: rows.slice(0, input.limit).map((r) => fromSql(r, admin)), more: rows.length > input.limit };
}

function fromSql(r: Record<string, unknown>, admin: boolean): CallRow {
  const opt = (k: string) => (r[k] === null || r[k] === undefined ? {} : { [k]: r[k] });
  return CallRowSchema.parse({
    time: new Date(Number(r["time"])).toISOString(),
    client: r["client"],
    call_id: r["call_id"],
    tool: r["tool"],
    ...opt("query"),
    ...opt("domain"),
    ...opt("store"),
    ...opt("search_type"),
    args: JSON.parse(String(r["args"] ?? "{}")) as unknown,
    ...opt("transport"),
    ...opt("backend_id"),
    ...(admin ? opt("backend") : {}),
    status: r["status"],
    ...opt("error"),
    ...opt("cache"),
    cache_hit: r["cache_hit"] === 1,
    ...opt("attempts"),
    duration_ms: r["duration_ms"],
    cost_usd: r["cost_usd"],
    ...opt("results"),
  });
}

export const LogPath = { Add: "/add", Summary: "/summary", Log: "/log", Stacks: "/stacks" } as const;
const AddSchema = z.object({ rows: z.array(CallRowSchema).min(1).max(100) });
const SummarySchema = UsageInputSchema.extend({ client: z.string().min(1).max(64), now: z.number(), admin: z.boolean().default(false) });
const LogSchema = UsageLogInputSchema.extend({ client: z.string().min(1).max(64), now: z.number(), admin: z.boolean().default(false) });

/** The Durable Object: one instance (named "calls") for every client. */
export class UsageLog {
  constructor(private readonly state: { storage: { sql: SqlLike } }) {
    migrate(state.storage.sql);
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body = await request.json().catch(() => undefined);
    const sql = this.state.storage.sql;
    if (path === LogPath.Add) {
      const add = AddSchema.safeParse(body);
      if (!add.success) return new Response("bad rows", { status: 400 });
      insertRows(sql, add.data.rows);
      return Response.json({ ok: true });
    }
    if (path === LogPath.Summary) {
      const q = SummarySchema.safeParse(body);
      return q.success ? Response.json(summarize(sql, q.data.client, periodStart(q.data.now, q.data.days), q.data.admin)) : new Response("bad query", { status: 400 });
    }
    if (path === LogPath.Stacks) {
      const q = SummarySchema.safeParse(body);
      return q.success ? Response.json(stacks(sql, periodStart(q.data.now, q.data.days))) : new Response("bad query", { status: 400 });
    }
    if (path === LogPath.Log) {
      const q = LogSchema.safeParse(body);
      return q.success ? Response.json(readLog(sql, q.data.client, q.data, q.data.now, q.data.admin)) : new Response("bad query", { status: 400 });
    }
    return new Response("not found", { status: 404 });
  }
}
