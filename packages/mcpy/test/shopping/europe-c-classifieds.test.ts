import { describe, expect, it } from "vitest";
import { advertsIe } from "../../src/sites/europe/c/adverts-ie.js";
import { bazosCz, bazosSk } from "../../src/sites/europe/c/bazos.js";
import { cetOffset } from "../../src/sites/europe/c/cet.js";
import { kupujemprodajem } from "../../src/sites/europe/c/kupujemprodajem.js";
import { sbazar } from "../../src/sites/europe/c/sbazar.js";
import { skelbiu } from "../../src/sites/europe/c/skelbiu.js";
import { expectBlockedReadsFailed, fixture, listings, query } from "./site-harness.js";

const fx = (name: string) => fixture(`europe-c/${name}`);

describe("bazos_cz / bazos_sk", () => {
  it("reads cards from category subdomains, with wanted, offer and TOP rows", () => {
    const { outcome, listings: ls } = listings(bazosCz, fx("bazos-cz.html"));
    expect(outcome).toMatchObject({ kind: "results", total: 1703, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["226420216", "226439384", "226713383", "226677095"]);
    expect(ls[0]).toMatchObject({ format: "wanted", price: { amount: 15000, currency: "CZK" }, promoted: true, posted_at: "2026-11-23T00:00:00+01:00" });
    expect(ls[0]!.url).toBe("https://ostatni.bazos.cz/inzerat/226420216/koupim-pokemon-30th-celebration-ultra-premium-collection-upc.php");
    expect(ls[3]).toMatchObject({ format: "best_offer", details: { Price: "Nabídněte" } });
    expect(ls[3]!.price).toBeUndefined();
    const sk = listings(bazosSk, fx("bazos-sk.html")).listings;
    expect(sk.map((l) => new URL(l.url).hostname)).toEqual(["pc.bazos.sk", "ostatne.bazos.sk", "deti.bazos.sk"]);
    expect(sk[0]!.price).toEqual({ amount: 200, currency: "EUR" });
  });

  it("applies price, order and offset on the site", () => {
    const req = bazosCz.search(query({ query: "black lotus", minPrice: 500, maxPrice: 2000, sort: "price_low", page: 3 }));
    expect(req.url).toContain("hledat=black+lotus");
    expect(req.url).toContain("cenaod=500&cenado=2000&order=1&crz=80");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(bazosSk.search(query()).applies?.sort).toBe(true);
  });

  it("reads the no-result page as empty and anything else as failed", () => {
    expect(listings(bazosCz, fx("bazos-cz-empty.html")).outcome.kind).toBe("empty");
    expect(listings(bazosSk, fx("bazos-sk-empty.html")).outcome.kind).toBe("empty");
    expect(listings(bazosCz, "<html><body>new layout</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(bazosCz);
  });

  it("uses CET or CEST for local times", () => {
    expect(cetOffset("2026-11-23")).toBe("+01:00");
    expect(cetOffset("2026-07-01 10:00")).toBe("+02:00");
  });
});

describe("sbazar", () => {
  it("reads the search API, keeping price-by-agreement rows unpriced", () => {
    const { outcome, listings: ls } = listings(sbazar, fx("sbazar.json"));
    expect(outcome).toMatchObject({ kind: "results", total: 210, hasMore: true });
    expect(ls).toHaveLength(4);
    expect(ls[0]).toMatchObject({ id: "236135395", url: "https://www.sbazar.cz/inzerat/236135395-pokemon-karty", posted_at: "2026-11-22T23:29:10+01:00", details: { Price: "Dohodou" } });
    expect(ls[0]!.price).toBeUndefined();
    expect(ls[1]).toMatchObject({ price: { amount: 900, currency: "CZK" }, format: "fixed_price" });
    expect(ls[3]!.promoted).toBe(true);
  });

  it("asks the API for newest first with a price range", () => {
    const req = sbazar.search(query({ minPrice: 500, maxPrice: 2000, page: 2 }));
    expect(req.url).toBe("https://www.sbazar.cz/api/v1/items/search?phrase=charizard&offset=60&limit=60&sort=-create_date&price_from=500&price_to=2000");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads an empty answer as empty and other bodies as failed", () => {
    expect(listings(sbazar, '{"pagination":{"limit":60,"offset":0,"total":0},"results":[],"status_code":200}').outcome.kind).toBe("empty");
    expect(listings(sbazar, '{"error":"x"}').outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(sbazar);
  });
});

describe("skelbiu", () => {
  it("reads cards with condition, location and age", () => {
    const { outcome, listings: ls } = listings(skelbiu, fx("skelbiu.html"));
    expect(outcome).toMatchObject({ kind: "results", hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["80287175", "81297205", "85383876", "71172220"]);
    expect(ls[0]).toMatchObject({ title: "Pokemon", price: { amount: 15, currency: "EUR" }, condition: "new", location: "Kaunas", posted_text: "prieš 1 d." });
    expect(ls[1]!.condition).toBe("used");
  });

  it("puts newest order, price and page in the URL", () => {
    const req = skelbiu.search(query({ minPrice: 50, maxPrice: 200, page: 2 }));
    expect(req.url).toBe("https://www.skelbiu.lt/skelbimai/2?keywords=charizard&orderBy=1&cost_min=50&cost_max=200");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads the no-result page as empty and the 403 block page as blocked", () => {
    expect(listings(skelbiu, fx("skelbiu-empty.html")).outcome.kind).toBe("empty");
    expect(listings(skelbiu, "<!DOCTYPE html><html><head><title>Skelbiu.lt</title></head><body>Prieiga apribota</body></html>").outcome).toMatchObject({ kind: "failed", failure: "blocked" });
    expectBlockedReadsFailed(skelbiu);
  });
});

describe("kupujemprodajem", () => {
  it("reads __NEXT_DATA__ ads with their own currency, buyer posts and unpriced ads", () => {
    const { outcome, listings: ls } = listings(kupujemprodajem, fx("kupujemprodajem.html"));
    expect(outcome).toMatchObject({ kind: "results", total: 1079, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["184362969", "171469451", "196731314", "165161229"]);
    expect(ls[0]).toMatchObject({ price: { amount: 22000, currency: "RSD" }, condition: "used", posted_at: "2026-11-16T13:34:33+01:00", location: "Novi Sad" });
    expect(ls[1]!.price).toEqual({ amount: 99, currency: "EUR" });
    expect(ls[2]!.format).toBe("wanted");
    expect(ls[3]!.price).toBeUndefined();
    expect(ls[0]!.url).toBe("https://www.kupujemprodajem.com/igracke-i-igre/drustvene-igre/pokemon-white-flare-etb-i-jos-toga-pokemon/oglas/184362969");
  });

  it("asks for newest first and a dinar price range", () => {
    const req = kupujemprodajem.search(query({ minPrice: 5000, maxPrice: 20000, page: 2 }));
    expect(req.url).toBe("https://www.kupujemprodajem.com/pretraga?keywords=charizard&order=posted%20desc&priceFrom=5000&priceTo=20000&currency=rsd&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads no ads as empty and a missing state as failed", () => {
    const empty = '<script id="__NEXT_DATA__" type="application/json">{"props":{"initialReduxState":{"search":{"lastSearchResult":{"ads":[],"total":0,"pages":0,"page":1,"captcha":""}}}}}</script>';
    expect(listings(kupujemprodajem, empty).outcome.kind).toBe("empty");
    expect(listings(kupujemprodajem, "<html><body>x</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(kupujemprodajem);
  });
});

describe("adverts_ie", () => {
  it("reads grid cells, free items unpriced", () => {
    const { outcome, listings: ls } = listings(advertsIe, fx("adverts-ie.html"));
    expect(outcome).toMatchObject({ kind: "results", total: 3795, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["41475409", "41477744", "41477422", "41388256"]);
    expect(ls[0]).toMatchObject({ title: "pokemon", location: "Dublin 18, Dublin", details: { Price: "Free" } });
    expect(ls[0]!.price).toBeUndefined();
    expect(ls[1]!.price).toEqual({ amount: 30, currency: "EUR" });
  });

  it("builds the path filters", () => {
    const req = advertsIe.search(query({ query: "black lotus", minPrice: 50, page: 2 }));
    expect(req.url).toBe("https://www.adverts.ie/for-sale/q_black+lotus/price_50-*/sortby_best_refresh_date-desc/page-2/");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads 0 results as empty and the security check as blocked", () => {
    expect(listings(advertsIe, fx("adverts-ie-empty.html")).outcome.kind).toBe("empty");
    expect(listings(advertsIe, "<html><head><title>Security Check | Adverts</title></head><body></body></html>").outcome).toMatchObject({ kind: "failed", failure: "blocked" });
    expectBlockedReadsFailed(advertsIe);
  });
});
