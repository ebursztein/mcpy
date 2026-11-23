import { describe, expect, it } from "vitest";
import { allegroLokalnie } from "../../src/sites/europe/b/allegro-lokalnie.js";
import { aukro } from "../../src/sites/europe/b/aukro.js";
import { expectBlockedReadsFailed, fixture, listings, query } from "./site-harness.js";

describe("aukro", () => {
  it("reads the cached search response from ng-state", () => {
    const { outcome, listings: ls } = listings(aukro, fixture("europe-b/aukro-search.html"));
    expect(outcome).toMatchObject({ kind: "results", total: 184, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["7127099855", "7124482964", "7142539522", "7131894076", "7138479713"]);
    expect(ls[0]).toMatchObject({
      url: "https://aukro.cz/cz-500-motokros-cz-250-formule-1-f1-brabham-lotus-mclaren-1973-7127099855",
      price: { amount: 59, currency: "CZK" },
      format: "fixed_price",
      shipping: { amount: 99, currency: "CZK" },
      condition: "used",
      posted_at: "2026-11-22T22:45:01+01:00",
      seller: { name: "petrkure", feedback_count: 1569, feedback_percent: 99.8 },
    });
    expect(ls[2]).toMatchObject({ format: "auction", auction: { ends_at: "2026-11-29T19:59:00+01:00" } });
    expect(ls[4]!.auction).toMatchObject({ buy_now: { amount: 999, currency: "CZK" } });
  });

  it("asks for sort and price but leaves them to mcpy (landing pages drop them)", () => {
    const req = aukro.search(query({ query: "black lotus", minPrice: 100, maxPrice: 900, sort: "newest", page: 2 }));
    expect(req.url).toBe("https://aukro.cz/vysledky-vyhledavani?text=black%20lotus&priceMin=100&priceMax=900&sort=startingTime:DESC&page=2");
    expect(req.applies).toBeUndefined();
  });

  it("reads no content as empty, a missing state as redesigned", () => {
    expect(listings(aukro, fixture("europe-b/aukro-empty.html")).outcome.kind).toBe("empty");
    expect(listings(aukro, "<html><body><auk-root></auk-root></body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(aukro);
  });
});

describe("allegro_lokalnie", () => {
  it("reads offer cards, keeps sponsored ones marked, drops allegro.pl cross-listings", () => {
    const { outcome, listings: ls } = listings(allegroLokalnie, fixture("europe-b/allegro-lokalnie-search.html"));
    expect(outcome.kind).toBe("results");
    expect(ls.map((l) => l.id)).toEqual([
      "pokemon-mega-greninja-ex-122086-gold",
      "3x-karta-pokemon-zlota-charizard-v-evolution-charizard-v-max-pikachu-basic",
      "pokemon-reshiram-i-charizard-gx-217214",
      "karta-pokemon-giratina-v-lor-186-near-mint-nm",
    ]);
    expect(ls[0]).toMatchObject({ price: { amount: 549, currency: "PLN" }, format: "best_offer", condition: "used", location: "Knurów", promoted: true });
    expect(ls[1]).toMatchObject({ format: "auction", auction: { bids: 1, ends_at: "2026-11-25T11:32:32Z" }, price: { amount: 100, currency: "PLN" } });
    expect(ls[2]!.promoted).toBe(false);
  });

  it("applies sort, price and page", () => {
    const req = allegroLokalnie.search(query({ query: "black lotus", minPrice: 200, sort: "newest", page: 2 }));
    expect(req.url).toBe("https://allegrolokalnie.pl/oferty/q/black-lotus?price_from=200&sort=startingTime-desc&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads the no-offers page as empty", () => {
    expect(listings(allegroLokalnie, fixture("europe-b/allegro-lokalnie-empty.html")).outcome.kind).toBe("empty");
    expect(listings(allegroLokalnie, "<html><body>new layout</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(allegroLokalnie);
  });
});
