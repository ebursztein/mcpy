/**
 * The usage front doors: the `usage` and `usage_log` MCP tools and the
 * /v1/usage and /v1/usage/log REST routes, over the call log (log.ts). A
 * client sees its own calls; an admin may name another client, or * for all.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { ErrorCode, McpyError } from "mcpy";
import { z } from "zod";
import { secondsUntilReset, spendingReport, spentToday, type BudgetNamespaceLike, type BudgetStub } from "../budget.js";
import { ClientRole, type Client } from "../clients.js";
import { ALL_CLIENTS, LogPath, periodStart } from "./log.js";
import { UsageInputSchema, UsageLogInputSchema, UsageLogResultSchema, UsageResultSchema, type CallRow, type UsageLogResult, type UsageResult } from "./schema.js";

export const UsageRoute = { Summary: "/v1/usage", Log: "/v1/usage/log", Dashboard: "/v1/admin/dashboard" } as const;
export const UsageTool = { Summary: "usage", Log: "usage_log" } as const;
/** The single UsageLog object's name. */
const LOG_OBJECT = "calls";
const ORIGIN = "https://usage.internal";

export interface UsageDeps {
  log: BudgetNamespaceLike;
  /** Default daily cap and per-client overrides, for the dashboard's spend-against-cap view. */
  caps?: { defaultCap: number | undefined; overrides: ReadonlyMap<string, number | undefined> };
  /** For today's spend against the cap; absent without the BUDGET binding. */
  budget?: BudgetNamespaceLike;
  /** Every configured client name (an admin may only ask about these). */
  clients: readonly string[];
  capFor: (client: string) => number | undefined;
  now?: () => Date;
}

const logObject = (ns: BudgetNamespaceLike): BudgetStub => ns.get(ns.idFromName(LOG_OBJECT) as never);

async function ask(ns: BudgetNamespaceLike, path: string, body: unknown): Promise<unknown> {
  const response = await logObject(ns).fetch(new Request(`${ORIGIN}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
  if (!response.ok) throw new Error(`usage log answered HTTP ${response.status}`);
  return response.json();
}

/** Append one call's rows (the recorder's writer). */
export async function writeRows(ns: BudgetNamespaceLike, rows: CallRow[]): Promise<void> {
  if (rows.length) await ask(ns, LogPath.Add, { rows });
}

function whose(caller: Client, asked: string | undefined, deps: UsageDeps): string {
  if (asked === undefined || asked === caller.name) return caller.name;
  if (caller.role !== ClientRole.Admin) throw new McpyError(ErrorCode.Forbidden, "only admin clients can see another client's usage");
  if (asked !== ALL_CLIENTS && !deps.clients.includes(asked)) throw new McpyError(ErrorCode.NotFound, `no client named ${asked}`);
  return asked;
}

function parse<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  throw new McpyError(ErrorCode.InvalidInput, "invalid input", r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`));
}

const round = (usd: number) => Math.round(usd * 10_000) / 10_000;

export async function usageSummary(caller: Client, raw: unknown, deps: UsageDeps): Promise<UsageResult> {
  const input = parse(UsageInputSchema, raw);
  const client = whose(caller, input.client, deps);
  const now = deps.now?.() ?? new Date();
  const summary = (await ask(deps.log, LogPath.Summary, { ...input, client, now: now.getTime(), admin: caller.role === ClientRole.Admin })) as object;
  let today: UsageResult["today"];
  if (client !== ALL_CLIENTS && deps.budget) {
    const spent = await spentToday(deps.budget, client, now);
    const cap = deps.capFor(client);
    today = { spent_usd: round(spent), ...(cap !== undefined ? { cap_usd: cap, remaining_usd: round(Math.max(0, cap - spent)) } : {}), resets_in_seconds: secondsUntilReset(now) };
  }
  return UsageResultSchema.parse({ client, since: new Date(periodStart(now.getTime(), input.days)).toISOString(), ...(today ? { today } : {}), ...summary });
}

export async function usageLogFor(caller: Client, raw: unknown, deps: UsageDeps): Promise<UsageLogResult> {
  const input = parse(UsageLogInputSchema, raw);
  const client = whose(caller, input.client, deps);
  const found = (await ask(deps.log, LogPath.Log, { ...input, client, now: (deps.now?.() ?? new Date()).getTime(), admin: caller.role === ClientRole.Admin })) as object;
  return UsageLogResultSchema.parse({ client, ...found });
}

/** Admin only: every client's usage, the stacked breakdowns and today's spend against each cap. */
export async function dashboardData(caller: Client, raw: unknown, deps: UsageDeps): Promise<unknown> {
  if (caller.role !== ClientRole.Admin) throw new McpyError(ErrorCode.Forbidden, "admin only");
  const input = parse(UsageInputSchema.omit({ client: true }), raw);
  const now = deps.now?.() ?? new Date();
  const [summary, stacks, spending] = await Promise.all([
    usageSummary(caller, { days: input.days, client: ALL_CLIENTS }, deps),
    ask(deps.log, LogPath.Stacks, { days: input.days, client: ALL_CLIENTS, now: now.getTime() }),
    deps.budget && deps.caps ? spendingReport(deps.budget, deps.clients, deps.caps.defaultCap, deps.caps.overrides, now) : undefined,
  ]);
  return { days: input.days, summary, stacks, ...(spending ? { spending } : {}) };
}

const usd = (n: number) => `$${n.toFixed(4)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function renderUsage(r: UsageResult): string {
  const t = r.totals;
  const lines = [`${r.client} since ${r.since.slice(0, 10)}: ${t.calls} calls, ${t.paid_calls} paid, cache hit rate ${pct(t.cache_hit_rate)}, ${t.errors} errors, ${usd(t.cost_usd)}, avg ${t.avg_ms} ms (max ${t.max_ms})`];
  if (r.today) {
    const cap = r.today.cap_usd === undefined ? "no cap" : `cap ${usd(r.today.cap_usd)}, ${usd(r.today.remaining_usd ?? 0)} left`;
    lines.push(`today: spent ${usd(r.today.spent_usd)} (${cap}, resets in ${Math.round(r.today.resets_in_seconds / 60)} min)`);
  }
  const section = (title: string, groups: UsageResult["by_tool"]) => {
    if (!groups.length) return;
    lines.push(`\n${title}:`);
    for (const g of groups.slice(0, 20)) lines.push(`  ${g.key}: ${g.calls} calls, ${g.paid_calls} paid, ${g.cache_hits} cached, ${g.errors} errors, ${usd(g.cost_usd)}, avg ${g.avg_ms} ms`);
  };
  section("by tool", r.by_tool);
  section("by domain", r.by_domain);
  section("by store", r.by_store);
  section("by backend", r.by_backend);
  section("by search type", r.by_search_type);
  if (r.by_client) section("by client", r.by_client);
  if (r.by_day.length > 1) section("by day", r.by_day);
  return lines.join("\n");
}

export function renderUsageLog(r: UsageLogResult): string {
  if (r.calls.length === 0) return `${r.client}: no matching calls`;
  const lines = r.calls.map((c) =>
    [c.time, r.client === ALL_CLIENTS ? c.client : "", c.tool, c.store ?? c.search_type ?? "", c.status + (c.error ? ` (${c.error})` : ""), usd(c.cost_usd), c.cache_hit ? "cache" : `${c.attempts ?? 0} attempts`, c.backend ?? (c.backend_id !== undefined ? `backend ${c.backend_id}` : ""), `${c.duration_ms} ms`, c.domain ?? "", c.query ?? ""]
      .filter(Boolean)
      .join("  "),
  );
  return [`${r.client}: ${r.calls.length} rows, newest first${r.more ? " (older ones exist)" : ""}`, ...lines].join("\n");
}

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const ok = (result: object, text: string): ToolResult => ({ content: [{ type: "text", text }], structuredContent: result as Record<string, unknown> });
const fail = (err: unknown): ToolResult => {
  const e = err instanceof McpyError ? err : new McpyError(ErrorCode.Internal, "internal error");
  return { content: [{ type: "text", text: JSON.stringify(e.toJSON()) }], isError: true };
};
const OWN_DATA = { readOnlyHint: true, openWorldHint: false } as const;

export function registerUsageTools(server: McpServer, caller: Client, deps: UsageDeps): void {
  server.registerTool(
    UsageTool.Summary,
    {
      title: "Usage",
      description:
        "Your mcpy usage over the last days: calls, paid calls, cache hit rate, errors, cost and time taken, by tool, domain, store, search type and day, plus today's spend against your daily cap. Use it to see what costs money.",
      inputSchema: UsageInputSchema,
      outputSchema: UsageResultSchema,
      annotations: OWN_DATA,
    },
    async (input) => usageSummary(caller, input, deps).then((r) => ok(r, renderUsage(r)), fail),
  );
  server.registerTool(
    UsageTool.Log,
    {
      title: "Usage Log",
      description:
        "Your latest mcpy calls, newest first, one row per call (per store for shopping_search): tool, query (URL or search text), args, domain, store, status, cost, cache hit, attempts and time taken. Filter by tool, domain, store, search_type, query text, paid_only, errors_only or cache_hits_only.",
      inputSchema: UsageLogInputSchema,
      outputSchema: UsageLogResultSchema,
      annotations: OWN_DATA,
    },
    async (input) => usageLogFor(caller, input, deps).then((r) => ok(r, renderUsageLog(r)), fail),
  );
}
