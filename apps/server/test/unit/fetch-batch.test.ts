/**
 * Regression (2026-11-27, deepmine): many requests in one REST call, each counted against the
 * per-key rate limit as the call it replaces (owner: a batch of N counts N) and logged as a fetch
 * of its own. Never delete these.
 */

import { CacheStatus, FetchBatchResultSchema, RestRoute } from "mcpy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallHeader } from "../../src/call-headers.js";
import { UsageRoute } from "../../src/usage/api.js";
import { UsageLogResultSchema } from "../../src/usage/schema.js";
import { ARTICLE_HOST, articleUrl, budgetNamespace, call, makeEnv, stubNetwork, usageNamespace } from "./harness.js";

beforeEach(() => {
  stubNetwork();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /v1/fetch/batch", () => {
  it("answers every request in one call, each counted against the rate limit and logged as a fetch", async () => {
    let counted = 0;
    const env = makeEnv({ USAGE: usageNamespace(), BUDGET: budgetNamespace(), DAILY_BUDGET_USD: "1", RATE_LIMITER: { limit: async () => ({ success: ++counted > 0 }) } });
    const urls = [articleUrl("batch"), articleUrl("batch"), articleUrl("batch")];
    await call(RestRoute.Fetch, { env, body: { url: urls[0] } });
    counted = 0;

    const response = await call(RestRoute.FetchBatch, { env, body: { requests: urls.map((url) => ({ url })) } });
    expect(response.status).toBe(200);
    expect(counted).toBe(3);
    const out = FetchBatchResultSchema.parse(await response.json());
    expect(out.results.map((r) => ("result" in r ? r.result.meta.cache : r.error.code))).toEqual([CacheStatus.Hit, CacheStatus.Miss, CacheStatus.Miss]);
    expect(out.meta).toMatchObject({ cache_hits: 1, failed: 0, cost_usd: 0 });
    expect(response.headers.get(CallHeader.CostUsd)).toBe("0");
    expect(response.headers.get(CallHeader.BudgetLimitUsd)).toBe("1");

    const log = UsageLogResultSchema.parse(await (await call(`${UsageRoute.Log}?domain=${ARTICLE_HOST}`, { env })).json());
    expect(log.calls.filter((c) => c.tool === "fetch")).toHaveLength(4);
  });

  it("refuses a batch the rate limit has no room for, running none of it", async () => {
    let allowed = 2;
    const env = makeEnv({ RATE_LIMITER: { limit: async () => ({ success: allowed-- > 0 }) } });
    const url = articleUrl("over");
    const response = await call(RestRoute.FetchBatch, { env, body: { requests: [{ url }, { url }, { url }] } });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect((await call(RestRoute.Fetch, { body: { url, max_age: 3_600 } })).headers.get(CallHeader.Cache)).toBe(CacheStatus.Miss);
  });

  it("refuses an invalid batch as invalid input", async () => {
    const response = await call(RestRoute.FetchBatch, { body: { requests: [{ url: "nope" }] } });
    expect(response.status).toBe(400);
  });
});
