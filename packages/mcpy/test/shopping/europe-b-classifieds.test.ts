import { describe, expect, it } from "vitest";
import { jofogas } from "../../src/sites/europe/b/jofogas.js";
import { bolha, njuskalo } from "../../src/sites/europe/b/njuskalo-bolha.js";
import { expectBlockedReadsFailed, fixture, listings, page, query } from "./site-harness.js";

describe("njuskalo / bolha (one platform)", () => {
  it("reads promoted then regular rows from __INITIAL_STATE__, never the latest-ads sidebar", () => {
    const { outcome, listings: ls } = listings(bolha, fixture("europe-b/bolha-search.html"));
    expect(outcome).toMatchObject({ kind: "results", total: 469, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["16336571", "16677055", "14742054", "15172913"]);
    expect(ls[0]).toMatchObject({ promoted: true, price: { amount: 150, currency: "EUR" }, country: "si" });
    expect(ls[1]).toMatchObject({ url: "https://www.bolha.com/albumi/pokemon-oglas-16677055", condition: "used", seller: { name: "Erikto" }, posted_at: "2026-11-04T13:42:17Z" });
    expect(ls[3]!.condition).toBe("new");
  });

  it("reads Njuškalo the same way", () => {
    const { listings: ls } = listings(njuskalo, fixture("europe-b/njuskalo-search.html"));
    expect(ls.map((l) => l.id)).toEqual(["48979442", "48827506", "50681519"]);
    expect(ls[0]).toMatchObject({ url: "https://www.njuskalo.hr/nintendo-ostalo/pokemon-oglas-48979442", price: { amount: 70, currency: "EUR" }, country: "hr" });
  });

  it("applies sort, price and page", () => {
    const req = njuskalo.search(query({ query: "black lotus", minPrice: 50, maxPrice: 500, sort: "newest", page: 2 }));
    expect(req.url).toBe("https://www.njuskalo.hr/search/?keywords=black%20lotus&price%5Bmin%5D=50&price%5Bmax%5D=500&sort=new&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads no listings as empty, a filler results type as empty, a captcha as blocked", () => {
    expect(listings(bolha, fixture("europe-b/bolha-empty.html")).outcome.kind).toBe("empty");
    const filler = fixture("europe-b/bolha-search.html").replace(/"resultsType": ?"regularListings"/, '"resultsType": "similarListings"');
    expect(listings(bolha, filler).outcome.kind).toBe("empty");
    expect(listings(bolha, "<html><body>new</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    const captcha = { ...page("<html><head><title>ShieldSquare Captcha</title></head></html>"), finalUrl: "https://validate.perfdrive.com/x" };
    expect(njuskalo.read(captcha, query())).toMatchObject({ kind: "failed", failure: "blocked" });
    expectBlockedReadsFailed(bolha);
  });
});

describe("jofogas", () => {
  it("reads adList rows from __NEXT_DATA__", () => {
    const { outcome, listings: ls } = listings(jofogas, fixture("europe-b/jofogas-search.html"));
    expect(outcome).toMatchObject({ kind: "results", total: 357, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["162318015", "162317973", "163007494", "162935653"]);
    expect(ls[0]).toMatchObject({
      url: "https://www.jofogas.hu/szabolcs_szatmar_bereg/Pokemon_Cyndaquil__47_Pokemon_Promo_kartya_162318015.htm",
      price: { amount: 5000, currency: "HUF" },
      location: "Nyíregyháza, Szabolcs-Szatmár-Bereg",
      seller: { name: "Emil" },
    });
    expect(ls[0]!.posted_at).toMatch(/^2026-10-02T/);
    expect(ls[3]).toMatchObject({ condition: "used", seller: { name: "Roboz L. E.V." } });
    expect(ls[3]!.details?.["Seller"]).toBe("business");
  });

  it("applies sort, price and page", () => {
    const req = jofogas.search(query({ query: "charizard", minPrice: 5000, sort: "newest", page: 2 }));
    expect(req.url).toBe("https://www.jofogas.hu/magyarorszag?q=charizard&min_price=5000&sp=3&o=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads no results and loosened matches as empty, the AWS WAF page as blocked", () => {
    // The real no-results page has no adList.ads key at all.
    const empty = fixture("europe-b/jofogas-empty.html");
    expect(empty).not.toContain('"ads"');
    expect(listings(jofogas, empty).outcome.kind).toBe("empty");
    const noAds = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"adList":{"search_total":5}}}}</script>';
    expect(listings(jofogas, noAds).outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    const loose = fixture("europe-b/jofogas-search.html").replace(/"mode": ?"exact"/, '"mode": "partial"');
    expect(listings(jofogas, loose).outcome.kind).toBe("empty");
    const waf = "<html><head><title></title><script>window.awsWafCookieDomainList = ['jofogas.hu'];</script></head><body><div id=\"challenge-container\"></div></body></html>";
    expect(listings(jofogas, waf).outcome).toMatchObject({ kind: "failed", failure: "blocked" });
    expectBlockedReadsFailed(jofogas);
  });
});
