/**
 * 2026-11-23: eBay.com and eBay.de failed on every page source from
 * Cloudflare (403, 502, timeout), so ebay_us and ebay_de returned nothing.
 * A listing API now stands in for the search page, only after every page
 * source failed. Never delete these.
 */

import { describe, expect, it } from "vitest";
import { ContentKind, ErrorCode, McpyError, PageFormat } from "mcpy";
import { ListingMarket, ListingSort, type ListingPage, type ListingProvider, type ListingRequest } from "mcpy/providers";
import { ebaySites } from "../../src/sites/ebay/index.js";
import { fakePages, page, testMcpy } from "../helpers.js";
import { fixture, query } from "../shopping/site-harness.js";

const ebayUs = ebaySites.find((s) => s.key === "ebay_us")!;
const ebayDe = ebaySites.find((s) => s.key === "ebay_de")!;

const blocked = () => fakePages("direct", new McpyError(ErrorCode.UpstreamFailed, "every source failed for this request", ["escalate (HTTP 403)", "escalate (HTTP 502)"]));
const html = (content: string, url: string) => page({ url, finalUrl: url, content, contentType: "text/html", kind: ContentKind.Html, format: PageFormat.Html });

const LIVE_ROW = {
  url: "https://www.ebay.com/itm/840111465672",
  id: "840111465672",
  title: "OVER 36+ Rare Pokemon Cards! Holo EX GX Full Art Ultra Rare Vintage Modern Mix",
  price: { amount: 11.99, currency: "USD" },
  condition: "Pre-Owned",
  shipping: "+$4.64 delivery in 2-4 days",
  images: ["https://i.ebayimg.com/images/g/oygAAeSwHQVqNXVA/s-l500.webp"],
};

function fakeListings(answer: ListingPage | Error, costPerCall = 0.0004): ListingProvider & { calls: ListingRequest[] } {
  const calls: ListingRequest[] = [];
  return {
    id: "listings",
    costPerCall,
    markets: [ListingMarket.EbayUs, ListingMarket.EbayDe],
    calls,
    async searchListings(req) {
      calls.push(req);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

describe("eBay listing API fallback", () => {
  it("asks the API for the site's market, sort, bounds and page", () => {
    const { listing, applies } = ebayDe.api!.request(query({ query: "glurak", sort: "newest", minPrice: 50, page: 2 }));
    expect(listing).toEqual({ market: ListingMarket.EbayDe, query: "glurak", sort: ListingSort.Newest, minPrice: 50, maxPrice: undefined, page: 2 });
    expect(applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads API rows as the site's listings, on the site's own host", () => {
    const out = ebayDe.api!.read({ rows: [{ ...LIVE_ROW, url: "https://www.ebay.com/itm/840111465672", shipping: "Kostenlose Lieferung", condition: "Neu" }], hasMore: true, total: 12 });
    expect(out).toMatchObject({ kind: "results", total: 12, hasMore: true });
    expect(out.kind === "results" && out.rows[0]).toMatchObject({ url: "https://www.ebay.de/itm/840111465672", shipping: "free", condition: "new", price: 11.99, currency: "USD" });
    expect(ebayDe.api!.read({ rows: [], hasMore: false })).toEqual({ kind: "empty" });
  });

  it("serves a site whose page every source refused, and reports it ok", async () => {
    const listings = fakeListings({ rows: [LIVE_ROW], hasMore: true });
    const { mcpy } = testMcpy({ pages: [blocked()], listings: [listings] });
    const r = await mcpy.shopping({ marketplaces: ["ebay_us"], query: "charizard", min_price: 50 });
    expect(listings.calls).toEqual([{ market: ListingMarket.EbayUs, query: "charizard", sort: ListingSort.Newest, minPrice: 50, maxPrice: undefined, page: 1 }]);
    // The API applied the floor: mcpy does not filter its rows again (this row is under it).
    expect(r.results.map((l) => [l.id, l.url, l.price])).toEqual([["840111465672", "https://www.ebay.com/itm/840111465672", { amount: 11.99, currency: "USD" }]]);
    expect(r.marketplaces[0]).toMatchObject({ status: "ok", results: 1, search_url: ebayUs.search(query({ query: "charizard", minPrice: 50 })).url });
    expect(r.marketplaces[0]!.http_status).toBeUndefined();
    expect(r.next_cursor).toBeDefined();
  });

  it("is never asked when the page source answers", async () => {
    const listings = fakeListings({ rows: [LIVE_ROW], hasMore: false });
    const { mcpy } = testMcpy({ pages: [fakePages("direct", (req) => html(fixture("ebay-americas/ebay-uk.html").replace(/www\.ebay\.co\.uk/g, "www.ebay.com"), req.url))], listings: [listings] });
    await mcpy.shopping({ marketplaces: ["ebay_us"], query: "charizard" });
    expect(listings.calls).toHaveLength(0);
  });

  it("does not stand in for a page that says the site changed or moved", async () => {
    const listings = fakeListings({ rows: [LIVE_ROW], hasMore: false });
    const { mcpy } = testMcpy({ pages: [fakePages("direct", (req) => html("<html><body>new layout</body></html>", req.url))], listings: [listings] });
    const r = await mcpy.shopping({ marketplaces: ["ebay_us"], query: "charizard" });
    expect(r.marketplaces[0]).toMatchObject({ status: "failed", failure: "redesigned" });
    expect(listings.calls).toHaveLength(0);
  });

  it("keeps the page failure when the API fails too", async () => {
    const listings = fakeListings(new Error("request_failed"));
    const { mcpy } = testMcpy({ pages: [blocked()], listings: [listings] });
    const r = await mcpy.shopping({ marketplaces: ["ebay_us"], query: "charizard" });
    expect(listings.calls).toHaveLength(1);
    expect(r.marketplaces[0]).toMatchObject({ status: "failed", failure: "blocked" });
  });

  it("is not tried for a market no listing source serves, nor for sites without an API read", async () => {
    const listings = fakeListings({ rows: [LIVE_ROW], hasMore: false });
    const usOnly = { ...listings, markets: [ListingMarket.EbayUs] };
    const { mcpy } = testMcpy({ pages: [blocked()], listings: [usOnly] });
    const r = await mcpy.shopping({ marketplaces: ["ebay_de", "yahoo_auctions"], query: "x" });
    expect(listings.calls).toHaveLength(0);
    expect(r.marketplaces.map((m) => m.status)).toEqual(["failed", "failed"]);
  });
});
