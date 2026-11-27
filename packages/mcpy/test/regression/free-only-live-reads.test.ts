/**
 * Regression (2026-11-27, production): deepmine polls live prices every minute (api.binance.com
 * trades, blockcypher, blockchair; max_age 10-30 s). Binance does not answer a Worker directly,
 * so the site route sent each read to Firecrawl ($0.0038), and calls where every paid source
 * failed paid for all of them again on the next poll. deepmine passed its $1 cap by 17:00 UTC
 * and its reads failed. Two fixes:
 * - `free_only`: a caller with other sources for a live figure keeps paid sources out of the
 *   call; a failure is an ordinary upstream_failed, one failed source among its others.
 * - a site whose paid sources all failed gets its free sources only for 15 minutes, so a failed
 *   escalation is not paid for on every call.
 * Never delete these.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCode, McpyError } from "mcpy";
import { fakePages, page, testMcpy } from "../helpers.js";

const BINANCE = "https://api.binance.com/api/v3/trades?symbol=BTCUSDT&limit=1";
const RESTRICTED = page({ status: 451, contentType: "application/json", content: "{\"code\":0,\"msg\":\"Service unavailable from a restricted location according to b. Eligibility in Binance Terms of Use.\"}" });
const WALL = page({ status: 403, content: "<html><title>Just a moment...</title></html>" });

async function failure(work: Promise<unknown>): Promise<McpyError> {
  const err = await work.then(() => undefined, (e: unknown) => e);
  expect(err).toBeInstanceOf(McpyError);
  return err as McpyError;
}

describe("free_only live reads", () => {
  it("never pays, even on a site routed to a paid source", async () => {
    const direct = fakePages("direct", RESTRICTED);
    const paid = fakePages("paid", page({ url: BINANCE, finalUrl: BINANCE }), 0.0038);
    const { mcpy } = testMcpy({ pages: [direct, paid] });
    await mcpy.fetch({ url: BINANCE, max_age: 0 }); // teaches the route: paid serves Binance
    expect(paid.calls).toHaveLength(1);

    const err = await failure(mcpy.fetch({ url: BINANCE, max_age: 0, free_only: true }));
    expect(err.code).toBe(ErrorCode.UpstreamFailed);
    expect(err.message).toContain("free_only");
    expect(paid.calls).toHaveLength(1);
    expect(direct.calls).toHaveLength(2);
  });

  it("is served from the cache and by free sources", async () => {
    const direct = fakePages("direct", page());
    const paid = fakePages("paid", page(), 0.0038);
    const { mcpy } = testMcpy({ pages: [direct, paid] });
    const r = await mcpy.fetch({ url: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD", free_only: true });
    expect(r.meta.cost_usd).toBe(0);
    await mcpy.grep({ url: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD", pattern: "Lorem", free_only: true });
    expect([direct.calls.length, paid.calls.length]).toEqual([1, 0]);
  });

  it("says so when no free source can serve the request", async () => {
    const browser = fakePages("browser", page(), 0.0005);
    (browser as { capabilities?: object }).capabilities = { render: true };
    const { mcpy } = testMcpy({ pages: [fakePages("direct", page()), browser] });
    const err = await failure(mcpy.fetch({ url: BINANCE, render: true, free_only: true }));
    expect(err.code).toBe(ErrorCode.NoProviders);
    expect(browser.calls).toHaveLength(0);
  });
});

describe("a site whose paid sources all failed", () => {
  afterEach(() => vi.useRealTimers());

  it("is not escalated again on every call, and gets another try after 15 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T17:00:00Z"));
    const direct = fakePages("direct", RESTRICTED);
    const browser = fakePages("browser", WALL, 0.0005);
    const firecrawl = fakePages("firecrawl", WALL, 0.0038);
    const { mcpy } = testMcpy({ pages: [direct, browser, firecrawl] });

    const first = await failure(mcpy.fetch({ url: BINANCE, max_age: 0 }));
    expect(first.code).toBe(ErrorCode.UpstreamFailed);
    expect([browser.calls.length, firecrawl.calls.length]).toEqual([1, 1]);

    for (const minute of [1, 2, 3, 14]) {
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 27, 17, minute)));
      const err = await failure(mcpy.fetch({ url: `${BINANCE}&m=${minute}`, max_age: 0 }));
      expect(err.code).toBe(ErrorCode.UpstreamFailed);
      expect(err.message).toContain("paused");
    }
    expect([direct.calls.length, browser.calls.length, firecrawl.calls.length]).toEqual([5, 1, 1]);

    vi.setSystemTime(new Date("2026-11-27T17:15:01Z"));
    await failure(mcpy.fetch({ url: BINANCE, max_age: 0 }));
    expect([browser.calls.length, firecrawl.calls.length]).toEqual([2, 2]);
  });

  it("does not pause a site whose free sources alone failed", async () => {
    let up = false;
    const direct = fakePages("direct", () => (up ? page() : WALL));
    const { mcpy } = testMcpy({ pages: [direct] });
    await failure(mcpy.fetch({ url: BINANCE, max_age: 0 }));
    up = true;
    await expect(mcpy.fetch({ url: BINANCE, max_age: 0 })).resolves.toMatchObject({ status: 200 });
  });

  it("keeps a free source's answer while the paid ones are paused", async () => {
    let directUp = false;
    const direct = fakePages("direct", () => (directUp ? page() : RESTRICTED));
    const paid = fakePages("paid", WALL, 0.0038);
    const { mcpy } = testMcpy({ pages: [direct, paid] });
    await failure(mcpy.fetch({ url: BINANCE, max_age: 0 }));
    directUp = true;
    const r = await mcpy.fetch({ url: BINANCE, max_age: 0 });
    expect(r.meta.cost_usd).toBe(0);
    expect(paid.calls).toHaveLength(1);
  });
});
