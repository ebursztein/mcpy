import { describe, expect, it } from "vitest";
import { cardmarket } from "../../src/sites/cards/cardmarket.js";
import { cardtrader } from "../../src/sites/cards/cardtrader.js";
import { tcgplayer } from "../../src/sites/cards/tcgplayer.js";
import type { ProductLink, ShoppingSite } from "../../src/sites/types.js";
import { expectBlockedReadsFailed, fixture, listings, page, query } from "./site-harness.js";

/** A product page's offers, normalized as the service does (each offer carries its product). */
function offers(site: ShoppingSite, file: string, link: ProductLink) {
  return listings(site, fixture(file), site.product!.request(link).url, (p) => {
    const o = site.product!.read(p, link);
    return o.kind === "results" ? { ...o, rows: o.rows.map((r) => ({ ...r, product: link })) } : o;
  });
}

describe("tcgplayer", () => {
  it("searches through the POST search API and returns products with listings", () => {
    const req = tcgplayer.search(query({ page: 2 }));
    expect(req.url).toBe("https://mp-search-api.tcgplayer.com/v1/search/request?q=charizard&isList=false");
    expect(req.method).toBe("POST");
    expect(JSON.parse(req.body!)).toMatchObject({ from: 24, size: 24 });
    const outcome = tcgplayer.read(page(fixture("cards/tcgplayer-search.json"), req.url), query());
    expect(outcome.kind).toBe("results");
    if (outcome.kind !== "results") return;
    expect(outcome.rows).toEqual([]);
    expect(outcome.total).toBe(889);
    expect(outcome.products![0]).toEqual({ id: "654213", url: "https://www.tcgplayer.com/product/654213", title: "Mega Charizard X ex Ultra Premium Collection (Miscellaneous Cards & Products)" });
  });

  it("reads every seller's offer on a product as a listing", () => {
    const link = { id: "219059", url: "https://www.tcgplayer.com/product/219059", title: "Charizard GX - 9/68 (#60 Charizard Stamped) (Battle Academy)" };
    expect(tcgplayer.product!.request(link)).toMatchObject({ url: "https://mp-search-api.tcgplayer.com/v1/product/219059/listings", method: "POST" });
    const { listings: ls } = offers(tcgplayer, "cards/tcgplayer-listings.json", link);
    expect(ls).toHaveLength(5);
    const first = ls[0]!;
    expect(first).toMatchObject({ id: "923899866", url: link.url, title: link.title, price: { amount: 7.02, currency: "USD" }, card_condition: "poor", language: "en", quantity: 1 });
    expect(first.seller).toMatchObject({ name: "PEEDEE CARD VAULT", feedback_percent: 100 });
    expect(first.product?.id).toBe("219059");
    expect(ls.map((l) => l.details?.["Condition"])).toContain("Lightly Played");
    expect(ls.find((l) => l.details?.["Condition"] === "Lightly Played")?.card_condition).toBe("excellent");
  });

  it("reads an API answer without products as empty and a challenge as failed", () => {
    expect(tcgplayer.read(page('{"errors":[],"results":[{"results":[],"totalResults":0}]}'), query()).kind).toBe("empty");
    expect(tcgplayer.read(page("<html>new</html>"), query())).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(tcgplayer);
  });
});

describe("cardmarket", () => {
  it("reads the product gallery as product links", () => {
    const req = cardmarket.search(query({ page: 1 }));
    expect(req.url).toBe("https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=charizard");
    expect(cardmarket.search(query({ page: 3 })).url).toContain("&site=3");
    const outcome = cardmarket.read(page(fixture("cards/cardmarket-search.html"), req.url), query());
    expect(outcome).toMatchObject({ kind: "results", rows: [], total: 294, hasMore: true });
    if (outcome.kind !== "results") return;
    expect(outcome.products).toHaveLength(4);
    expect(outcome.products![0]).toEqual({
      id: "Pokemon-GO/Charizard-PGO010",
      url: "https://www.cardmarket.com/en/Pokemon/Products/Singles/Pokemon-GO/Charizard-PGO010",
      title: "Charizard (PGO 010)",
    });
  });

  it("reads each offer row of a product page: seller, grade, language, location, price", () => {
    const link = { id: "Pokemon-GO/Charizard-PGO010", url: "https://www.cardmarket.com/en/Pokemon/Products/Singles/Pokemon-GO/Charizard-PGO010" };
    const { outcome, listings: ls } = offers(cardmarket, "cards/cardmarket-product.html", link);
    expect(outcome.kind).toBe("results");
    expect(ls).toHaveLength(4);
    expect(ls[0]).toMatchObject({
      id: "2197359001",
      url: link.url,
      title: "Charizard (PGO 010)",
      price: { amount: 0.8, currency: "EUR" },
      card_condition: "light_played",
      language: "it",
      quantity: 1,
      country: "it",
      location: "Italy",
      seller: { name: "PokeJonTcg" },
      description: "New shop",
    });
    expect(ls[0]!.details?.["Seller sales"]).toBe("23");
    expect(ls.some((l) => l.card_condition === "excellent")).toBe(true);
    expect(ls.find((l) => l.details?.["Extras"])?.details?.["Extras"]).toContain("Reverse Holo");
  });

  it("reads a missing gallery as redesigned and a challenge as failed", () => {
    expect(cardmarket.read(page("<html><body>new layout</body></html>"), query())).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(cardmarket);
  });
});

describe("cardtrader", () => {
  it("reads the server-rendered blueprints that have offers as product links", () => {
    const req = cardtrader.search(query());
    expect(req.url).toBe("https://www.cardtrader.com/en/search?q=charizard&game=pokemon");
    const outcome = cardtrader.read(page(fixture("cards/cardtrader-search.html"), req.url), query());
    expect(outcome.kind).toBe("results");
    if (outcome.kind !== "results") return;
    expect(outcome.products!.length).toBeGreaterThan(0);
    for (const p of outcome.products!) expect(p.url).toMatch(/^https:\/\/www\.cardtrader\.com\/en\/cards\/\d+-/);
    expect(outcome.products![0]!.title).toContain("Charizard");
  });

  it("reads offers from the product JSON with seller feedback", () => {
    const link = { id: "359489", url: "https://www.cardtrader.com/en/cards/359489-mega-charizard-y-ex-ultra-rare-022-217-ascended-heroes", title: "Mega Charizard Y ex" };
    expect(cardtrader.product!.request(link).url).toBe("https://www.cardtrader.com/en/cards/359489.json");
    const { outcome, listings: ls } = offers(cardtrader, "cards/cardtrader-offers.json", link);
    expect(outcome).toMatchObject({ kind: "results", total: 185 });
    expect(ls).toHaveLength(4);
    expect(ls[0]).toMatchObject({ id: "471764863", url: link.url, price: { amount: 4, currency: "EUR" }, card_condition: "near_mint", language: "it", country: "it", seller: { name: "Runa997" } });
    expect(ls[0]!.seller?.feedback_count).toBeGreaterThan(0);
  });

  it("reads a search without blueprints as empty and a page without props as redesigned", () => {
    const none = '<div data-react-class="BlueprintSearch" data-react-props="{&quot;prefilledBlueprints&quot;:[],&quot;prefilledProductsCountByBlueprint&quot;:{}}"></div>';
    expect(cardtrader.read(page(none), query()).kind).toBe("empty");
    expect(cardtrader.read(page("<html><body>x</body></html>"), query())).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(cardtrader);
  });
});
