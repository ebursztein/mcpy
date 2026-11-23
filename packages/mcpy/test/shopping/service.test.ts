import { describe, expect, it } from "vitest";
import { ErrorCode, MARKETPLACES, McpyError, PageFormat, ContentKind, type Listing } from "mcpy";
import { applyFilters } from "../../src/services/shopping/filters.js";
import { mergeSites } from "../../src/services/shopping/merge.js";
import { canonicalUrl, normalize } from "../../src/sites/normalize.js";
import { SITES } from "../../src/sites/registry.js";
import { yahooAuctions } from "../../src/sites/asia/yahoo-auctions.js";
import { fakePages, page, testMcpy } from "../helpers.js";
import { fixture } from "./site-harness.js";

const YAHOO = fixture("asia/yahoo-auctions.html");
const html = (content: string, url: string, overrides = {}) => page({ url, finalUrl: url, content, contentType: "text/html", kind: ContentKind.Html, format: PageFormat.Html, ...overrides });

function mcpyServing(content: string, overrides: Record<string, unknown> = {}) {
  const pages = fakePages("direct", (req) => html(content, req.url, overrides));
  return { pages, ...testMcpy({ pages: [pages] }) };
}

describe("shopping_search service", () => {
  it("returns normalized listings and a per-site report", async () => {
    const { mcpy, pages } = mcpyServing(YAHOO);
    const r = await mcpy.shopping({ marketplaces: ["yahoo_auctions"], query: "リザードン" });
    expect(r.results.map((l) => l.id)).toEqual(["k1253384371", "l1253388044", "o1253391213"]);
    expect(r.results.every((l) => l.marketplace === "yahoo_auctions")).toBe(true);
    expect(r.marketplaces[0]).toMatchObject({ marketplace: "yahoo_auctions", status: "ok", results: 3, http_status: 200 });
    expect(r.marketplaces[0]!.search_url).toContain("s1=new&o1=d");
    expect(pages.calls[0]).toMatchObject({ format: "html", userAgent: "chrome" });
    expect(r.next_cursor).toBeUndefined();
  });

  it("caps the listings returned", async () => {
    const { mcpy } = mcpyServing(YAHOO);
    const r = await mcpy.shopping({ marketplaces: ["yahoo_auctions"], query: "x", max_results: 2 });
    expect(r.results).toHaveLength(2);
  });

  it("reports a challenge page as failed: blocked, not as empty", async () => {
    const { mcpy } = mcpyServing("<html><head><title>Just a moment...</title></head><body>challenge-platform</body></html>");
    const r = await mcpy.shopping({ marketplaces: ["yahoo_auctions"], query: "x" });
    expect(r.results).toEqual([]);
    expect(r.marketplaces[0]).toMatchObject({ status: "failed", failure: "blocked" });
  });

  it("reports a redirect to another host as failed: redirected", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("direct", (req) => html(YAHOO, req.url, { finalUrl: "https://login.yahoo.co.jp/config/login" }))] });
    const r = await mcpy.shopping({ marketplaces: ["yahoo_auctions"], query: "x" });
    expect(r.marketplaces[0]).toMatchObject({ status: "failed", failure: "redirected", final_url: "https://login.yahoo.co.jp/config/login" });
  });

  it("reports a source failure without failing the call", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("direct", new McpyError(ErrorCode.Timeout, "deadline exceeded"))] });
    const r = await mcpy.shopping({ marketplaces: ["yahoo_auctions"], query: "x" });
    expect(r.marketplaces[0]).toMatchObject({ status: "failed", failure: "timeout", error: "timeout" });
  });

  it("refuses a cursor made for another search", async () => {
    const { mcpy } = mcpyServing(YAHOO);
    const err = await mcpy.shopping({ marketplaces: ["yahoo_auctions"], query: "x", cursor: "eyJrIjoibm9wZSIsInAiOjJ9" }).catch((e: McpyError) => e);
    expect((err as McpyError).code).toBe(ErrorCode.InvalidInput);
  });

  it("reads one listing with shopping_item from its JSON-LD Product", async () => {
    const product = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "リザードン 初版", sku: "k1253384371", description: "美品", image: ["https://auc-pctr.c.yimg.jp/a.jpg"], offers: { "@type": "Offer", price: "36000", priceCurrency: "JPY", availability: "https://schema.org/InStock", itemCondition: "https://schema.org/UsedCondition" } })}</script>`;
    const { mcpy } = mcpyServing(`<html><body>${product}</body></html>`);
    const r = await mcpy.shoppingItem({ url: "https://auctions.yahoo.co.jp/jp/auction/k1253384371" });
    expect(r).toMatchObject({ marketplace: "yahoo_auctions", id: "k1253384371", title: "リザードン 初版", price: { amount: 36000, currency: "JPY" }, condition: "used", status: "available", description: "美品" });
    expect(r.images).toEqual(["https://auc-pctr.c.yimg.jp/a.jpg"]);
  });

  it("refuses shopping_item for a site it does not know", async () => {
    const { mcpy } = mcpyServing(YAHOO);
    const err = await mcpy.shoppingItem({ url: "https://example.com/item/1" }).catch((e: McpyError) => e);
    expect((err as McpyError).code).toBe(ErrorCode.InvalidInput);
  });
});

describe("normalize", () => {
  const base = "https://auctions.yahoo.co.jp/search/search?p=x";
  it("keeps only listings on the site, without tracking parameters", () => {
    expect(canonicalUrl(yahooAuctions, "/jp/auction/k1253384371?utm_source=x&_trksid=1#photos", base)?.href).toBe("https://auctions.yahoo.co.jp/jp/auction/k1253384371");
    expect(canonicalUrl(yahooAuctions, "https://evil.example/jp/auction/k1253384371", base)).toBeUndefined();
    expect(normalize(yahooAuctions, { url: "/help/page", title: "Help" }, base)).toBeUndefined();
  });

  it("drops a bad field, never the row", () => {
    const l = normalize(yahooAuctions, { url: "/jp/auction/k1253384371", title: "x", price: "¥36,000", postedAt: "3 days ago", postedText: "3日前", image: "javascript:alert(1)", country: "XX" }, base)!;
    expect(l).toMatchObject({ id: "k1253384371", price: { amount: 36000, currency: "JPY" }, posted_text: "3日前" });
    expect(l.posted_at).toBeUndefined();
    expect(l.image).toBeUndefined();
    expect(l.country).toBeUndefined();
  });
});

describe("filters", () => {
  const row = (id: string, amount?: number, extra: Partial<Listing> = {}): Listing =>
    ({ marketplace: "yahoo_auctions", id, url: `https://auctions.yahoo.co.jp/jp/auction/${id}`, title: id, ...(amount ? { price: { amount, currency: "JPY" } } : {}), ...extra }) as Listing;
  const input = (over: Record<string, unknown>) => ({ marketplaces: ["yahoo_auctions"], query: "x", sort: "relevance", max_results: 60, max_products: 3, max_age: 900, ...over }) as never;

  it("applies a price floor the site did not, and says so only when no row has a price", () => {
    expect(applyFilters([row("a", 10), row("b", 600), row("c")], input({ min_price: 500 }), { url: "x" }).rows.map((l) => l.id)).toEqual(["b"]);
    expect(applyFilters([row("a"), row("b")], input({ min_price: 500 }), { url: "x" }).ignored).toEqual(["min_price"]);
    expect(applyFilters([row("a", 10)], input({ min_price: 500 }), { url: "x", applies: { minPrice: true } }).rows).toHaveLength(1);
  });

  it("keeps card grades at or above the one asked", () => {
    const rows = [row("nm", 1, { card_condition: "near_mint" }), row("po", 1, { card_condition: "poor" }), row("ex", 1, { card_condition: "excellent" })];
    expect(applyFilters(rows, input({ card_condition: "excellent" }), { url: "x" }).rows.map((l) => l.id)).toEqual(["nm", "ex"]);
  });

  it("interleaves sites so one site cannot crowd out the others", () => {
    expect(mergeSites([{ key: "a", rows: [row("a1"), row("a2"), row("a3")] }, { key: "b", rows: [row("b1")] }], 3).results.map((l) => l.id)).toEqual(["a1", "b1", "a2"]);
  });
});

describe("registry", () => {
  it("has exactly one reader for every marketplace key", () => {
    const missing = MARKETPLACES.filter((k) => !SITES[k]);
    expect(missing, `no reader for ${missing.join(", ")}`).toEqual([]);
    for (const [key, site] of Object.entries(SITES)) expect(site!.key).toBe(key);
  });
});
