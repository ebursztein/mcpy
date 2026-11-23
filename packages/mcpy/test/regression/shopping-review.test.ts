/**
 * 2026-11-22, Fable review of shopping_search before it shipped. Each test
 * pins one defect it found. Never delete these.
 */

import { describe, expect, it } from "vitest";
import { ContentKind, PageFormat, type Listing } from "mcpy";
import { advance } from "../../src/services/shopping/paging.js";
import { failureOf } from "../../src/services/shopping/fetch-site.js";
import { looksBlocked } from "../../src/sites/readers/html.js";
import { fakePages, page, testMcpy } from "../helpers.js";
import { fixture } from "../shopping/site-harness.js";

const html = (content: string, url: string, over: Record<string, unknown> = {}) =>
  page({ url, finalUrl: url, content, contentType: "text/html", kind: ContentKind.Html, format: PageFormat.Html, ...over });
const YAHOO = fixture("asia/yahoo-auctions.html");

describe("shopping review regressions", () => {
  it("returns the rows past max_results on the next call instead of losing them", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("direct", (r) => html(YAHOO, r.url))] });
    const first = await mcpy.shopping({ marketplaces: ["yahoo_auctions"], query: "x", max_results: 2 });
    expect(first.results.map((l: Listing) => l.id)).toEqual(["k1253384371", "l1253388044"]);
    expect(first.marketplaces[0]!.results).toBe(2);
    const second = await mcpy.shopping({ marketplaces: ["yahoo_auctions"], query: "x", max_results: 2, cursor: first.next_cursor });
    expect(second.results.map((l: Listing) => l.id)).toEqual(["o1253391213"]);
    expect(second.next_cursor).toBeUndefined();
  });

  it("walks a product site's products before its next search page", () => {
    const at = { p: 1, o: 0, x: 0 };
    expect(advance({ at, available: 5, returned: 5, products: 24, opened: 3, hasMore: true, stop: false })).toEqual({ p: 1, o: 0, x: 3 });
    expect(advance({ at: { p: 1, o: 0, x: 21 }, available: 2, returned: 2, products: 24, opened: 3, hasMore: true, stop: false })).toEqual({ p: 2, o: 0, x: 0 });
    expect(advance({ at, available: 9, returned: 4, products: 24, opened: 3, hasMore: true, stop: false })).toEqual({ p: 1, o: 4, x: 0 });
    // A cursor-paged site's token too long to carry ends the site instead of a broken next page.
    expect(advance({ at, available: 1, returned: 1, hasMore: true, nextToken: "t".repeat(5_000), stop: false })).toBeUndefined();
  });

  it("keeps a site's place after a transient failure, up to two retries (second review: one timeout dropped the rest of a site)", () => {
    const at = { p: 3, o: 0, x: 0 };
    const failed = { at, available: 0, returned: 0, hasMore: false, stop: false, retry: true };
    expect(advance(failed)).toEqual({ p: 3, o: 0, x: 0, r: 1 });
    expect(advance({ ...failed, at: { ...at, r: 2 } })).toBeUndefined();
    // A success clears the retry count.
    expect(advance({ at: { ...at, r: 1 }, available: 3, returned: 3, hasMore: true, stop: false })).toEqual({ p: 4, o: 0, x: 0 });
  });

  it("reports a site every source refused as blocked, not upstream_failed", async () => {
    expect(failureOf("upstream_failed", ["escalate (bot challenge detected)", "error (HTTP 403)"])).toBe("blocked");
    expect(failureOf("upstream_failed", ["error (timed out)"])).toBe("upstream_failed");
    const challenge = '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></body></html>';
    const { mcpy } = testMcpy({ pages: [fakePages("direct", (r) => html(challenge, r.url, { title: "Just a moment..." }))] });
    const r = await mcpy.shopping({ marketplaces: ["yahoo_auctions"], query: "x" });
    expect(r.marketplaces[0]).toMatchObject({ status: "failed", failure: "blocked" });
  });

  it("does not read a result page as blocked because the query or a listing title says so", () => {
    expect(looksBlocked("<html><title>Access Denied LP for sale | eBay</title></html>")).toBe(false);
    expect(looksBlocked("<html><title>security check sign - Yahoo!オークション</title></html>")).toBe(false);
    expect(looksBlocked("<html><title>Access Denied</title></html>")).toBe(true);
  });

  it("drops a bad image on shopping_item instead of failing the call", async () => {
    const product = { "@type": "Product", name: "リザードン", sku: "k1253384371", image: ["/img/a.jpg", "javascript:alert(1)", ""], offers: { price: "36000", priceCurrency: "JPY" } };
    const body = `<html><body><script type="application/ld+json">${JSON.stringify(product)}</script></body></html>`;
    const { mcpy } = testMcpy({ pages: [fakePages("direct", (r) => html(body, r.url))] });
    const r = await mcpy.shoppingItem({ url: "https://auctions.yahoo.co.jp/jp/auction/k1253384371" });
    expect(r.images).toEqual(["https://auctions.yahoo.co.jp/img/a.jpg"]);
  });

  it("refuses shopping_item on a card marketplace, whose listing URL is a product page shared by every seller", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("direct", (r) => html("<html></html>", r.url))] });
    const err = await mcpy.shoppingItem({ url: "https://www.cardmarket.com/en/Pokemon/Products/Singles/Base-Set/Charizard-V1-BS4" }).catch((e: Error) => e);
    expect((err as { code?: string }).code).toBe("invalid_input");
  });

  it("lets a site without a game asked search across games (TCGplayer searched Pokémon lines only)", async () => {
    const { tcgplayer } = await import("../../src/sites/cards/tcgplayer.js");
    const req = tcgplayer.search({ query: "black lotus", sort: "relevance", page: 1 });
    expect(JSON.parse(req.body!).filters.term).toEqual({});
  });

  it("drops a price in a stated currency it cannot name instead of relabelling it", async () => {
    const { normalize } = await import("../../src/sites/normalize.js");
    const { yahooAuctions } = await import("../../src/sites/asia/yahoo-auctions.js");
    const base = "https://auctions.yahoo.co.jp/search/search?p=x";
    expect(normalize(yahooAuctions, { url: "/jp/auction/k1253384371", title: "x", price: "12", currency: "USDT" }, base)!.price).toBeUndefined();
    expect(normalize(yahooAuctions, { url: "/jp/auction/k1253384371", title: "x", price: "1200", currency: "¥" }, base)!.price).toEqual({ amount: 1200, currency: "JPY" });
  });
});
