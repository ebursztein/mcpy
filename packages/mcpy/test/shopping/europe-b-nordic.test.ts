import { describe, expect, it } from "vitest";
import { blocket, dba, finn, tori } from "../../src/sites/europe/b/nordic.js";
import { expectBlockedReadsFailed, fixture, listings, page, query } from "./site-harness.js";

describe("finn / blocket / dba / tori (one platform)", () => {
  it("reads the search API rows", () => {
    const { outcome, listings: ls } = listings(finn, fixture("europe-b/finn-search.json"));
    expect(outcome).toMatchObject({ kind: "results", total: 63542, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["481582019", "481582058", "481582064", "481582070"]);
    expect(ls[0]).toMatchObject({
      url: "https://www.finn.no/recommerce/forsale/item/481582019",
      title: "Naveen #112 Pokemon Perfect Order",
      price: { amount: 40, currency: "NOK" },
      format: "fixed_price",
      location: "Finstadjordet",
      country: "no",
    });
    expect(ls[0]!.posted_at).toMatch(/^2026-11-23T00:11:31/);
  });

  it("names business sellers", () => {
    const { listings: ls } = listings(dba, fixture("europe-b/dba-search.json"));
    expect(ls.at(-1)).toMatchObject({ id: "13198447", seller: { name: "Golisto" }, price: { amount: 7200, currency: "DKK" } });
    expect(ls.at(-1)!.details?.["Seller"]).toBe("business");
  });

  it("drops semantic-only near matches and marks wanted posts", () => {
    const body = JSON.parse(fixture("europe-b/finn-search.json"));
    body.docs[0].metadata.source = "semantic";
    body.docs[1].trade_type = "Ønskes kjøpt";
    const { listings: ls } = listings(finn, JSON.stringify(body));
    expect(ls.map((l) => l.id)).toEqual(["481582058", "481582064", "481582070"]);
    expect(ls[0]!.format).toBe("wanted");
  });

  it("applies sort, price and page in the API URL", () => {
    const req = blocket.search(query({ query: "black lotus", minPrice: 50, maxPrice: 900.5, sort: "newest", page: 3 }));
    expect(req.url).toBe("https://www.blocket.se/recommerce/forsale/search/api/search/SEARCH_ID_BAP_COMMON?q=black%20lotus&sort=PUBLISHED_DESC&price_from=50&price_to=901&page=3");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(tori.search(query({ sort: "ending_soon" })).applies?.sort).toBe(false);
  });

  it("reads no docs as empty, other shapes as failed", () => {
    expect(listings(finn, fixture("europe-b/finn-empty.json")).outcome.kind).toBe("empty");
    expect(finn.read(page('{"metadata":{}}'), query())).toMatchObject({ kind: "failed", failure: "redesigned" });
    for (const s of [finn, blocket, dba, tori]) expectBlockedReadsFailed(s);
  });
});
