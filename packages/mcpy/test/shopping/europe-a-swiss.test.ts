import { describe, expect, it } from "vitest";
import { ricardo } from "../../src/sites/europe/a/ricardo.js";
import { anibis, searchToken, tutti } from "../../src/sites/europe/a/tutti.js";
import type { ShoppingSite } from "../../src/sites/types.js";
import { expectBlockedReadsFailed, fixture, listings, query } from "./site-harness.js";

const NONSENSE = "qzxjvwk glurak zzqv";
const read = (site: ShoppingSite, file: string, q: string) => listings(site, fixture(`europe-a/${file}`), undefined, (p) => site.read(p, query({ query: q })));

describe("ricardo", () => {
  it("reads articles from the flight data: auctions, buy-now, promo", () => {
    const { outcome, listings: ls } = read(ricardo, "ricardo.html", "pokemon");
    expect(outcome).toMatchObject({ kind: "results", total: 89156 });
    expect(ls).toHaveLength(5);
    expect(ls[0]).toMatchObject({
      id: "1336503844",
      url: "https://www.ricardo.ch/de/a/ab-1-xxl-pokemon-sammlung-ueber-5000-karten-en-zubehoer-1336503844/",
      price: { amount: 2, currency: "CHF" },
      format: "auction",
      auction: { bids: 1, ends_at: "2026-11-29T21:54:00Z" },
      shipping: { amount: 22.5 },
      location: "Basel",
      promoted: true,
    });
    expect(ls[1]!.auction?.buy_now).toEqual({ amount: 8, currency: "CHF" });
  });

  it("keeps titles with every word; empty page; filters in the URL", () => {
    const { listings: ls } = read(ricardo, "ricardo-black-lotus.html", "black lotus");
    expect(ls.length).toBeGreaterThan(0);
    for (const l of ls) expect(l.title.toLowerCase()).toContain("black lotus");
    expect(read(ricardo, "ricardo-empty.html", NONSENSE).outcome.kind).toBe("empty");
    const req = ricardo.search(query({ query: "black lotus", minPrice: 50, maxPrice: 200, page: 2 }));
    expect(req.url).toBe("https://www.ricardo.ch/de/s/black%20lotus/?sort=newest&range_filters.price.min=50&range_filters.price.max=200&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(ricardo.search(query({ sort: "price_low" })).applies?.sort).toBe(false);
    expect(listings(ricardo, "<html><body>new</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(ricardo);
  });
});

describe("tutti and anibis", () => {
  it("builds the site's own search token", () => {
    expect(searchToken("pokemon")).toBe("Ak6dwb2tlbW9uwJTAwMDA");
    expect(searchToken("black lotus")).toBe("Ak6tibGFjayBsb3R1c8CUwMDAwA");
    expect(searchToken(NONSENSE)).toBe("Ak7NxenhqdndrIGdsdXJhayB6enF2wJTAwMDA");
    expect(searchToken("x".repeat(40))).toMatch(/^Ak9k/);
    const req = anibis.search(query({ query: "black lotus", sort: "price_low", minPrice: 50, page: 2 }));
    expect(req.url).toBe("https://www.anibis.ch/de/q/suche/Ak6tibGFjayBsb3R1c8CUwMDAwA?sorting=cheapest&page=2");
    expect(req.applies).toEqual({ sort: true });
  });

  it("reads the dehydrated search query", () => {
    const { outcome, listings: ls } = read(tutti, "tutti.html", "pokemon");
    expect(outcome).toMatchObject({ kind: "results", total: 8170 });
    expect(ls[0]).toMatchObject({ id: "84347176", url: "https://www.tutti.ch/de/vi/84347176", price: { amount: 272, currency: "CHF" }, posted_at: "2026-11-23T00:48:43+01:00", location: "Zürich ZH", seller: { name: "FRIENDS COLLECTIVE" } });
  });

  it("drops partial matches, reads no results as empty, and refuses a page for another query", () => {
    const { listings: ls } = read(anibis, "anibis-black-lotus.html", "black lotus");
    expect(ls.some((l) => /Range Rover|Vinyl/.test(l.title))).toBe(false);
    for (const l of ls) expect(`${l.title} ${l.description ?? ""}`.toLowerCase()).toContain("lotus");
    expect(read(tutti, "tutti-empty.html", NONSENSE).outcome.kind).toBe("empty");
    expect(read(tutti, "tutti.html", "charizard").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(tutti);
  });
});
