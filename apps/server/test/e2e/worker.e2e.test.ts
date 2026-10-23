/**
 * Boots the real Worker in workerd (wrangler's unstable_startWorker) and
 * drives REST and MCP against https://elie.net (the maintainer's site).
 *
 * No paid provider credits are spent: PAGE_PROVIDERS=direct, and the
 * Worker never sees apps/server/.dev.vars. `envFiles` pointing at a file
 * that does not exist makes wrangler skip .dev.vars (getVarsForDev only
 * reads it when envFiles is empty), and every provider credential is also
 * overridden with "" (loadEnv treats empty strings as unset). The admin
 * endpoint check below proves only `direct` is enabled.
 *
 * Needs `npm run build` first (the Worker bundles mcpy from dist):
 * `npm run test:e2e` does both.
 */

import { fileURLToPath } from "node:url";
import { CacheStatus, ErrorBodySchema, ErrorCode, FetchResultSchema, GrepResultSchema, PaperSearchResultSchema, RestRoute, ToolName } from "mcpy";
import { ProviderId } from "mcpy/providers";
import { unstable_startWorker } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONFIG = fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url));
const USER_KEY = "e2e-user-key-0123456789abcdef";
const ADMIN_KEY = "e2e-admin-key-0123456789abcdef";
const TARGET = "https://elie.net/";

const plain = (value: string) => ({ type: "plain_text" as const, value });
const NO_CREDENTIALS = Object.fromEntries(
  ["FIRECRAWL_API_KEY", "BRIGHTDATA_API_KEY", "BRIGHTDATA_UNLOCKER_ZONE", "BRIGHTDATA_SERP_ZONE", "CF_ACCOUNT_ID", "CF_BROWSER_API_TOKEN"].map((k) => [k, plain("")]),
);

const BUDGET = { coldFetchMs: 15_000, cachedServerMs: 500, cachedWallMs: 1_500, restSlackBytes: 3_000, mcpSlackChars: 1_000 };
const measured: Record<string, number> = {};

let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
let base: URL;

beforeAll(async () => {
  worker = await unstable_startWorker({
    config: CONFIG,
    envFiles: [".env.e2e-does-not-exist"],
    bindings: {
      ...NO_CREDENTIALS,
      MCPY_CLIENTS: plain(`e2e:${USER_KEY},e2e-admin:${ADMIN_KEY}:admin`),
      PAGE_PROVIDERS: plain(ProviderId.Direct),
      SEARCH_PROVIDERS: plain(ProviderId.Firecrawl),
      // Free and fast; arXiv is free too but can take 30 s per query.
      PAPER_PROVIDERS: plain(ProviderId.OpenAlex),
      DEPLOYMENT_ENV: plain("e2e"),
      LOG_LEVEL: plain("warn"),
    },
    dev: { server: { hostname: "127.0.0.1" }, inspector: false, persist: false, watch: false, remote: false },
  });
  await worker.ready;
  base = await worker.url;
});

afterAll(async () => {
  await worker?.dispose();
  console.info(`e2e measurements: ${JSON.stringify(measured)}`);
});

async function api(path: string, init: RequestInit & { key?: string | null } = {}) {
  const headers = new Headers(init.headers);
  const key = init.key === undefined ? USER_KEY : init.key;
  if (key) headers.set("Authorization", `Bearer ${key}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const started = performance.now();
  const response = await fetch(new URL(path, base), { ...init, headers });
  const text = await response.text();
  return { response, text, wallMs: performance.now() - started };
}

const post = (path: string, body: unknown, key?: string | null) => api(path, { method: "POST", body: JSON.stringify(body), key });

describe("worker basics", () => {
  it("serves /health", async () => {
    const { response, text } = await api("/health", { key: null });
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ ok: true, name: "mcpy" });
  });

  it("rejects a missing or wrong key with 401", async () => {
    for (const key of [null, "x".repeat(30)]) {
      const { response, text } = await post(RestRoute.Fetch, { url: TARGET }, key);
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
      expect(ErrorBodySchema.parse(JSON.parse(text)).error.code).toBe(ErrorCode.Unauthorized);
    }
  });

  it("runs with the free provider only (no paid credentials loaded)", async () => {
    const { response, text } = await api("/v1/admin/providers", { key: ADMIN_KEY });
    expect(response.status).toBe(200);
    const body = JSON.parse(text) as { pages: string[]; search: string[]; papers: string[] };
    expect(body.pages).toEqual([ProviderId.Direct]);
    expect(body.search).toEqual([]);
    expect(body.papers).toEqual([ProviderId.OpenAlex]);
  });

  it("returns a clean 503 no_providers for search", async () => {
    const { response, text } = await post(RestRoute.Search, { query: "elie bursztein" });
    expect(response.status).toBe(503);
    expect(ErrorBodySchema.parse(JSON.parse(text)).error.code).toBe(ErrorCode.NoProviders);
  });
});

describe("REST against elie.net", () => {
  it("fetches cold, then serves the repeat from cache within budget", async () => {
    const cold = await post(RestRoute.Fetch, { url: TARGET, max_chars: 2_000 });
    expect(cold.response.status, cold.text).toBe(200);
    expect(cold.response.headers.get("X-Request-Id")).toBeTruthy();
    const first = FetchResultSchema.parse(JSON.parse(cold.text));
    expect(first.status).toBe(200);
    expect(first.title?.length).toBeGreaterThan(0);
    expect(first.content.trim().length).toBeGreaterThan(0);
    expect(first.content.length).toBeLessThanOrEqual(2_000);
    expect(first.meta.cache).toBe(CacheStatus.Miss);
    expect(cold.wallMs).toBeLessThan(BUDGET.coldFetchMs);
    expect(cold.text.length).toBeLessThanOrEqual(2_000 + BUDGET.restSlackBytes);
    Object.assign(measured, { coldWallMs: Math.round(cold.wallMs), coldServerMs: first.meta.latency_ms, restBodyBytes: cold.text.length });

    const warm = await post(RestRoute.Fetch, { url: TARGET, max_chars: 2_000 });
    const second = FetchResultSchema.parse(JSON.parse(warm.text));
    expect(second.meta.cache).toBe(CacheStatus.Hit);
    expect(second.meta.attempts).toBe(0);
    expect(second.content).toBe(first.content);
    expect(second.meta.latency_ms).toBeLessThan(BUDGET.cachedServerMs);
    expect(warm.wallMs).toBeLessThan(BUDGET.cachedWallMs);
    Object.assign(measured, { cachedWallMs: Math.round(warm.wallMs), cachedServerMs: second.meta.latency_ms });
  });

  it("paginates with GET query parameters", async () => {
    const { response, text } = await api(`${RestRoute.Fetch}?url=${encodeURIComponent(TARGET)}&max_chars=500&offset=100`);
    expect(response.status).toBe(200);
    const result = FetchResultSchema.parse(JSON.parse(text));
    expect(result.offset).toBe(100);
    expect(result.content.length).toBeLessThanOrEqual(500);
  });

  it("greps for Elie", async () => {
    const { response, text } = await post(RestRoute.Grep, { url: TARGET, pattern: "Elie", context: 1 });
    expect(response.status, text).toBe(200);
    const result = GrepResultSchema.parse(JSON.parse(text));
    expect(result.matches).toBeGreaterThan(0);
    expect(result.output).toMatch(/elie/i);
    measured.grepMatches = result.matches;
  });

  it("rejects private targets", async () => {
    const { response, text } = await post(RestRoute.Fetch, { url: "http://127.0.0.1:8787/" });
    expect(response.status).toBe(400);
    expect(ErrorBodySchema.parse(JSON.parse(text)).error.code).toBe(ErrorCode.InvalidTarget);
  });
});

describe("MCP against elie.net", () => {
  let id = 0;
  async function rpc(method: string, params: unknown, path = "/mcp", key: string | null = USER_KEY) {
    const { response, text, wallMs } = await api(path, {
      method: "POST",
      key,
      headers: { Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const isSse = (response.headers.get("Content-Type") ?? "").includes("text/event-stream");
    const data = isSse ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean).pop() : text;
    return { response, wallMs, message: JSON.parse(data ?? "{}") as { result?: Record<string, unknown>; error?: unknown } };
  }

  const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcpy-e2e", version: "0.0.0" } };

  it("initializes and lists exactly web_fetch, web_grep, web_search, paper_search", async () => {
    const init = await rpc("initialize", INIT);
    expect(init.response.status).toBe(200);
    expect(init.message.result?.serverInfo).toMatchObject({ name: "mcpy" });
    const list = await rpc("tools/list", {});
    const names = ((list.message.result?.tools ?? []) as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual([ToolName.Fetch, ToolName.Grep, ToolName.Search, ToolName.Papers].sort());
  });

  it("accepts the key as ?key= on /mcp", async () => {
    const init = await rpc("initialize", INIT, `/mcp?key=${USER_KEY}`, null);
    expect(init.response.status).toBe(200);
  });

  it("calls web_fetch on elie.net within the size budget", async () => {
    const maxLength = 2_000;
    const { message, wallMs } = await rpc("tools/call", { name: ToolName.Fetch, arguments: { url: TARGET, max_chars: maxLength } });
    const result = message.result as { content: { type: string; text: string }[]; structuredContent: unknown; isError?: boolean };
    expect(result.isError).toBeFalsy();
    const structured = FetchResultSchema.parse(result.structuredContent);
    expect(structured.status).toBe(200);
    expect(structured.content.length).toBeGreaterThan(0);
    const text = result.content.map((c) => c.text).join("");
    expect(text).toContain("URL: ");
    expect(text.length).toBeLessThanOrEqual(maxLength + BUDGET.mcpSlackChars);
    Object.assign(measured, { mcpFetchWallMs: Math.round(wallMs), mcpTextChars: text.length });
  });

  it("calls paper_search for real papers, sorted by citations", async () => {
    const { message } = await rpc("tools/call", {
      name: ToolName.Papers,
      arguments: { query: "denoising diffusion probabilistic models", sort: "citations", max_results: 3 },
    });
    const result = message.result as { content: { text: string }[]; structuredContent: unknown; isError?: boolean };
    expect(result.isError).toBeFalsy();
    const papers = PaperSearchResultSchema.parse(result.structuredContent).results;
    expect(papers.length).toBeGreaterThan(0);
    expect(papers.map((p) => p.citations ?? 0)).toEqual([...papers.map((p) => p.citations ?? 0)].sort((a, b) => b - a));
    expect(result.content[0].text).toContain("Papers: denoising diffusion probabilistic models (citations");
  });

  it("calls web_grep on elie.net", async () => {
    const { message } = await rpc("tools/call", { name: ToolName.Grep, arguments: { url: TARGET, pattern: "Elie" } });
    const result = message.result as { structuredContent: unknown };
    expect(GrepResultSchema.parse(result.structuredContent).matches).toBeGreaterThan(0);
  });

  it("rejects MCP calls without a key", async () => {
    const { response } = await rpc("tools/list", {}, "/mcp", null);
    expect(response.status).toBe(401);
  });
});
