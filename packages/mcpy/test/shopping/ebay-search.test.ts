import { describe, expect, it } from "vitest";
import { ebayCard, hiddenLabels } from "../../src/sites/ebay/card.js";
import { ebaySites } from "../../src/sites/ebay/index.js";
import type { ShoppingSite } from "../../src/sites/types.js";
import { blocks } from "../../src/sites/readers/html.js";
import { expectBlockedReadsFailed, fixture, listings, query } from "./site-harness.js";

const site = (key: string): ShoppingSite => ebaySites.find((s) => s.key === key)!;
const ebayUk = site("ebay_uk");
const ebayUs = site("ebay_us");
const ebayDe = site("ebay_de");

describe("ebay sites", () => {
  it("has one site per domain, each in its own currency", () => {
    expect(ebaySites.map((s) => [s.key, s.host, s.currency])).toEqual([
      ["ebay_us", "www.ebay.com", "USD"],
      ["ebay_uk", "www.ebay.co.uk", "GBP"],
      ["ebay_de", "www.ebay.de", "EUR"],
      ["ebay_fr", "www.ebay.fr", "EUR"],
      ["ebay_it", "www.ebay.it", "EUR"],
      ["ebay_es", "www.ebay.es", "EUR"],
    ]);
  });

  it("applies sort, price, page size and page on the site", () => {
    const req = ebayDe.search(query({ query: "black lotus", minPrice: 50, maxPrice: 900, page: 3 }));
    expect(req.url).toBe("https://www.ebay.de/sch/i.html?_nkw=black+lotus&_sop=10&_udlo=50&_udhi=900&_ipg=60&_pgn=3&rt=nc");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(req.render).toBeUndefined();
    expect(ebayUs.search(query({ sort: "price_low" })).url).toContain("_sop=15");
    expect(ebayUs.search(query({ sort: "ending_soon" })).url).toContain("_sop=1&");
  });
});

describe("ebay_uk search page", () => {
  const { outcome, listings: ls } = listings(ebayUk, fixture("ebay-americas/ebay-uk.html"));

  it("reads the s-card rows with clean item URLs", () => {
    expect(outcome).toMatchObject({ kind: "results", total: 190_000, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["287744669840", "287744671209", "147692464154", "287744671205"]);
    for (const l of ls) expect(l.url).toBe(`https://www.ebay.co.uk/itm/${l.id}`);
  });

  it("reads an auction: current bid, bids, delivery, location, condition, listed age", () => {
    expect(ls[1]).toMatchObject({
      title: "Pokemon Charizard Holo Secret Rare Stormfront 103/100 PSA 9 Mint",
      price: { amount: 0.76, currency: "GBP" },
      format: "auction",
      auction: { bids: 0 },
      shipping: { amount: 19.67, currency: "GBP" },
      condition: "new",
      location: "United States",
      posted_text: "Listed 1m ago",
      promoted: false,
    });
    expect(ls[1]!.image).toMatch(/^https:\/\/i\.ebayimg\.com\//);
  });

  it("keeps the VAT note out of the delivery price and marks best offer on auctions", () => {
    expect(ls[2]).toMatchObject({ condition: "used", shipping: { amount: 9.13, currency: "GBP" }, details: { Condition: "Pre-owned", "Best offer": "yes" } });
  });
});

describe("ebay_us search page", () => {
  it("reads rows in USD with Located in", () => {
    const { outcome, listings: ls } = listings(ebayUs, fixture("ebay-americas/ebay-us.html"));
    expect(outcome.kind).toBe("results");
    expect(ls).toHaveLength(4);
    for (const l of ls) {
      expect(l.price?.currency).toBe("USD");
      expect(l.url).toMatch(/^https:\/\/www\.ebay\.com\/itm\/\d+$/);
    }
    expect(ls[0]).toMatchObject({ format: "auction", location: "United States" });
  });
});

describe("ebay empty and filler pages", () => {
  it("reads rows after 'Results matching fewer words' as not results: empty", () => {
    expect(listings(ebayDe, fixture("ebay-americas/ebay-de-fewer-words.html")).outcome).toEqual({ kind: "empty" });
  });

  it("reads the no-exact-matches page as empty", () => {
    expect(listings(ebayUs, fixture("ebay-americas/ebay-us-empty.html")).outcome).toEqual({ kind: "empty" });
  });

  it("reads a page without the result list as redesigned and a challenge as failed", () => {
    expect(listings(ebayUs, "<html><body>new layout</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    for (const s of ebaySites) expectBlockedReadsFailed(s);
  });
});

describe("ebay card details", () => {
  const html = fixture("ebay-americas/ebay-de-fewer-words.html");
  const labels = hiddenLabels(html);
  const cards = blocks(html, /<li\b[^>]*class="s-card\b/);
  const words = { bids: /^(\d+)\s+Gebote?$/i, bestOffer: /Preisvorschlag/i, buyNow: /Sofort-Kaufen/i, freeShipping: /^Kostenlos/i, location: /^aus (.+)$/, listed: /^Eingestellt\b.*$/, timeLeft: /^Noch .+$/, seller: /^$/ };

  it("reads the hidden Anzeige label as promoted, EUR prices and the private-seller note", () => {
    const row = ebayCard(cards[0]!, "www.ebay.de", words, labels)!;
    expect(row).toMatchObject({ url: "https://www.ebay.de/itm/377656879877", price: "EUR 80,00", currency: "EUR", format: "best_offer", promoted: true, postedText: "Eingestellt am Nov. 18" });
    expect(row.details).toMatchObject({ Condition: "Neu (Sonstige)", "Seller type": "Privat" });
  });

  it("drops cards whose link is not an item on the site (eBay's 'Shop on eBay' placeholders)", () => {
    const placeholder = cards[0]!.replace(/https:\/\/www\.ebay\.de\/itm\/377656879877/g, "https://ebay.com/itm/123456");
    expect(ebayCard(placeholder, "www.ebay.de", words, labels)).toBeUndefined();
  });
});
