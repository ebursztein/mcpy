import { describe, expect, it } from "vitest";
import { dubizzleAe } from "../../src/sites/europe/c/dubizzle.js";
import { gumtree } from "../../src/sites/europe/c/gumtree.js";
import { todocoleccion } from "../../src/sites/europe/c/todocoleccion.js";
import { vintedFr, vintedTitle } from "../../src/sites/europe/c/vinted.js";
import { expectBlockedReadsFailed, fixture, listings, query } from "./site-harness.js";

const fx = (name: string) => fixture(`europe-c/${name}`);

describe("gumtree", () => {
  it("reads searchAds from window.clientData", () => {
    const { outcome, listings: ls } = listings(gumtree, fx("gumtree.html"));
    expect(outcome).toMatchObject({ kind: "results", total: 2472, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["1805058970", "1805243114", "1515199460", "1805236139"]);
    expect(ls[0]).toMatchObject({ price: { amount: 275, currency: "GBP" }, condition: "used", posted_at: "2026-11-17T09:31:40.374Z", location: "Southside, Glasgow", promoted: true });
    expect(ls[1]!.condition).toBe("new");
    expect(ls[2]).toMatchObject({ title: "Buying Pokemon Card Collections", format: "wanted" });
  });

  it("searches goods newest first with a price range the site applies", () => {
    const req = gumtree.search(query({ minPrice: 50, maxPrice: 300, page: 2 }));
    expect(req.url).toBe("https://www.gumtree.com/search?search_category=for-sale&q=charizard&sort=date&min_price=50&max_price=300&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads no searchAds as empty even when nearby ads are shown", () => {
    expect(listings(gumtree, fx("gumtree-empty.html")).outcome.kind).toBe("empty");
    expect(listings(gumtree, "<html><body>x</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expect(listings(gumtree, fx("gumtree-reblaze.html")).outcome).toMatchObject({ kind: "failed", failure: "blocked" });
    expectBlockedReadsFailed(gumtree);
  });
});

describe("vinted_fr", () => {
  it("reads catalog cards: title, price, condition, brand and boosted rows", () => {
    const { outcome, listings: ls } = listings(vintedFr, fx("vinted.html"));
    expect(outcome.kind).toBe("results");
    expect(ls.map((l) => l.id)).toEqual(["10934113340", "10934113576", "10934112758", "10934082995"]);
    expect(ls[0]).toMatchObject({
      title: "Pokémon Dracaufeu Vstar + Démétéros ex",
      url: "https://www.vinted.fr/items/10934113340-pokemon-dracaufeu-vstar-demeteros-ex",
      price: { amount: 21, currency: "EUR" },
      condition: "used",
      details: { Brand: "Pokémon", "With buyer protection": "22,75 €" },
    });
    expect(ls[1]!.condition).toBe("new");
    expect(ls[3]!.promoted).toBe(true);
  });

  it("cuts the card label down to the title", () => {
    expect(vintedTitle("Lot, cartes, Marque: Pokémon, État: Bon état, 5.00 €, 5.95 €")).toBe("Lot, cartes");
    expect(vintedTitle("Sans marque, 5.00 €, 5.95 €")).toBe("Sans marque");
  });

  it("puts order and price in the URL", () => {
    const req = vintedFr.search(query({ minPrice: 50, maxPrice: 200, page: 2 }));
    expect(req.url).toBe("https://www.vinted.fr/catalog?search_text=charizard&order=newest_first&price_from=50&price_to=200&currency=EUR&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads the empty state as empty and a page without cards as failed", () => {
    expect(listings(vintedFr, fx("vinted-empty.html")).outcome.kind).toBe("empty");
    expect(listings(vintedFr, "<html><body>x</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(vintedFr);
  });
});

describe("dubizzle_ae", () => {
  it("reads hits from the fulfilled listing action", () => {
    const { outcome, listings: ls } = listings(dubizzleAe, fx("dubizzle.html"));
    expect(outcome).toMatchObject({ kind: "results", total: 610, hasMore: true });
    expect(ls).toHaveLength(4);
    expect(ls[0]).toMatchObject({
      id: "032f8cf5e56a49e189120201086f5c26",
      title: "Trading Card Booster Pack (Pokémon-style) - Sealed Pack",
      price: { amount: 35, currency: "AED" },
      condition: "new",
      posted_at: "2026-11-22T13:49:30.000Z",
    });
    expect(ls[0]!.location).toMatch(/^Dubai, Deira/);
  });

  it("applies the price range but not a price sort", () => {
    const req = dubizzleAe.search(query({ minPrice: 100, maxPrice: 1000, page: 2 }));
    expect(req.url).toBe("https://dubai.dubizzle.com/search/?keyword=charizard&price__gte=100&price__lte=1000&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(dubizzleAe.search(query({ sort: "price_low" })).applies?.sort).toBe(false);
  });

  it("reads zero hits as empty and other pages as failed", () => {
    expect(listings(dubizzleAe, fx("dubizzle-empty.html")).outcome.kind).toBe("empty");
    expect(listings(dubizzleAe, "<html><body>x</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(dubizzleAe);
  });
});

describe("todocoleccion", () => {
  it("reads only the result grid: auctions, offers and fixed prices, not the carousel", () => {
    const { outcome, listings: ls } = listings(todocoleccion, fx("todocoleccion.html"));
    expect(outcome).toMatchObject({ kind: "results", total: 645, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["711302840", "721631405", "419872059", "721108490"]);
    expect(ls[0]).toMatchObject({ format: "auction", price: { amount: 63.75, currency: "EUR" }, auction: { bids: 0 }, details: { "Time left": "7d 19h" } });
    expect(ls[1]!.title).toBe("2022 Pokemon Japanese Sword & Shield VSTAR Universe Holo Charizard VSTAR #14 CGC 10 GEM MINT");
    expect(ls[2]!.format).toBe("best_offer");
    expect(ls[3]!.format).toBe("fixed_price");
  });

  it("sorts on the site but leaves the price floor to mcpy", () => {
    const req = todocoleccion.search(query({ minPrice: 50, maxPrice: 200, page: 2 }));
    expect(req.url).toBe("https://www.todocoleccion.net/buscador?bu=charizard&O=r&preciodesde=50&preciohasta=200&P=2");
    expect(req.applies).toEqual({ sort: true });
  });

  it("reads 'Sin resultados' with suggestions as empty", () => {
    expect(listings(todocoleccion, fx("todocoleccion-empty.html")).outcome.kind).toBe("empty");
    expect(listings(todocoleccion, "<html><body>x</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(todocoleccion);
  });
});
