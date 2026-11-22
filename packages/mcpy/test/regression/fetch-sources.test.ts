/**
 * 2026-11-21, testing card-price sources live: a GET to TCGplayer's POST-only
 * sales API (HTTP 405) paid two sources for the same 405, and Firecrawl's
 * cost estimate ($0.001 a page, $0.002 a search) was a quarter of what the
 * Hobby plan bills, so daily caps let clients spend about 4x their cap on it.
 * Never delete these.
 */

import { describe, expect, it } from "vitest";
import { type SpendLimit } from "mcpy";
import { FIRECRAWL_HOBBY_USD_PER_CREDIT, firecrawl, firecrawlSearch, type SearchRequest } from "mcpy/providers";
import { fakePages, fakeSearch, page, testMcpy } from "../helpers.js";

const search = (limit: number, pageNo = 1): SearchRequest => ({ query: "q", type: "web", limit, page: pageNo });

describe("fetch source regressions", () => {
  it("a 405 is the answer: no paid source is asked after it", async () => {
    const free = fakePages("free", page({ status: 405, content: "Method Not Allowed" }));
    const paid = fakePages("paid", page(), 0.004);
    const { mcpy } = testMcpy({ pages: [free, paid] });
    const result = await mcpy.fetch({ url: "https://example.com/api/sales" });
    expect(result.status).toBe(405);
    expect(paid.calls).toHaveLength(0);
  });

  it("Firecrawl is estimated from the credits it bills: 1 a page, 2 per 10 search results", () => {
    const credit = FIRECRAWL_HOBBY_USD_PER_CREDIT;
    expect(credit).toBeCloseTo(0.0038, 10);
    expect(firecrawl({ apiKey: "k" }).costPerCall).toBeCloseTo(credit, 10);
    const s = firecrawlSearch({ apiKey: "k" });
    expect(s.costPerCall).toBeCloseTo(2 * credit, 10);
    // Measured live: 10 results billed 2 credits, 25 billed 6.
    expect(s.costOf!(search(10))).toBeCloseTo(2 * credit, 10);
    expect(s.costOf!(search(25))).toBeCloseTo(6 * credit, 10);
    // Page 3 of 10 asks Firecrawl for 30 results.
    expect(s.costOf!(search(10, 3))).toBeCloseTo(6 * credit, 10);
    // Another plan's price per credit.
    expect(firecrawlSearch({ apiKey: "k", usdPerCredit: 0.001 }).costOf!(search(10))).toBeCloseTo(0.002, 10);
  });

  it("a search is charged what it costs for its size, not a flat price", async () => {
    const charges: number[] = [];
    const spendLimit: SpendLimit = { allows: async () => true, record: async (usd) => void charges.push(usd) };
    const sized = { ...fakeSearch("paid", [{ url: "https://example.com/", title: "Hit", snippet: "" }], 0.001), costOf: (r: SearchRequest) => r.limit * 0.001 };
    const { mcpy } = testMcpy({ search: [sized] });
    await mcpy.with({ spendLimit }).search({ query: "q", max_results: 30 });
    expect(charges).toHaveLength(1);
    expect(charges[0]).toBeCloseTo(0.03, 10);
  });
});
