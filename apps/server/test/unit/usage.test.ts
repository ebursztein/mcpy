import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode, McpyError, Operation, RestRoute } from "mcpy";
import { fixture } from "../../../../packages/mcpy/test/helpers.js";
import { UsageRoute, UsageTool } from "../../src/usage/api.js";
import { insertRows, migrate, readLog, summarize } from "../../src/usage/log.js";
import { rowsFor } from "../../src/usage/recorder.js";
import { UsageLogResultSchema, UsageResultSchema, type CallRow, type UsageLogInput } from "../../src/usage/schema.js";
import { ADMIN_KEY, ARTICLE_HOST, articleUrl, budgetNamespace, call, makeEnv, memorySql, rpc, stubNetwork, usageNamespace } from "./harness.js";

const ctx = { client: "cardy", callId: "c1", started: Date.parse("2026-11-23T10:00:00Z") };
const meta = (over: object = {}) => ({ cache: "miss", latency_ms: 5, attempts: 2, cost_usd: 0.0038, ...over });

describe("call rows", () => {
  it("logs crypto_coin as one row per coin and kind of day, naming the source of each, the cost on the first", () => {
    const parts = { "ZEC complete": "coinmetrics", "ZEC live": "miningpoolstats" };
    const rows = rowsFor(Operation.CryptoCoin, { symbols: ["ZEC"], days: 7 }, { result: { coins: [], meta: meta() }, costUsd: 0.001, served: { provider: "coinmetrics+miningpoolstats", parts } }, ctx);
    expect(rows.map((r) => [r.store, r.backend, r.cost_usd, r.query])).toEqual([
      ["ZEC complete", "coinmetrics", 0.001, "ZEC"],
      ["ZEC live", "miningpoolstats", 0, "ZEC"],
    ]);
    expect(rows.every((r) => r.call_id === "c1" && r.attempts === undefined)).toBe(true);
  });

  it("logs crypto_market's symbols as its query", () => {
    const [row] = rowsFor(Operation.CryptoMarket, { symbols: ["BTC", "RVN"] }, { result: { coins: [], meta: meta() }, costUsd: 0 }, ctx);
    expect(row).toMatchObject({ tool: Operation.CryptoMarket, query: "BTC,RVN", status: "ok" });
  });

  it("logs the URL as query, its host as domain, the other args as JSON, never headers, body or script", () => {
    const input = { url: "https://www.tcgplayer.com/product/42382?x=1", format: "html", max_age: 0, headers: { Authorization: "Bearer s3cret" }, body: "secret", script: "export default 1" };
    const [row] = rowsFor(Operation.Fetch, input, { result: { meta: meta() }, costUsd: 0.0038 }, ctx);
    expect(row).toMatchObject({ tool: "fetch", query: input.url, domain: "www.tcgplayer.com", args: { format: "html", max_age: 0 }, status: "ok", cache: "miss", cache_hit: false, attempts: 2, cost_usd: 0.0038, client: "cardy", call_id: "c1" });
    expect(JSON.stringify(row)).not.toMatch(/s3cret|secret|export default/);
  });

  it("logs a search's text and type, and a cache hit as free", () => {
    const [row] = rowsFor(Operation.Search, { query: "charizard psa 10", type: "news" }, { result: { results: [1, 2, 3], meta: meta({ cache: "hit", attempts: 0 }) }, costUsd: 0 }, ctx);
    expect(row).toMatchObject({ query: "charizard psa 10", search_type: "news", cache_hit: true, results: 3, cost_usd: 0 });
    expect(row!.domain).toBeUndefined();
    expect(rowsFor(Operation.Search, { query: "x" }, { result: { meta: meta() }, costUsd: 0 }, ctx)[0]!.search_type).toBe("web");
  });

  it("gives shopping one row per store with that store's own cost, sharing the call id", () => {
    const result = {
      results: [],
      meta: meta(),
      marketplaces: [
        { marketplace: "cardmarket", status: "ok", results: 12, cost_usd: 0.0043, search_url: "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=x" },
        { marketplace: "ebay_de", status: "failed", failure: "blocked", results: 0, search_url: "https://www.ebay.de/sch/i.html?_nkw=x" },
      ],
    };
    const rows = rowsFor(Operation.Shopping, { query: "glurak", marketplaces: ["cardmarket", "ebay_de"] }, { result, costUsd: 0.0045, served: { provider: "firecrawl", parts: { cardmarket: "firecrawl", ebay_de: "direct" } } }, ctx);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ store: "cardmarket", domain: "www.cardmarket.com", status: "ok", results: 12, cost_usd: 0.0045, query: "glurak", args: { marketplaces: ["cardmarket", "ebay_de"] } });
    expect(rows[1]).toMatchObject({ store: "ebay_de", status: "failed", error: "blocked", cost_usd: 0, backend: "direct" });
    expect(rows[0]!.backend).toBe("firecrawl");
    expect(new Set(rows.map((r) => r.call_id)).size).toBe(1);
    // meta.attempts counts every store's requests: no store's row repeats it.
    expect(rows.every((r) => r.attempts === undefined)).toBe(true);
  });

  it("logs a failed call with its error code and what its attempts cost", () => {
    const [row] = rowsFor(Operation.Fetch, { url: "https://x.example/" }, { error: new McpyError(ErrorCode.UpstreamFailed, "no"), costUsd: 0.004 }, ctx);
    expect(row).toMatchObject({ status: "error", error: "upstream_failed", cost_usd: 0.004, cache_hit: false });
  });
});

const row = (over: Partial<CallRow>): CallRow => ({
  time: "2026-11-23T10:00:00.000Z",
  client: "cardy",
  call_id: crypto.randomUUID(),
  tool: "fetch",
  args: {},
  status: "ok",
  cache_hit: false,
  duration_ms: 100,
  cost_usd: 0,
  ...over,
});
const NOW = Date.parse("2026-11-23T12:00:00Z");
const logInput = (over: Partial<UsageLogInput> = {}): UsageLogInput => ({ limit: 50, days: 30, paid_only: false, errors_only: false, cache_hits_only: false, ...over });

describe("the call log table", () => {
  it("sums by tool, domain, store, search type and day, with the cache hit rate", () => {
    const sql = memorySql();
    migrate(sql);
    insertRows(sql, [
      row({ domain: "www.tcgplayer.com", cost_usd: 0.0038, duration_ms: 4000 }),
      row({ domain: "www.tcgplayer.com", cache_hit: true, cache: "hit", duration_ms: 10 }),
      row({ tool: "search", search_type: "web", cost_usd: 0.0005, duration_ms: 900 }),
      row({ tool: "shopping", store: "cardmarket", domain: "www.cardmarket.com", cost_usd: 0.0043, call_id: "s1" }),
      row({ tool: "shopping", store: "ebay_de", domain: "www.ebay.de", status: "failed", call_id: "s1" }),
      row({ client: "deepmine", domain: "www.woyouminer.com", cost_usd: 1 }),
      row({ time: "2026-11-20T10:00:00.000Z", domain: "old.example" }),
    ], NOW);
    const s = summarize(sql, "cardy", Date.parse("2026-11-23T00:00:00Z"));
    expect(s.totals).toMatchObject({ calls: 4, paid_calls: 3, cache_hits: 1, errors: 1, cost_usd: 0.0086, cache_hit_rate: 0.25, max_ms: 4000 });
    expect(s.by_domain[0]).toMatchObject({ key: "www.cardmarket.com", cost_usd: 0.0043 });
    expect(s.by_domain.find((g) => g.key === "www.tcgplayer.com")).toMatchObject({ calls: 2, paid_calls: 1, cache_hits: 1, avg_ms: 2005 });
    expect(s.by_store.map((g) => g.key).sort()).toEqual(["cardmarket", "ebay_de"]);
    expect(s.by_search_type).toEqual([expect.objectContaining({ key: "web", calls: 1 })]);
    expect(s.by_tool.find((g) => g.key === "shopping")).toMatchObject({ calls: 1, errors: 1 });
    expect(s.by_client).toBeUndefined();
    expect(summarize(sql, "*", Date.parse("2026-11-23T00:00:00Z")).by_client!.map((g) => g.key)).toEqual(["deepmine", "cardy"]);
  });

  it("filters the log, newest first, and deletes rows past 30 days", () => {
    const sql = memorySql();
    migrate(sql);
    insertRows(sql, [row({ time: "2026-10-01T00:00:00.000Z" })], NOW);
    insertRows(sql, [
      row({ query: "https://www.tcgplayer.com/product/1", domain: "www.tcgplayer.com", cost_usd: 0.004 }),
      row({ query: "100%_charizard", tool: "search", status: "error", error: "timeout" }),
      row({ query: "https://www.tcgplayer.com/product/2", domain: "www.tcgplayer.com", cache_hit: true }),
    ], NOW);
    expect(Number(sql.exec("SELECT COUNT(*) AS n FROM calls").toArray()[0]!["n"])).toBe(3);
    expect(readLog(sql, "cardy", logInput(), NOW).calls.map((c) => c.query)).toEqual(["https://www.tcgplayer.com/product/2", "100%_charizard", "https://www.tcgplayer.com/product/1"]);
    expect(readLog(sql, "cardy", logInput({ domain: "tcgplayer.com" }), NOW).calls).toHaveLength(2);
    expect(readLog(sql, "cardy", logInput({ paid_only: true }), NOW).calls).toHaveLength(1);
    expect(readLog(sql, "cardy", logInput({ errors_only: true }), NOW).calls[0]!.error).toBe("timeout");
    expect(readLog(sql, "cardy", logInput({ cache_hits_only: true }), NOW).calls).toHaveLength(1);
    expect(readLog(sql, "cardy", logInput({ query: "%_char" }), NOW).calls).toHaveLength(1);
    expect(readLog(sql, "cardy", logInput({ query: "%" , tool: "fetch" }), NOW).calls).toHaveLength(0);
    expect(readLog(sql, "cardy", logInput({ limit: 1 }), NOW).more).toBe(true);
    expect(readLog(sql, "other", logInput(), NOW).calls).toHaveLength(0);
  });
});

describe("backends", () => {
  it("are an opaque number for clients and a name for admins, the same number each time", () => {
    const sql = memorySql();
    migrate(sql);
    insertRows(sql, [row({ backend: "firecrawl", cost_usd: 0.004 }), row({ backend: "direct" }), row({ backend: "firecrawl", cost_usd: 0.004 })], NOW);
    const asClient = readLog(sql, "cardy", logInput(), NOW);
    expect(asClient.calls.map((c) => c.backend_id)).toEqual([1, 2, 1]);
    expect(JSON.stringify(asClient)).not.toMatch(/firecrawl|direct/);
    expect(readLog(sql, "cardy", logInput(), NOW, true).calls.map((c) => c.backend)).toEqual(["firecrawl", "direct", "firecrawl"]);
    const since = Date.parse("2026-11-23T00:00:00Z");
    expect(summarize(sql, "cardy", since).by_backend.map((g) => [g.key, g.calls])).toEqual([["1", 2], ["2", 1]]);
    expect(summarize(sql, "cardy", since, true).by_backend.map((g) => g.key)).toEqual(["firecrawl", "direct"]);
  });
});

describe("usage over REST and MCP", () => {
  beforeEach(() => {
    const { fetchStub } = stubNetwork();
    const network = fetchStub.getMockImplementation()!;
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

  const env = () => makeEnv({ BUDGET: budgetNamespace(), USAGE: usageNamespace(), DAILY_BUDGET_USD: "1", FIRECRAWL_API_KEY: "fc-test", FIRECRAWL_USD_PER_CREDIT: "0.001" });

  it("logs each call and reports the client's own usage, with today's cap", async () => {
    const e = env();
    const url = articleUrl("usage");
    expect((await call(RestRoute.Fetch, { env: e, body: { url } })).status).toBe(200);
    expect((await call(RestRoute.Fetch, { env: e, body: { url } })).status).toBe(200);
    expect((await call(`${RestRoute.Search}?query=gardens`, { env: e })).status).toBe(200);
    const usage = UsageResultSchema.parse(await (await call(UsageRoute.Summary, { env: e })).json());
    expect(usage).toMatchObject({ client: "alice", today: { spent_usd: 0.002, cap_usd: 1, remaining_usd: 0.998 } });
    expect(usage.totals).toMatchObject({ calls: 3, paid_calls: 1, cache_hits: 1, cache_hit_rate: 0.333, cost_usd: 0.002 });
    expect(usage.by_domain).toEqual([expect.objectContaining({ key: ARTICLE_HOST, calls: 2, cache_hits: 1 })]);

    const log = UsageLogResultSchema.parse(await (await call(`${UsageRoute.Log}?tool=search`, { env: e })).json());
    expect(log.calls).toEqual([expect.objectContaining({ query: "gardens", search_type: "web", cost_usd: 0.002, transport: "rest", client: "alice", backend_id: expect.any(Number) })]);
    expect(log.calls[0]!.backend).toBeUndefined();
    const adminLog = UsageLogResultSchema.parse(await (await call(`${UsageRoute.Log}?client=alice&tool=search`, { env: e, key: ADMIN_KEY })).json());
    expect(adminLog.calls[0]!.backend).toBe("firecrawl");
    expect((await call(`${UsageRoute.Summary}?client=ops`, { env: e })).status).toBe(403);
    const all = UsageResultSchema.parse(await (await call(`${UsageRoute.Summary}?client=*`, { env: e, key: ADMIN_KEY })).json());
    expect(all.by_client!.map((g) => g.key)).toEqual(["alice"]);
    expect(all.today).toBeUndefined();
  });

  it("offers usage and usage_log as MCP tools", async () => {
    const e = env();
    await rpc("tools/call", { name: "web_fetch", arguments: { url: articleUrl("mcpusage") } }, { env: e });
    const { message } = await rpc("tools/call", { name: UsageTool.Log, arguments: { domain: ARTICLE_HOST } }, { env: e });
    const result = message.result as { structuredContent: unknown; content: { text: string }[] };
    expect(UsageLogResultSchema.parse(result.structuredContent).calls[0]).toMatchObject({ tool: "fetch", transport: "mcp" });
    expect(result.content[0]!.text).toContain(ARTICLE_HOST);
    const summary = await rpc("tools/call", { name: UsageTool.Summary, arguments: {} }, { env: e });
    expect((summary.message.result as { content: { text: string }[] }).content[0]!.text).toMatch(/cache hit rate/);
  });
});

describe("dashboard data", () => {
  beforeEach(() => {
    stubNetwork();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // The pages moved to dash.ly.tl (its own Worker, behind Cloudflare Access), 2026-11-25: this server serves none.
  it("serves no dashboard page any more", async () => {
    for (const path of ["/dashboard", "/dashboard/log", "/dashboard/charts.js"]) {
      const r = await call(path, { key: null });
      expect(r.status, path).toBe(404);
      expect(r.headers.get("Content-Type"), path).toMatch(/application\/json/);
    }
  });

  // Deepmine, 2026-11-25: a figure that looks wrong must be traceable to its source, which only the log names.
  it("returns each call's log id in meta, matching its log row", async () => {
    const e = makeEnv({ USAGE: usageNamespace() });
    const body = (await (await call(RestRoute.Fetch, { env: e, body: { url: articleUrl("trace") } })).json()) as { meta: { call_id?: string } };
    expect(body.meta.call_id).toMatch(/^[0-9a-f-]{36}$/);
    const log = UsageLogResultSchema.parse(await (await call(UsageRoute.Log, { env: e })).json());
    expect(log.calls.map((c) => c.call_id)).toContain(body.meta.call_id);
  });

  it("gives admins every client's usage stacked by tool, today's caps, and refuses others", async () => {
    const e = makeEnv({ BUDGET: budgetNamespace(), USAGE: usageNamespace(), DAILY_BUDGET_USD: "1" });
    await call(RestRoute.Fetch, { env: e, body: { url: articleUrl("dash") } });
    await call(RestRoute.Fetch, { env: e, body: { url: articleUrl("dash2") }, key: ADMIN_KEY });
    expect((await call("/v1/admin/dashboard", { env: e })).status).toBe(403);
    const d = (await (await call("/v1/admin/dashboard?days=7", { env: e, key: ADMIN_KEY })).json()) as {
      summary: { totals: { calls: number }; by_client: { key: string }[] };
      stacks: { client_tool: { bar: string; part: string; calls: number }[]; day_tool: unknown[] };
      spending: { clients: { client: string; cap_usd: number }[] };
    };
    expect(d.summary.totals.calls).toBe(2);
    expect(d.summary.by_client.map((g) => g.key).sort()).toEqual(["alice", "ops"]);
    expect(d.stacks.client_tool).toEqual(expect.arrayContaining([expect.objectContaining({ bar: "alice", part: "fetch", calls: 1 })]));
    expect(d.stacks.day_tool).toHaveLength(1);
    expect(d.spending.clients.map((c) => c.cap_usd)).toEqual([1, 1]);
  });
});
