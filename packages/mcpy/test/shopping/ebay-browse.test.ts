import { describe, expect, it } from "vitest";
import { ContentKind, PageFormat } from "mcpy";
import { McpyError, ErrorCode } from "mcpy";
import { ListingMarket, type ListingProvider } from "mcpy/providers";
import { ebayWorldwide } from "../../src/sites/ebay/browse.js";
import { ebaySites } from "../../src/sites/ebay/index.js";
import { fakePages, page as fakePage, testMcpy } from "../helpers.js";
import { fixture, listings, query } from "./site-harness.js";

const fx = () => fixture("ebay-americas/ebay-worldwide.json");
const byId = (id: string) => listings(ebayWorldwide, fx()).listings.find((l) => l.id === id)!;

describe("ebay (every eBay site)", () => {
  it("reads eBay's item summaries, one listing per item number", () => {
    const { outcome, listings: ls } = listings(ebayWorldwide, fx());
    expect(outcome).toMatchObject({ kind: "results", hasMore: true });
    expect(ls).toHaveLength(16);
    expect(new Set(ls.map((l) => l.id)).size).toBe(16);
    for (const l of ls) expect(l.url).toBe(`https://www.ebay.com/itm/${l.id}`);
  });

  it("states the seller's own price, not eBay's USD conversion", () => {
    const de = byId("840159106517");
    expect(de).toMatchObject({ price: { amount: 44.99, currency: "EUR" }, shipping: { amount: 8.99, currency: "EUR" }, format: "best_offer", country: "de" });
    expect(de.price_converted).toBeUndefined();
    expect(de.details).toMatchObject({ "USD price": "49.35", "eBay site": "EBAY_DE", Condition: "Bewertet" });
    expect(byId("800956955132")).toMatchObject({ price: { amount: 235.67, currency: "USD" }, country: "jp", seller: { name: expect.any(String) } });
  });

  it("reads auctions: current bid, bids, end time, and buy-now when offered", () => {
    expect(byId("287734190199")).toMatchObject({ format: "auction", price: { amount: 1550, currency: "GBP" }, auction: { bids: 22, ends_at: expect.any(String) }, country: "gb" });
    const both = byId("860149582185");
    expect(both).toMatchObject({ format: "auction", price: { amount: 120, currency: "USD" }, auction: { bids: 0, buy_now: { amount: 168, currency: "USD" } }, condition: "new" });
  });

  it("leaves shipping out when eBay calculates it, and reads graded cards (2750) as used", () => {
    const calc = byId("800956954906");
    expect(calc.shipping).toBeUndefined();
    expect(calc.condition).toBe("used");
    expect(byId("960209266249").condition).toBe("used");
  });

  it("asks with the Referer and cookies, eBay's sort, USD bounds and offset paging", () => {
    const req = ebayWorldwide.search(query({ sort: "price_low", minPrice: 500, page: 3 }));
    const url = new URL(req.url);
    expect(url.origin + url.pathname).toBe("https://picclick.com/search.php");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "charizard", limit: "60", offset: "120", sort: "price", filter: "price:[500..],priceCurrency:USD" });
    expect(req.headers).toEqual({ referer: "https://picclick.com/", cookie: "lasturl=x; slider=1" });
    expect(req.applies).toMatchObject({ sort: true, minPrice: true, maxPrice: true });
    expect(new URL(ebayWorldwide.search(query({ sort: "relevance" })).url).searchParams.has("sort")).toBe(false);
  });

  it("reads no results as empty, the bare empty answer as blocked, eBay errors as upstream", () => {
    expect(listings(ebayWorldwide, '{"href":"x","total":0,"limit":60,"offset":0}').outcome.kind).toBe("empty");
    expect(listings(ebayWorldwide, "").outcome).toMatchObject({ kind: "failed", failure: "blocked" });
    expect(listings(ebayWorldwide, '{"errors":[{"message":"Invalid filter"}]}').outcome).toMatchObject({ kind: "failed", failure: "upstream_failed" });
    expect(listings(ebayWorldwide, "<html><body>new site</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
  });

  it("serves a call end to end with the seller.s own prices", async () => {
    const json = fx();
    // The direct provider declares it can send headers; the request needs its Referer and cookies.
    const pages = { ...fakePages("direct", (req) => fakePage({ url: req.url, finalUrl: req.url, content: json, contentType: "application/json", kind: ContentKind.Json, format: PageFormat.Html })), capabilities: { headers: true } };
    const r = await testMcpy({ pages: [pages] }).mcpy.shopping({ marketplaces: ["ebay"], query: "charizard" });
    expect(r.marketplaces[0]).toMatchObject({ marketplace: "ebay", status: "ok", results: 16 });
    expect(r.results.find((l) => l.id === "840159106517")!.price).toEqual({ amount: 44.99, currency: "EUR" });
    expect(pages.calls[0]!.headers).toMatchObject({ referer: "https://picclick.com/" });
  });
});

const store = (key: string) => ebaySites.find((s) => s.key === key)!;
const json = (content: string, url: string) => fakePage({ url, finalUrl: url, content, contentType: "application/json", kind: ContentKind.Json, format: PageFormat.Html });
const html = (content: string, url: string) => fakePage({ url, finalUrl: url, content, contentType: "text/html", kind: ContentKind.Html, format: PageFormat.Html });
const isFeed = (url: string) => url.startsWith("https://picclick.com/");

describe("eBay sources: the Browse feed first, then the page, then the listing API", () => {
  it("asks a country store for sellers in its country, bounds in its currency, rows on its own domain", () => {
    const de = store("ebay_de");
    const url = new URL(de.feed!.search(query({ query: "glurak", minPrice: 100 })).url);
    expect(url.searchParams.get("filter")).toBe("itemLocationCountry:DE,price:[100..],priceCurrency:EUR");
    expect(new URL(de.feed!.search(query({ sellerCountry: ["jp"] })).url).searchParams.get("filter")).toBe("itemLocationCountry:JP");
    const read = de.feed!.read({ url: "x", finalUrl: "x", status: 200, content: fx() }, query());
    expect(read.kind === "results" && read.rows[0]!.url).toMatch(/^https:\/\/www\.ebay\.de\/itm\/\d+$/);
  });

  it("serves a country store from the feed alone when it answers", async () => {
    const pages = { ...fakePages("direct", (req) => (isFeed(req.url) ? json(fx(), req.url) : html("<html></html>", req.url))), capabilities: { headers: true } };
    const r = await testMcpy({ pages: [pages] }).mcpy.shopping({ marketplaces: ["ebay_de"], query: "glurak" });
    expect(pages.calls.map((c) => isFeed(c.url))).toEqual([true]);
    expect(r.marketplaces[0]).toMatchObject({ status: "ok", results: 16 });
    expect(isFeed(r.marketplaces[0]!.search_url)).toBe(true);
    expect(r.results.every((l) => l.url.startsWith("https://www.ebay.de/itm/"))).toBe(true);
  });

  it("reads the search page when the feed fails", async () => {
    const uk = fixture("ebay-americas/ebay-uk.html");
    const pages = { ...fakePages("direct", (req) => (isFeed(req.url) ? json("", req.url) : html(uk, req.url))), capabilities: { headers: true } };
    const r = await testMcpy({ pages: [pages] }).mcpy.shopping({ marketplaces: ["ebay_uk"], query: "charizard" });
    expect(pages.calls.map((c) => isFeed(c.url))).toEqual([true, false]);
    expect(r.marketplaces[0]).toMatchObject({ status: "ok" });
    expect(r.marketplaces[0]!.search_url).toMatch(/^https:\/\/www\.ebay\.co\.uk\/sch\//);
    expect(r.results.length).toBeGreaterThan(0);
  });

  it("takes an empty feed answer as the store's own no results", async () => {
    const pages = { ...fakePages("direct", (req) => json('{"total":0,"limit":60,"offset":0}', req.url)), capabilities: { headers: true } };
    const r = await testMcpy({ pages: [pages] }).mcpy.shopping({ marketplaces: ["ebay_fr"], query: "qzxj" });
    expect(pages.calls).toHaveLength(1);
    expect(r.marketplaces[0]!.status).toBe("empty");
  });

  it("falls back to the listing API when the feed and every page source fail", async () => {
    const calls: unknown[] = [];
    const listings: ListingProvider = {
      id: "listings",
      costPerCall: 0.0004,
      markets: [ListingMarket.EbayUs],
      async searchListings(req) {
        calls.push(req);
        return { rows: [{ url: "https://www.ebay.com/itm/840111465672", id: "840111465672", title: "Charizard", price: { amount: 11.99, currency: "USD" }, images: [] }], hasMore: false };
      },
    };
    const pages = { ...fakePages("direct", new McpyError(ErrorCode.UpstreamFailed, "every source failed", ["escalate (HTTP 403)"])), capabilities: { headers: true } };
    const r = await testMcpy({ pages: [pages], listings: [listings] }).mcpy.shopping({ marketplaces: ["ebay"], query: "charizard" });
    expect(calls).toHaveLength(1);
    expect(r.results.map((l) => l.id)).toEqual(["840111465672"]);
  });
});
