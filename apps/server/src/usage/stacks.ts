/**
 * Two-way breakdowns of the call log for the dashboard's stacked charts:
 * calls and cost per (client, tool) and per (day, tool), every client.
 */

import type { SqlLike } from "./log.js";

export interface Cell {
  /** The bar: a client name or a UTC day. */
  bar: string;
  /** The stack segment: a tool. */
  part: string;
  calls: number;
  cost_usd: number;
}

const DAY = "strftime('%Y-%m-%d', time / 1000, 'unixepoch')";

function cells(sql: SqlLike, bar: string, since: number): Cell[] {
  return sql
    .exec(
      `SELECT ${bar} AS bar, tool AS part, COUNT(DISTINCT call_id) AS calls, ROUND(COALESCE(SUM(cost_usd), 0), 6) AS cost_usd
       FROM calls WHERE time >= ? GROUP BY bar, part ORDER BY bar, part`,
      since,
    )
    .toArray()
    .map((r) => ({ bar: String(r["bar"]), part: String(r["part"]), calls: Number(r["calls"] ?? 0), cost_usd: Number(r["cost_usd"] ?? 0) }));
}

/** Every client's calls and cost by tool, and each day's by tool, since `since`. */
export function stacks(sql: SqlLike, since: number): { client_tool: Cell[]; day_tool: Cell[] } {
  return { client_tool: cells(sql, "client", since), day_tool: cells(sql, DAY, since) };
}
