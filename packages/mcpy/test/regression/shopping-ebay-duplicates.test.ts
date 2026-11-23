/**
 * 2026-11-23 (cardy): one eBay listing came back once per eBay site, each
 * priced for that site's buyers (363704565554: 5,199 EUR on ebay_de and
 * ebay_es, 5,270.07 EUR on ebay_it). Live the same day, an Italian seller's
 * 500,000 EUR listing showed as 419,137.88 GBP on ebay_uk. A call now returns
 * each eBay listing once, preferring the site where it is not from abroad,
 * and marks a price eBay localized as price_converted. Never delete these.
 */

import { describe, expect, it } from "vitest";
import { ContentKind, PageFormat } from "mcpy";
import { mergeSites } from "../../src/services/shopping/merge.js";
import type { Listing } from "../../src/services/shopping/schema.js";
import { ebaySites } from "../../src/sites/ebay/index.js";
import { fakePages, page, testMcpy } from "../helpers.js";
import { fixture, listings, query } from "../shopping/site-harness.js";

const ebayUk = ebaySites.find((s) => s.key === "ebay_uk")!;
const html = (content: string, url: string) => page({ url, finalUrl: url, content, contentType: "text/html", kind: ContentKind.Html, format: PageFormat.Html });

const row = (marketplace: string, id: string, amount: number, currency: string, converted?: boolean): Listing =>
  ({ marketplace, id, url: `https://example.com/itm/${id}`, title: "Charizard", price: { amount, currency }, ...(converted ? { price_converted: true } : {}) }) as Listing;

describe("eBay listings across eBay sites", () => {
  it("marks cards from abroad as converted, and home cards not", () => {
    const { listings: ls } = listings(ebayUk, fixture("ebay-americas/ebay-uk.html"), undefined, (p) => ebayUk.read(p, query({ query: "charizard" })));
    const abroad = ls.filter((l) => l.location === "United States");
    expect(abroad.length).toBeGreaterThan(0);
    for (const l of abroad) expect(l.price_converted).toBe(true);
    for (const l of ls.filter((l) => l.location === undefined)) expect(l.price_converted).toBeUndefined();
  });

  it("returns each listing once, from the site that states the seller's own price", () => {
    const { results, consumed } = mergeSites(
      [
        { key: "ebay_uk", pool: "ebay", rows: [row("ebay_uk", "287699301644", 419137.88, "GBP", true), row("ebay_uk", "1", 5, "GBP")] },
        { key: "ebay_de", pool: "ebay", rows: [row("ebay_de", "287699301644", 500000, "EUR", true)] },
        { key: "ebay_it", pool: "ebay", rows: [row("ebay_it", "287699301644", 500000, "EUR")] },
      ],
      60,
    );
    expect(results.map((l) => [l.marketplace, l.id, l.price?.amount])).toEqual([
      ["ebay_it", "287699301644", 500000],
      ["ebay_uk", "1", 5],
    ]);
    // Duplicates are consumed, so the next call does not return them again.
    expect(Object.fromEntries(consumed)).toEqual({ ebay_uk: 2, ebay_de: 1, ebay_it: 1 });
  });

  it("keeps a duplicate's result slot free, and never merges sites outside a pool", () => {
    const dup = mergeSites(
      [
        { key: "ebay_de", pool: "ebay", rows: [row("ebay_de", "9", 1, "EUR"), row("ebay_de", "10", 1, "EUR")] },
        { key: "ebay_es", pool: "ebay", rows: [row("ebay_es", "9", 1, "EUR", true), row("ebay_es", "11", 1, "EUR")] },
      ],
      3,
    );
    expect(dup.results.map((l) => `${l.marketplace}:${l.id}`)).toEqual(["ebay_de:9", "ebay_de:10", "ebay_es:11"]);
    const apart = mergeSites([{ key: "rakuma", rows: [row("rakuma", "9", 1, "JPY")] }, { key: "mercari_jp", rows: [row("mercari_jp", "9", 1, "JPY")] }], 60);
    expect(apart.results).toHaveLength(2);
  });

  it("dedupes a real call over two eBay sites serving the same listings", async () => {
    const uk = fixture("ebay-americas/ebay-uk.html");
    const pages = fakePages("direct", (req) => html(req.url.includes("ebay.co.uk") ? uk : uk.replace(/www\.ebay\.co\.uk/g, "www.ebay.com"), req.url));
    const r = await testMcpy({ pages: [pages] }).mcpy.shopping({ marketplaces: ["ebay_uk", "ebay_us"], query: "charizard" });
    const ids = r.results.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
