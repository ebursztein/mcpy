import { describe, expect, it } from "vitest";
import { kleinanzeigen } from "../../src/sites/europe/b/kleinanzeigen.js";
import { locantoDe, locantoGb } from "../../src/sites/europe/b/locanto.js";
import { expectBlockedReadsFailed, fixture, listings, query } from "./site-harness.js";

describe("kleinanzeigen", () => {
  it("reads ad cards, marking TOP ads and Gesuch posts", () => {
    const { outcome, listings: ls } = listings(kleinanzeigen, fixture("europe-b/kleinanzeigen-search.html"));
    expect(outcome).toMatchObject({ kind: "results", total: 87342, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["3350266841", "3290784960", "3580094338", "3580094258"]);
    expect(ls[0]).toMatchObject({ format: "wanted", promoted: true, location: "51491 Overath" });
    expect(ls[1]).toMatchObject({ format: "wanted", price: { amount: 1234, currency: "EUR" }, seller: { name: "2nd life gaming" } });
    expect(ls[2]).toMatchObject({
      url: "https://www.kleinanzeigen.de/s-anzeige/zapdos-fossil-15-62-1-edition-pokemon-karte-nl/3580094338-234-9245",
      title: "Zapdos, Fossil 15/62, 1. Edition, Pokemon Karte, NL",
      price: { amount: 22, currency: "EUR" },
      format: "fixed_price",
      posted_text: "Heute, 01:20",
      promoted: false,
    });
  });

  it("puts price, page and sort in the path", () => {
    const req = kleinanzeigen.search(query({ query: "Black Lotus", minPrice: 50, sort: "newest", page: 2 }));
    expect(req.url).toBe("https://www.kleinanzeigen.de/s-preis:50:/seite:2/sortierung:neuste/black-lotus/k0");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(kleinanzeigen.search(query({ query: "pokemon", sort: "relevance" })).url).toBe("https://www.kleinanzeigen.de/s-pokemon/k0");
  });

  it("reads the no-results page as empty", () => {
    expect(listings(kleinanzeigen, fixture("europe-b/kleinanzeigen-empty.html")).outcome.kind).toBe("empty");
    expect(listings(kleinanzeigen, "<html><body>new layout</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(kleinanzeigen);
  });
});

describe("locanto (five hosts)", () => {
  it("reads result cards, splitting the town off the title", () => {
    const { outcome, listings: ls } = listings(locantoDe, fixture("europe-b/locanto-de-search.html"));
    expect(outcome).toMatchObject({ kind: "results", total: 143 });
    expect(ls.map((l) => l.id)).toEqual(["9831317253", "9690827667", "9690818300"]);
    expect(ls[0]).toMatchObject({
      url: "https://www.locanto.de/wuerzburg/ID_9831317253/Pokemon-kartensammlung-zu-verkaufen.html",
      title: "Pokemon kartensammlung zu verkaufen",
      location: "Würzburg",
      price: { amount: 50, currency: "EUR" },
      posted_at: "2026-11-20T16:59:10.000Z",
    });
  });

  it("applies nothing it has not verified", () => {
    const req = locantoGb.search(query({ query: "black lotus", minPrice: 10, page: 2 }));
    expect(req.url).toBe("https://www.locanto.co.uk/q/?query=black%20lotus&page=2");
    expect(req.applies).toBeUndefined();
  });

  it("reads the no-matches page as empty and the Cloudflare page as blocked", () => {
    expect(listings(locantoGb, fixture("europe-b/locanto-gb-empty.html")).outcome.kind).toBe("empty");
    const challenge = "<!DOCTYPE html><html><head><title>Einen Moment bitte...</title></head><body></body></html>";
    expect(listings(locantoDe, challenge).outcome).toMatchObject({ kind: "failed", failure: "blocked" });
    expectBlockedReadsFailed(locantoDe);
  });
});
