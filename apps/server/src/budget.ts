/**
 * Daily spending caps per client. Each client's spend for the current UTC
 * day lives in its own Durable Object (one instance per client name), so
 * every Worker isolate sees the same total. Over its cap, a client keeps
 * the cache and the free sources; paid sources are skipped until midnight
 * UTC. Costs are mcpy's per-call estimates, not provider invoices.
 *
 * A request already in flight when the cap is crossed still finishes, so a
 * client can overshoot by its concurrent requests' cost.
 */

import type { SpendLimit } from "mcpy";
import { z } from "zod";

/** Minimal Durable Object types, so this module also runs under Node tests. */
export interface BudgetStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}
export interface BudgetStub {
  fetch(request: Request): Promise<Response>;
}
export interface BudgetNamespaceLike {
  idFromName(name: string): unknown;
  get(id: never): BudgetStub;
}

const BudgetPath = { Spent: "/spent", Add: "/add" } as const;
const STATE_KEY = "today";
const ORIGIN = "https://budget.internal";

const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const AddSchema = z.object({ day: DaySchema, usd: z.number().positive().max(1_000) });
const SpentSchema = z.object({ usd: z.number().min(0) });
const StateSchema = z.object({ day: DaySchema, usd: z.number().min(0) });

export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** Seconds until the next UTC midnight, when every cap resets. */
export function secondsUntilReset(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1_000));
}

/**
 * One client's running total for one day. Only today's total is kept:
 * history is in Analytics Engine. Adds run one at a time (the runtime's
 * input gate already orders them; the queue makes it explicit), so
 * concurrent requests never lose an update.
 */
export class ClientBudget {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly state: { storage: BudgetStorageLike }) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === BudgetPath.Spent) {
      const day = DaySchema.safeParse(url.searchParams.get("day"));
      if (!day.success) return new Response("bad day", { status: 400 });
      return Response.json({ usd: await this.spent(day.data) });
    }
    if (url.pathname === BudgetPath.Add && request.method === "POST") {
      const body = AddSchema.safeParse(await request.json().catch(() => undefined));
      if (!body.success) return new Response("bad body", { status: 400 });
      const { day, usd } = body.data;
      const add = this.queue.then(async () => {
        const total = (await this.spent(day)) + usd;
        await this.state.storage.put(STATE_KEY, { day, usd: total });
        return total;
      });
      this.queue = add.catch(() => undefined);
      return Response.json({ usd: await add });
    }
    return new Response("not found", { status: 404 });
  }

  private async spent(day: string): Promise<number> {
    const saved = StateSchema.safeParse(await this.state.storage.get(STATE_KEY));
    return saved.success && saved.data.day === day ? saved.data.usd : 0;
  }
}

async function ask(stub: BudgetStub, path: string, body?: unknown): Promise<number> {
  const init = body === undefined ? undefined : { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } };
  const response = await stub.fetch(new Request(`${ORIGIN}${path}`, init));
  if (!response.ok) throw new Error(`budget object answered HTTP ${response.status}`);
  return SpentSchema.parse(await response.json()).usd;
}

function stubFor(ns: BudgetNamespaceLike, client: string): BudgetStub {
  return ns.get(ns.idFromName(client) as never);
}

/** What `client` has spent today, in estimated USD. */
export function spentToday(ns: BudgetNamespaceLike, client: string, now = new Date()): Promise<number> {
  return ask(stubFor(ns, client), `${BudgetPath.Spent}?day=${utcDay(now)}`);
}

/** The SDK's view of one client's cap. */
export function dailySpendLimit(ns: BudgetNamespaceLike, client: string, capUsd: number, now: () => Date = () => new Date()): SpendLimit {
  return {
    allows: async () => (await spentToday(ns, client, now())) < capUsd,
    record: async (usd) => {
      await ask(stubFor(ns, client), BudgetPath.Add, { day: utcDay(now()), usd });
    },
  };
}

/** A client's daily cap in USD, or undefined when it has none. */
export function capFor(client: string, defaultCap: number | undefined, overrides: ReadonlyMap<string, number | undefined>): number | undefined {
  return overrides.has(client) ? overrides.get(client) : defaultCap;
}

export interface SpendingRow {
  client: string;
  /** Undefined: no cap. */
  cap_usd?: number;
  spent_usd: number;
}

/** Today's spend for every configured client (admin view). */
export async function spendingReport(
  ns: BudgetNamespaceLike,
  clients: readonly string[],
  defaultCap: number | undefined,
  overrides: ReadonlyMap<string, number | undefined>,
  now = new Date(),
): Promise<{ day: string; resets_in_seconds: number; clients: SpendingRow[] }> {
  const rows = await Promise.all(
    clients.map(async (client) => ({ client, cap_usd: capFor(client, defaultCap, overrides), spent_usd: round(await spentToday(ns, client, now)) })),
  );
  return { day: utcDay(now), resets_in_seconds: secondsUntilReset(now), clients: rows.sort((a, b) => b.spent_usd - a.spent_usd) };
}

const round = (usd: number) => Math.round(usd * 10_000) / 10_000;
