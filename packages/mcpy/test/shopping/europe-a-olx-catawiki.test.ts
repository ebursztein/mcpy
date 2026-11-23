import { describe, expect, it } from "vitest";
import { catawiki } from "../../src/sites/europe/a/catawiki.js";
import { europeASites } from "../../src/sites/europe/a/index.js";
import { olxSites } from "../../src/sites/europe/a/olx.js";
import { cetOffset, fold, matchesAll } from "../../src/sites/europe/a/shared.js";
import { normalize } from "../../src/sites/normalize.js";
import type { RawListing, ShoppingSite } from "../../src/sites/types.js";
import { fixture, listings, page, query } from "./site-harness.js";

const NONSENSE = "qzxjvwk glurak zzqv";
const read = (site: ShoppingSite, file: string, q: string) => listings(site, fixture(`europe-a/${file}`), undefined, (p) => site.read(p, query({ query: q })));
const olx = (key: string) => olxSites.find((s) => s.key === key)!;
const IDS = ["1111700459", "1051739402", "1114183845", "1114183641"];

describe("olx", () => {
  it("reads offers with price, condition and promoted placements", () => {
    const { outcome, listings: ls } = read(olx("olx_pl"), "olx-pl.json", "pokemon");
    expect(outcome).toMatchObject({ kind: "results", total: 12249 });
    expect(ls.map((l) => l.id)).toEqual(IDS);
    expect(ls[0]).toMatchObject({ url: "https://www.olx.pl/d/oferta/pokemon-zestaw-kart-CID4042-ID1deA4z.html", price: { amount: 6000, currency: "PLN" }, condition: "new", promoted: true, posted_at: "2026-11-12T15:26:12+01:00", country: "pl" });
    expect(ls[0]!.image).toContain("image;s=400x300");
    expect(ls.slice(1).every((l) => l.promoted === false)).toBe(true);
  });

  it("a typo-tolerant nonsense page is empty; Cyrillic sites keep transliterated rows", () => {
    expect(read(olx("olx_pl"), "olx-pl-nonsense.json", NONSENSE).outcome.kind).toBe("empty");
    const ua = read(olx("olx_ua"), "olx-ua.json", "charizard");
    expect(ua.listings).toHaveLength(4);
    expect(ua.listings[0]!.price?.currency).toBe("UAH");
  });

  it("applies sort, price and offset on every domain", () => {
    const req = olx("olx_ro").search(query({ query: "black lotus", sort: "newest", minPrice: 50, maxPrice: 500, page: 3 }));
    expect(req.url).toBe("https://www.olx.ro/api/v1/offers/?offset=80&limit=40&query=black%20lotus&sort_by=created_at:desc&filter_float_price:from=50&filter_float_price:to=500");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(olxSites.map((s) => `${s.host} ${s.currency}`)).toEqual(["www.olx.pl PLN", "www.olx.pt EUR", "www.olx.ro RON", "www.olx.bg EUR", "www.olx.ua UAH"]);
    expect(listings(olx("olx_pt"), "<html><title>Access Denied</title></html>").outcome).toMatchObject({ kind: "failed", failure: "blocked" });
  });
});

describe("catawiki", () => {
  it("reads lots from the search API with card grade and language", () => {
    const { outcome, listings: ls } = read(catawiki, "catawiki.json", "pokemon");
    expect(outcome).toMatchObject({ kind: "results", total: 5625 });
    expect(ls[0]).toMatchObject({ id: "108660768", format: "auction", card_condition: "near_mint", language: "zh", shipping: { amount: 0 } });
    expect(ls[0]!.url).toBe("https://www.catawiki.com/en/l/108660768-pokemon-2-booster-box-pokemon-collection-the-151-various-sets");
    expect(ls[0]!.price).toBeUndefined();
  });

  it("enriches rows with current bids and end times from the bidding API", () => {
    const rows = (catawiki.read(page(fixture("europe-a/catawiki.json")), query({ query: "pokemon" })) as { rows: RawListing[] }).rows;
    const req = catawiki.enrich!.request(rows)!;
    expect(req.url).toBe("https://www.catawiki.com/buyer/api/v3/bidding/lots?ids=108660768,108728761,108694372,108626425,108596697&currency_code=EUR");
    const enriched = catawiki.enrich!.read(page(fixture("europe-a/catawiki-bidding.json"), req.url), rows);
    expect(enriched).toHaveLength(rows.length);
    const ls = enriched.map((r) => normalize(catawiki, r, "https://www.catawiki.com/buyer/api/v1/search"));
    expect(ls[0]).toMatchObject({ id: "108660768", price: { amount: 6, currency: "EUR" }, format: "auction", auction: { ends_at: "2026-11-28T20:24:20Z" } });
    expect(ls.find((l) => l?.id === "108596697")?.price?.amount).toBe(30);
    expect(catawiki.enrich!.read(page("<html>oops</html>"), rows)).toBe(rows);
  });

  it("vector look-alikes and partial matches are not results", () => {
    expect(read(catawiki, "catawiki-nonsense.json", NONSENSE).outcome.kind).toBe("empty");
    for (const l of read(catawiki, "catawiki-black-lotus.json", "black lotus").listings) expect(l.title.toLowerCase()).toMatch(/black/);
    const req = catawiki.search(query({ query: "charizard", page: 2, minPrice: 50 }));
    expect(req.url).toBe("https://www.catawiki.com/buyer/api/v1/search?locale=en&q=charizard&per_page=24&page=2");
    expect(req.applies).toEqual({ sort: false });
  });
});

describe("europe-a shared", () => {
  it("folds accents and letters that do not decompose", () => {
    expect(fold("Pokémon Łódź Straße")).toBe("pokemon lodz strasse");
    expect(matchesAll("pokemon", "Karty Pokémony")).toBe(true);
    expect(matchesAll("black lotus", "Lotus Elise")).toBe(false);
  });

  it("knows Central European summer time", () => {
    expect(cetOffset("2026-11-23 01:21:02")).toBe("+01:00");
    expect(cetOffset("2026-07-01 12:00:00")).toBe("+02:00");
    expect(cetOffset("2026-03-29 03:00:00")).toBe("+02:00");
    expect(cetOffset("2026-10-25 04:00:00")).toBe("+01:00");
  });

  it("lists every group site once", () => {
    const keys = europeASites.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(14);
  });
});
