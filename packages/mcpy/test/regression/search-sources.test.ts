/**
 * 2026-11-22, comparing search sources on card-price queries: a Bright Data
 * search of more than 10 results was estimated as one SERP request although
 * it makes up to five, each billed. Never delete these.
 */

import { describe, expect, it } from "vitest";
import { brightDataSearch, type SearchRequest } from "mcpy/providers";

const search = (limit: number): SearchRequest => ({ query: "Pikachu Illustrator sold", type: "web", limit, page: 1 });

describe("search source regressions", () => {
  it("Bright Data is estimated per Google page fetched", () => {
    const s = brightDataSearch({ apiKey: "k", zone: "z" });
    expect(s.costOf!(search(10))).toBeCloseTo(0.0015, 10);
    expect(s.costOf!(search(25))).toBeCloseTo(0.0045, 10);
    // At most five pages per search.
    expect(s.costOf!(search(100))).toBeCloseTo(0.0075, 10);
  });
});
