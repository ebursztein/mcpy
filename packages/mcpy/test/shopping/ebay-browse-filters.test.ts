import { describe, expect, it } from "vitest";
import { ContentKind, PageFormat } from "mcpy";
import { browseParams } from "../../src/sites/ebay/browse-query.js";
import { ebayWorldwide } from "../../src/sites/ebay/browse.js";
import { applyFilters } from "../../src/services/shopping/filters.js";
import { ShoppingSearchInputSchema, type Listing } from "../../src/services/shopping/schema.js";
import { fakePages, page as fakePage, testMcpy } from "../helpers.js";
import { fixture, query } from "./site-harness.js";

const usd = { currency: "USD" as const };
const params = (q: Parameters<typeof query>[0]) => {
  const { params: p, applies } = browseParams(query(q), usd);
  return { p: Object.fromEntries(p), applies };
};

describe("generic shopping filters as eBay Browse parameters", () => {
  it("applies format, condition, seller and one seller country on eBay's side", () => {
    const { p, applies } = params({ format: ["auction", "best_offer"], condition: ["new", "used"], seller: "cardshop", sellerCountry: ["jp"] });
    expect(p["filter"]).toBe("itemLocationCountry:JP,buyingOptions:{AUCTION|BEST_OFFER},conditionIds:{1000|2750|3000|4000|5000|6000},sellers:{cardshop}");
    expect(applies).toMatchObject({ format: true, condition: true, seller: true, sellerCountry: true });
  });

  it("leaves to mcpy what eBay cannot apply exactly", () => {
    const { p, applies } = params({ format: ["wanted"], sellerCountry: ["jp", "hk"], seller: "a,b" });
    expect(p["filter"]).toBeUndefined();
    expect([applies.format, applies.sellerCountry, applies.seller]).toEqual([undefined, undefined, undefined]);
  });

  it("narrows a game to eBay's card category and Game aspect, with Language", () => {
    const { p, applies } = params({ game: "pokemon", language: ["ja", "en"] });
    expect(p["category_ids"]).toBe("183454");
    expect(p["aspect_filter"]).toBe("categoryId:183454,Game:{Pokémon TCG},Language:{Japanese|English}");
    expect(applies).toMatchObject({ game: true, language: true, category: false });
  });

  it("passes a category and its attributes, and claims attributes only with a category", () => {
    const withCat = params({ category: "183454", attributes: { Grade: ["10", "9.5"], "Professional Grader": ["Professional Sports Authenticator (PSA)"] } });
    expect(withCat.p["aspect_filter"]).toBe("categoryId:183454,Grade:{10|9.5},Professional Grader:{Professional Sports Authenticator (PSA)}");
    expect(withCat.applies).toMatchObject({ category: true, attributes: true });
    const without = params({ attributes: { Grade: ["10"] } });
    expect(without.p["aspect_filter"]).toBeUndefined();
    expect(without.applies.attributes).toBe(false);
  });

  it("asks for facets only on request", () => {
    expect(params({})).not.toHaveProperty("p.fieldgroups");
    expect(params({ facets: true }).p["fieldgroups"]).toBe("MATCHING_ITEMS,ASPECT_REFINEMENTS,CATEGORY_REFINEMENTS");
  });
});

describe("generic filters mcpy applies on the rows", () => {
  const row = (id: string, country?: string, seller?: string) => ({ marketplace: "leboncoin", id, url: `https://x.test/${id}`, title: "t", ...(country ? { country } : {}), ...(seller ? { seller: { name: seller } } : {}) }) as Listing;
  const input = (extra: Record<string, unknown>) => ShoppingSearchInputSchema.parse({ marketplaces: ["leboncoin"], query: "q", ...extra });

  it("keeps rows from the wanted seller countries and seller", () => {
    const rows = [row("1", "fr", "Ann"), row("2", "be", "bob"), row("3", "fr", "Bob")];
    expect(applyFilters(rows, input({ seller_country: ["fr"] }), { url: "x" }).rows.map((l) => l.id)).toEqual(["1", "3"]);
    expect(applyFilters(rows, input({ seller: "BOB" }), { url: "x" }).rows.map((l) => l.id)).toEqual(["2", "3"]);
  });

  it("trusts a site that applied a filter, and reports category and attributes ignored by a site without them", () => {
    const rows = [row("1", "fr")];
    expect(applyFilters(rows, input({ seller_country: ["jp"] }), { url: "x", applies: { sellerCountry: true } }).rows).toHaveLength(1);
    expect(applyFilters(rows, input({ category: "1", attributes: { Grade: ["10"] } }), { url: "x" }).ignored).toEqual(expect.arrayContaining(["category", "attributes"]));
  });
});

describe("facets", () => {
  it("returns eBay's categories and item specifics on the report, capped and most common first", async () => {
    const body = JSON.parse(fixture("ebay-americas/ebay-worldwide.json"));
    body.refinement = {
      categoryDistributions: [{ categoryId: "220", categoryName: "Toys & Hobbies", matchCount: 10 }, { categoryId: "2536", categoryName: "Collectible Card Games", matchCount: 40 }],
      aspectDistributions: [{ localizedAspectName: "Grade", aspectValueDistributions: [{ localizedAspectValue: "9", matchCount: 5 }, { localizedAspectValue: "10", matchCount: 50 }] }],
    };
    const content = JSON.stringify(body);
    const pages = { ...fakePages("direct", (req) => fakePage({ url: req.url, finalUrl: req.url, content, contentType: "application/json", kind: ContentKind.Json, format: PageFormat.Html })), capabilities: { headers: true } };
    const r = await testMcpy({ pages: [pages] }).mcpy.shopping({ marketplaces: ["ebay"], query: "charizard", facets: true });
    expect(r.marketplaces[0]!.facets).toEqual({
      categories: [{ id: "2536", name: "Collectible Card Games", count: 40 }, { id: "220", name: "Toys & Hobbies", count: 10 }],
      attributes: [{ name: "Grade", values: [{ value: "10", count: 50 }, { value: "9", count: 5 }] }],
    });
    expect(ebayWorldwide.search(query({ facets: true })).url).toContain("fieldgroups=");
  });
});
