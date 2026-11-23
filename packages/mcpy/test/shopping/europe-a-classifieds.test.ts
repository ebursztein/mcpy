import { describe, expect, it } from "vitest";
import { leboncoin } from "../../src/sites/europe/a/leboncoin.js";
import { marktplaats, tweedehands } from "../../src/sites/europe/a/marktplaats.js";
import { subito } from "../../src/sites/europe/a/subito.js";
import { willhaben } from "../../src/sites/europe/a/willhaben.js";
import type { ShoppingSite } from "../../src/sites/types.js";
import { expectBlockedReadsFailed, fixture, listings, query } from "./site-harness.js";

const NONSENSE = "qzxjvwk glurak zzqv";
const read = (site: ShoppingSite, file: string, q: string) => listings(site, fixture(`europe-a/${file}`), undefined, (p) => site.read(p, query({ query: q })));

describe("leboncoin", () => {
  it("reads __NEXT_DATA__ ads with Paris times and marks paid placements", () => {
    const { outcome, listings: ls } = read(leboncoin, "leboncoin.html", "pokemon");
    expect(outcome).toMatchObject({ kind: "results", total: 652302 });
    expect(ls.map((l) => l.id)).toEqual(["3277254655", "3315987677", "3315987628", "3305341099"]);
    expect(ls[0]).toMatchObject({ url: "https://www.leboncoin.fr/ad/collection/3277254655", price: { amount: 36, currency: "EUR" }, promoted: true, posted_at: "2026-09-26T20:19:37+02:00" });
    expect(ls[1]!.posted_at).toBe("2026-11-23T01:21:02+01:00");
    expect(ls[1]!.promoted).toBe(false);
    expect(ls[3]!.promoted).toBe(true);
  });

  it("applies sort, price and page on the site; empty and blocked pages", () => {
    const req = leboncoin.search(query({ query: "black lotus", sort: "newest", minPrice: 50, page: 2 }));
    expect(req.url).toBe("https://www.leboncoin.fr/recherche?text=black%20lotus&sort=time&order=desc&price=50-max&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(read(leboncoin, "leboncoin-empty.html", NONSENSE).outcome.kind).toBe("empty");
    expect(listings(leboncoin, "<html><body>new</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(leboncoin);
  });
});

describe("subito", () => {
  it("reads originalList, not the vetrina gallery", () => {
    const { outcome, listings: ls } = read(subito, "subito.html", "pokemon");
    expect(outcome.kind).toBe("results");
    expect(ls).toHaveLength(4);
    expect(ls[0]).toMatchObject({ id: "668387158", price: { amount: 750, currency: "EUR" }, shipping: { amount: 0.99 }, condition: "used", posted_at: "2026-11-23T01:03:42+01:00", promoted: true });
    expect(ls.some((l) => /Nintendo Switch/.test(l.title))).toBe(false);
  });

  it("drops rows that match only some words and leaves price to mcpy", () => {
    const { listings: ls } = read(subito, "subito-black-lotus.html", "black lotus");
    expect(ls.length).toBeGreaterThan(0);
    for (const l of ls) expect(`${l.title} ${l.description}`.toLowerCase()).toMatch(/black[\s\S]*lotus|lotus[\s\S]*black/);
    const req = subito.search(query({ query: "black lotus", sort: "newest", minPrice: 50, page: 3 }));
    expect(req.url).toBe("https://www.subito.it/annunci-italia/vendita/usato/?q=black+lotus&order=datedesc&o=3");
    expect(req.applies).toEqual({ sort: true });
    expectBlockedReadsFailed(subito);
  });
});

describe("marktplaats and 2dehands", () => {
  it("reads the search API rows with price types", () => {
    const { outcome, listings: ls } = read(marktplaats, "marktplaats.json", "pokemon");
    expect(outcome.kind).toBe("results");
    expect(ls.length).toBeGreaterThanOrEqual(3);
    expect(ls[0]).toMatchObject({ id: "m2468743599", format: "best_offer", posted_text: "Vandaag", promoted: true, country: "nl" });
    expect(ls[0]!.price).toBeUndefined();
    expect(ls[0]!.url).toBe("https://www.marktplaats.nl/v/verzamelen/speelkaarten-jokers-en-kwartetten/m2468743599-pokemon-boekje-ungraded-kaarten-gesorteerd");
    const be = read(tweedehands, "2dehands.json", "charizard").listings;
    expect(be[0]).toMatchObject({ marketplace: "2dehands", id: "m2465093044", price: { amount: 58, currency: "EUR" }, format: "fixed_price", country: "be" });
  });

  it("keeps rows with every word, marks reserved, and a nonsense query is empty", () => {
    const { listings: ls } = read(marktplaats, "marktplaats-black-lotus.json", "black lotus");
    expect(ls.map((l) => l.title)).toContain("Rundholz Black Label, grijze lotus rok, maat M/L");
    expect(ls.some((l) => /Emeya/.test(l.title))).toBe(false);
    expect(ls.find((l) => l.id === "m2468635729")?.status).toBe("reserved");
    expect(read(marktplaats, "marktplaats-nonsense.json", NONSENSE).outcome.kind).toBe("empty");
  });

  it("applies sort, price in cents and offset on the site", () => {
    const req = marktplaats.search(query({ query: "charizard", sort: "newest", minPrice: 50, page: 2 }));
    expect(req.url).toBe("https://www.marktplaats.nl/lrp/api/search?query=charizard&limit=30&offset=30&sortBy=SORT_INDEX&sortOrder=DECREASING&attributeRanges[]=PriceCents:5000:null");
    expect(tweedehands.search(query({ sort: "price_low", maxPrice: 100 })).url).toContain("www.2dehands.be/lrp/api/search?query=charizard&limit=30&offset=0&sortBy=PRICE&sortOrder=INCREASING&attributeRanges[]=PriceCents:null:10000");
    expect(listings(marktplaats, "<html><title>Just a moment...</title></html>").outcome).toMatchObject({ kind: "failed", failure: "blocked" });
    expect(listings(marktplaats, '{"error":"x"}').outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
  });
});

describe("willhaben", () => {
  it("reads advert attributes", () => {
    const { outcome, listings: ls } = read(willhaben, "willhaben.html", "pokemon");
    expect(outcome).toMatchObject({ kind: "results", total: 45352 });
    expect(ls[0]).toMatchObject({
      id: "1723570819",
      url: "https://www.willhaben.at/iad/kaufen-und-verkaufen/d/pokemon-team-rocket-langarm-shirt-1723570819/",
      price: { amount: 15, currency: "EUR" },
      posted_at: "2026-11-23T00:12:39Z",
      status: "available",
      country: "at",
    });
  });

  it("filler rows and no results are empty; filters go in the URL", () => {
    expect(read(willhaben, "willhaben-black-lotus.html", "black lotus").outcome.kind).toBe("empty");
    expect(read(willhaben, "willhaben-empty.html", NONSENSE).outcome.kind).toBe("empty");
    const req = willhaben.search(query({ query: "black lotus", minPrice: 50, maxPrice: 500, page: 2 }));
    expect(req.url).toBe("https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?keyword=black%20lotus&sort=1&PRICE_FROM=50&PRICE_TO=500&rows=30&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expectBlockedReadsFailed(willhaben);
  });
});
