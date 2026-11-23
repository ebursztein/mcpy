import { describe, expect, it } from "vitest";
import { yahooAuctions } from "../../src/sites/asia/yahoo-auctions.js";
import { expectBlockedReadsFailed, fixture, listings, query } from "./site-harness.js";

describe("yahoo_auctions", () => {
  it("reads rows from __NEXT_DATA__ and skips PayPay Flea rows", () => {
    const { outcome, listings: ls } = listings(yahooAuctions, fixture("asia/yahoo-auctions.html"));
    expect(outcome.kind).toBe("results");
    expect(ls.map((l) => l.id)).toEqual(["k1253384371", "l1253388044", "o1253391213"]);
    for (const l of ls) {
      expect(l.url).toBe(`https://auctions.yahoo.co.jp/jp/auction/${l.id}`);
      expect(l.price?.currency).toBe("JPY");
      expect(l.price!.amount).toBeGreaterThan(0);
    }
    expect(ls[2]!.format).toBe("auction");
    expect(ls[2]!.auction?.ends_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("applies price and sort on the site", () => {
    const req = yahooAuctions.search(query({ query: "リザードン", minPrice: 5000, maxPrice: 20000, sort: "price_low", page: 2 }));
    expect(req.url).toContain("aucminprice=5000");
    expect(req.url).toContain("aucmaxprice=20000");
    expect(req.url).toContain("s1=cbids&o1=a");
    expect(req.url).toContain("b=101");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads a page without rows as empty and a challenge as failed", () => {
    const empty = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialState":{"search":{"items":{"listing":{"items":[],"totalResultsAvailable":0}}}}}}}</script>';
    expect(listings(yahooAuctions, empty).outcome.kind).toBe("empty");
    expect(listings(yahooAuctions, "<html><body>new layout</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(yahooAuctions);
  });
});
