import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBodySchema, ErrorCode, RestRoute } from "mcpy";
import { capFor, ClientBudget, dailySpendLimit, secondsUntilReset, spentToday, type BudgetNamespaceLike } from "../../src/budget.js";
import { loadEnv } from "../../src/env.js";
import { AdminRoute } from "../../src/rest.js";
import { fixture } from "../../../../packages/mcpy/test/helpers.js";
import { ADMIN_KEY, articleUrl, call, makeEnv, stubNetwork } from "./harness.js";

/** Real ClientBudget objects over in-memory storage, one per client name. */
function budgetNamespace(): BudgetNamespaceLike & { objects: Map<string, ClientBudget> } {
  const objects = new Map<string, ClientBudget>();
  return {
    objects,
    idFromName: (name) => name,
    get(id) {
      const name = id as unknown as string;
      if (!objects.has(name)) {
        const data = new Map<string, unknown>();
        objects.set(name, new ClientBudget({ storage: { get: async <T>(k: string) => data.get(k) as T | undefined, put: async (k, v) => void data.set(k, v) } }));
      }
      const object = objects.get(name)!;
      return { fetch: (request: Request) => object.fetch(request) };
    },
  };
}

describe("ClientBudget", () => {
  it("adds up spending per day and starts at zero on a new day", async () => {
    const ns = budgetNamespace();
    let now = new Date("2026-11-04T10:00:00Z");
    const limit = dailySpendLimit(ns, "cardy", 0.01, () => now);
    await Promise.all([limit.record(0.004), limit.record(0.004)]);
    expect(await spentToday(ns, "cardy", now)).toBeCloseTo(0.008, 10);
    expect(await limit.allows()).toBe(true);
    await limit.record(0.004);
    expect(await limit.allows()).toBe(false);
    now = new Date("2026-11-05T00:00:01Z");
    expect(await limit.allows()).toBe(true);
    expect(await spentToday(ns, "cardy", now)).toBe(0);
  });

  it("keeps clients apart", async () => {
    const ns = budgetNamespace();
    await dailySpendLimit(ns, "cardy", 1).record(0.5);
    expect(await spentToday(ns, "other")).toBe(0);
  });

  it("rejects malformed calls", async () => {
    const object = budgetNamespace().get("x" as never);
    expect((await object.fetch(new Request("https://b/add", { method: "POST", body: '{"day":"x","usd":1}' }))).status).toBe(400);
    expect((await object.fetch(new Request("https://b/add", { method: "POST", body: '{"day":"2026-11-04","usd":-1}' }))).status).toBe(400);
    expect((await object.fetch(new Request("https://b/spent"))).status).toBe(400);
  });

  it("counts down to midnight UTC", () => {
    expect(secondsUntilReset(new Date("2026-11-04T23:59:00Z"))).toBe(60);
  });
});

describe("budget config", () => {
  it("parses a default cap and per-client overrides", () => {
    const config = loadEnv(makeEnv({ DAILY_BUDGET_USD: "2", CLIENT_DAILY_BUDGETS_USD: "cardy:0.5, ops:unlimited" }));
    expect(capFor("cardy", config.DAILY_BUDGET_USD, config.CLIENT_DAILY_BUDGETS_USD)).toBe(0.5);
    expect(capFor("ops", config.DAILY_BUDGET_USD, config.CLIENT_DAILY_BUDGETS_USD)).toBeUndefined();
    expect(capFor("alice", config.DAILY_BUDGET_USD, config.CLIENT_DAILY_BUDGETS_USD)).toBe(2);
    expect(capFor("alice", undefined, new Map())).toBeUndefined();
  });

  it.each(["cardy", "cardy:", "cardy:lots", ":1", "cardy:-1"])("rejects the override %j", (raw) => {
    expect(() => loadEnv(makeEnv({ CLIENT_DAILY_BUDGETS_USD: raw }))).toThrow(/CLIENT_DAILY_BUDGETS_USD/);
  });
});

describe("worker with a spending cap", () => {
  beforeEach(() => {
    const { fetchStub } = stubNetwork();
    const network = fetchStub.getMockImplementation()!;
    // Firecrawl answers searches; everything else goes to the stub network.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (new URL(url).hostname === "api.firecrawl.dev") return new Response(fixture("firecrawl-search.json"), { headers: { "Content-Type": "application/json" } });
      return network(input, init);
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const capped = (ns: BudgetNamespaceLike, cap: string) => makeEnv({ BUDGET: ns, DAILY_BUDGET_USD: cap, FIRECRAWL_API_KEY: "fc-test" });

  it("answers budget_exceeded with Retry-After once a client's cap is used up, and keeps free sources", async () => {
    const ns = budgetNamespace();
    const env = capped(ns, "0.003");
    expect((await call(`${RestRoute.Search}?query=one`, { env })).status).toBe(200);
    expect((await call(`${RestRoute.Search}?query=two`, { env })).status).toBe(200);
    const over = await call(`${RestRoute.Search}?query=three`, { env });
    expect(over.status).toBe(429);
    expect(ErrorBodySchema.parse(await over.json()).error.code).toBe(ErrorCode.BudgetExceeded);
    expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Direct fetch is free, so pages still work.
    expect((await call(RestRoute.Fetch, { env, body: { url: articleUrl("over-budget") } })).status).toBe(200);
  });

  it("shows admins today's spend per client, and hides it from others", async () => {
    const ns = budgetNamespace();
    const env = capped(ns, "1");
    await call(`${RestRoute.Search}?query=spend`, { env });
    expect((await call(AdminRoute.Spending, { env })).status).toBe(403);
    const report = (await (await call(AdminRoute.Spending, { env, key: ADMIN_KEY })).json()) as { clients: { client: string; cap_usd?: number; spent_usd: number }[] };
    expect(report.clients[0]).toEqual({ client: "alice", cap_usd: 1, spent_usd: 0.002 });
    expect(report.clients.map((c) => c.client)).toEqual(["alice", "ops"]);
  });

  it("is off without a cap", async () => {
    const ns = budgetNamespace();
    expect((await call(`${RestRoute.Search}?query=free`, { env: makeEnv({ BUDGET: ns, FIRECRAWL_API_KEY: "fc-test" }) })).status).toBe(200);
    expect(ns.objects.size).toBe(0);
  });
});
