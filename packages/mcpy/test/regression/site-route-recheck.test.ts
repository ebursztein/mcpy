/**
 * 2026-11-24, cardy's MTGStocks reads: api.mtgstocks.com answers a direct
 * fetch for free, but once a passing failure had sent it to Firecrawl the
 * site route kept it there for a day (the route is only rewritten when the
 * serving source changes, so a paid source that keeps working is never
 * questioned). That was 1,107 paid calls, $4.21, about 80% of the day's
 * spend. The route now lasts 15 minutes by default, so the free source is
 * tried again soon after it recovers. Never delete these.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineLimitsSchema } from "../../src/engine/limits.js";
import { fakePages, page, testMcpy } from "../helpers.js";

const URL_BASE = "https://api.mtgstocks.com/prints/25436/prices";

describe("a site sent to a paid source after one failure comes back to the free one", () => {
  afterEach(() => vi.useRealTimers());

  it("re-tries the free source within 15 minutes by default", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T04:00:00Z"));
    let directDown = true;
    const direct = fakePages("direct", () => (directDown ? page({ status: 429 }) : page()));
    const firecrawl = fakePages("firecrawl", page(), 0.0038);
    const { mcpy } = testMcpy({ pages: [direct, firecrawl] });

    await mcpy.fetch({ url: `${URL_BASE}/cardkingdom` });
    directDown = false;
    await mcpy.fetch({ url: `${URL_BASE}/cardmarket` });
    expect([direct.calls.length, firecrawl.calls.length]).toEqual([1, 2]);

    vi.setSystemTime(new Date("2026-11-24T04:15:01Z"));
    const r = await mcpy.fetch({ url: `${URL_BASE}/tcgplayer` });
    expect(r.meta.cost_usd).toBe(0);
    await mcpy.fetch({ url: `${URL_BASE}/starcity` });
    expect([direct.calls.length, firecrawl.calls.length]).toEqual([3, 2]);
  });

  it("keeps the default route memory at 15 minutes or less", () => {
    expect(EngineLimitsSchema.parse({}).siteRouteTtlSeconds).toBeLessThanOrEqual(900);
  });
});
