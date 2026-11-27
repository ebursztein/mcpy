import { CacheStatus, RestRoute } from "mcpy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { budgetHeaders, CallHeader } from "../../src/call-headers.js";
import { CLIENT_RATE_LIMIT } from "../../src/rate-limit.js";
import { fixture } from "../../../../packages/mcpy/test/helpers.js";
import { articleUrl, budgetNamespace, call, makeEnv, stubNetwork } from "./harness.js";

beforeEach(() => {
  const network = stubNetwork().fetchStub.getMockImplementation()!;
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

/** A query no other test has searched: the isolate's cache is shared. */
let queries = 0;
const query = () => `${RestRoute.Search}?query=headers-${++queries}-${Date.now()}`;

// $0.001 a credit: a 10-result Firecrawl search (2 credits) is estimated at $0.002.
const capped = (cap: string) => makeEnv({ BUDGET: budgetNamespace(), DAILY_BUDGET_USD: cap, FIRECRAWL_API_KEY: "fc-test", FIRECRAWL_USD_PER_CREDIT: "0.001" });

describe("REST call headers", () => {
  it("say whether a call was cached and what it cost", async () => {
    const env = makeEnv();
    const url = articleUrl("headers");
    const first = await call(RestRoute.Fetch, { env, body: { url } });
    expect(first.headers.get(CallHeader.Cache)).toBe(CacheStatus.Miss);
    expect(first.headers.get(CallHeader.CostUsd)).toBe("0");
    const again = await call(RestRoute.Fetch, { env, body: { url } });
    expect(again.headers.get(CallHeader.Cache)).toBe(CacheStatus.Hit);
  });

  it("report today's spend against the cap, this call included, and when it resets", async () => {
    const env = capped("1");
    const first = await call(query(), { env });
    expect(first.headers.get(CallHeader.CostUsd)).toBe("0.002");
    expect(first.headers.get(CallHeader.BudgetUsedUsd)).toBe("0.002");
    expect(first.headers.get(CallHeader.BudgetLimitUsd)).toBe("1");
    expect(first.headers.get(CallHeader.BudgetRemainingUsd)).toBe("0.998");
    expect(Number(first.headers.get(CallHeader.BudgetReset))).toBeGreaterThan(0);
    const second = await call(query(), { env });
    expect(second.headers.get(CallHeader.BudgetUsedUsd)).toBe("0.004");
  });

  it("carry the budget on refusals too", async () => {
    const env = capped("0.002");
    await call(query(), { env });
    const over = await call(query(), { env });
    expect(over.status).toBe(429);
    expect(over.headers.get(CallHeader.BudgetRemainingUsd)).toBe("0");
    expect(over.headers.get(CallHeader.Cache)).toBeNull();
  });

  it("leave the budget out for a client with no cap", async () => {
    const response = await call(RestRoute.Fetch, { env: makeEnv({ BUDGET: budgetNamespace() }), body: { url: articleUrl("uncapped") } });
    expect(response.headers.get(CallHeader.BudgetLimitUsd)).toBeNull();
  });

  it("state the per-key request limit", async () => {
    const response = await call(RestRoute.Fetch, { body: { url: articleUrl("policy") } });
    expect(response.headers.get("X-RateLimit-Limit")).toBe(String(CLIENT_RATE_LIMIT.requests));
    expect(response.headers.get("RateLimit-Policy")).toBe(`${CLIENT_RATE_LIMIT.requests};w=${CLIENT_RATE_LIMIT.periodSeconds}`);
  });

  it("never report a negative remaining or float noise", () => {
    const h = budgetHeaders(5, 4.9999999, 0.0038, new Date("2026-11-27T23:59:30Z"));
    expect(h).toEqual({
      [CallHeader.BudgetUsedUsd]: "5.0038",
      [CallHeader.BudgetLimitUsd]: "5",
      [CallHeader.BudgetRemainingUsd]: "0",
      [CallHeader.BudgetReset]: "30",
    });
  });
});
