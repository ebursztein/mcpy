import { describe, expect, it } from "vitest";
import { europeCSites } from "../../src/sites/europe/c/index.js";
import { milanuncios } from "../../src/sites/europe/c/milanuncios.js";
import { sahibinden } from "../../src/sites/europe/c/sahibinden.js";
import { shpock } from "../../src/sites/europe/c/shpock.js";
import { wallapop } from "../../src/sites/europe/c/wallapop.js";
import { expectBlockedReadsFailed, fixture, listings, page, query } from "./site-harness.js";

const fx = (name: string) => fixture(`europe-c/${name}`);

describe("wallapop", () => {
  it("reads the search API rows as es.wallapop.com items", () => {
    const { outcome, listings: ls } = listings(wallapop, fx("wallapop.json"));
    // The fixture's real signed token (~900 chars) is the next page.
    expect(outcome).toMatchObject({ kind: "results", hasMore: true });
    expect(outcome.kind === "results" && outcome.nextCursor!.length).toBeGreaterThan(800);
    expect(ls.map((l) => l.id)).toEqual(["9jdwo9mg4n6k", "mzn3r1eyr0jn", "w67vm5rp596x", "nzxe1nmw9762"]);
    expect(ls[1]).toMatchObject({
      url: "https://es.wallapop.com/item/pokemon-edicion-roja-game-boy-1327254873",
      price: { amount: 20, currency: "EUR" },
      posted_at: "2026-11-23T00:16:01.265Z",
      location: "Vigo, Pontevedra",
      country: "es",
    });
  });

  it("sends the app header, newest order and price range", () => {
    const req = wallapop.search(query({ minPrice: 50, maxPrice: 200 }));
    expect(req.url).toBe("https://api.wallapop.com/api/v3/search?source=search_box&keywords=charizard&latitude=40.41956&longitude=-3.69196&order_by=newest&min_sale_price=50&max_sale_price=200");
    expect(req.headers?.["X-DeviceOS"]).toBe("0");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("pages with the API's next_page token", () => {
    expect(wallapop.pagesByCursor).toBe(true);
    const req = wallapop.search(query({ page: 2, cursor: "eyJ+abc/=" }));
    expect(req.url).toBe("https://api.wallapop.com/api/v3/search?next_page=eyJ%2Babc%2F%3D");
    expect(req.headers?.["X-DeviceOS"]).toBe("0");
    const short = { ...JSON.parse(fx("wallapop.json")), meta: { next_page: "eyJhbGciOiJIUzI1NiJ9.short.sig" } };
    expect(wallapop.read(page(JSON.stringify(short)), query())).toMatchObject({ kind: "results", hasMore: true, nextCursor: "eyJhbGciOiJIUzI1NiJ9.short.sig" });
    const lastPage = { ...JSON.parse(fx("wallapop.json")), meta: {} };
    const last = wallapop.read(page(JSON.stringify(lastPage)), query());
    expect(last).toMatchObject({ kind: "results", hasMore: false });
    expect(last.kind === "results" && last.nextCursor).toBe(undefined);
  });

  it("reads no items as empty and other bodies as failed", () => {
    expect(listings(wallapop, '{"data":{"section":{"payload":{"items":[]}}}}').outcome.kind).toBe("empty");
    expect(listings(wallapop, '{"message":"forbidden"}').outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(wallapop);
  });
});

describe("milanuncios", () => {
  it("reads the search API ads with their photos", () => {
    const { outcome, listings: ls } = listings(milanuncios, fx("milanuncios.json"));
    expect(outcome).toMatchObject({ kind: "results", total: 1283, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["626735687", "626726133", "626725640", "626724053"]);
    expect(ls[0]).toMatchObject({
      url: "https://www.milanuncios.com/juegos-de-nintendo-ds/pokemon-edicion-diamante-nintendo-ds-626735687.htm",
      price: { amount: 55, currency: "EUR" },
      condition: "used",
      posted_at: "2026-11-22T23:57:52Z",
      location: "Santa Cruz de Tenerife, Tenerife",
      seller: { name: "Itahisa" },
    });
    expect(ls[0]!.image).toMatch(/^https:\/\/images\.milanuncios\.com\/.*\?rule=detail_640x480$/);
    expect(ls[3]!.condition).toBe("new");
  });

  it("uses priceFrom/priceTo and offset; only newest is the site's order", () => {
    const req = milanuncios.search(query({ minPrice: 50, maxPrice: 200, page: 3 }));
    expect(req.url).toBe("https://searchapi.gw.milanuncios.com/v3/classifieds?text=charizard&limit=30&offset=60&priceFrom=50&priceTo=200");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(milanuncios.search(query({ sort: "price_low" })).applies?.sort).toBe(false);
  });

  it("reads no ads as empty and the Imperva page as blocked", () => {
    expect(listings(milanuncios, '{"ads":[],"ids":"","pagination":{"nextToken":null,"page":1,"resultsPerPage":30,"totalHits":{"relation":"eq","value":0}}}').outcome.kind).toBe("empty");
    expect(listings(milanuncios, "<html><head><title>Pardon Our Interruption</title></head></html>").outcome).toMatchObject({ kind: "failed", failure: "blocked" });
    expectBlockedReadsFailed(milanuncios);
  });
});

describe("shpock", () => {
  it("reads GraphQL item summaries", () => {
    const { outcome, listings: ls } = listings(shpock, fx("shpock.json"));
    expect(outcome.kind).toBe("results");
    expect(ls.map((l) => l.id)).toEqual(["avHVVE_Vc-26ArSc", "auc-lGAjHvVODt6q", "atyBXBbvzi4jAFWK", "aanqm6w-vTmWCX58"]);
    expect(ls[1]).toMatchObject({
      url: "https://www.shpock.com/en-gb/i/auc-lGAjHvVODt6q/charizard-sm158-black-star-promo-psa9",
      price: { amount: 320, currency: "GBP" },
      location: "B42 2AY Birmingham",
    });
    expect(ls[0]!.image).toMatch(/^https:\/\/m1\.secondhandapp\.at\/2\.0\/[0-9a-f]+$/);
  });

  it("posts the page's ItemSearch with a UK location, order and price", () => {
    const req = shpock.search(query({ minPrice: 50, maxPrice: 200, page: 2 }));
    expect(req).toMatchObject({ url: "https://www.shpock.com/graphql", method: "POST", applies: { sort: true, minPrice: true, maxPrice: true } });
    const vars = JSON.parse(req.body!).variables;
    expect(vars.pagination).toEqual({ limit: 30, offset: 30 });
    expect(JSON.parse(vars.serializedFilters)).toEqual({
      q: "charizard",
      distance: { location: { lat: 54, lng: -2.5 }, radius: 1000 },
      sort: { type: "date_listed", direction: "d" },
      price: { from: 50, to: 200 },
    });
  });

  it("reads no items as empty and other bodies as failed", () => {
    expect(listings(shpock, '{"data":{"itemSearch":{"itemResults":[{"distanceGroup":"ungrouped","items":[]}]}}}').outcome.kind).toBe("empty");
    expect(listings(shpock, '{"errors":[{"message":"x"}]}').outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(shpock);
  });
});

describe("sahibinden", () => {
  it("reads the challenge and sign-in pages as blocked and never invents rows", () => {
    expectBlockedReadsFailed(sahibinden);
    const login = page("<html><head><title>sahibinden.com Log In</title></head><body>giriş</body></html>", "https://secure.sahibinden.com/login");
    expect(sahibinden.read(login, query())).toMatchObject({ kind: "failed", failure: "blocked" });
    expect(sahibinden.read(page(`<html><head><title>pokemon</title></head><body>${"x".repeat(40_000)}</body></html>`), query()).kind).toBe("failed");
  });
});

describe("europe group c", () => {
  it("lists every store once, each with a search URL on its own or its API host", () => {
    expect(europeCSites.map((s) => s.key)).toEqual([
      "bazos_cz", "bazos_sk", "sbazar", "todocoleccion", "skelbiu", "gumtree", "kupujemprodajem",
      "vinted_fr", "dubizzle_ae", "wallapop", "milanuncios", "shpock", "adverts_ie", "sahibinden",
    ]);
    for (const site of europeCSites) {
      const url = new URL(site.search(query({ query: "black lotus" })).url);
      expect(url.protocol).toBe("https:");
      expect(url.hostname.endsWith(site.host.replace(/^(www|es|dubai)\./, ""))).toBe(true);
    }
  });
});
