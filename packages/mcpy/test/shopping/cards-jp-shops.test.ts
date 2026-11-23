import { describe, expect, it } from "vitest";
import { cardrush } from "../../src/sites/cards/cardrush.js";
import { dorasuta } from "../../src/sites/cards/dorasuta.js";
import { hareruya } from "../../src/sites/cards/hareruya.js";
import { magi } from "../../src/sites/cards/magi.js";
import { surugaya } from "../../src/sites/cards/surugaya.js";
import { yuyutei } from "../../src/sites/cards/yuyutei.js";
import { expectBlockedReadsFailed, fixture, listings, query } from "./site-harness.js";

const jp = (q = {}) => query({ query: "リザードン", ...q });

describe("hareruya", () => {
  it("reads each stock unit from the search API, with grade, language and stock", () => {
    const { outcome, listings: ls } = listings(hareruya, fixture("cards/hareruya-search.json"));
    expect(outcome).toMatchObject({ kind: "results", total: 100 });
    expect(ls).toHaveLength(5);
    expect(ls[0]).toMatchObject({ id: "1321763", url: "https://www.hareruyamtg.com/en/products/detail/1282", title: "《Black Lotus》[2ED]", price: { amount: 4200000, currency: "JPY" }, card_condition: "excellent", language: "en", quantity: 1 });
    expect(ls.find((l) => l.status === "sold_out")).toBeDefined();
    expect(ls.find((l) => l.details?.["Foil"] === "yes")).toBeDefined();
    // Accessories have no grade: none is invented.
    expect(ls.at(-1)!.card_condition).toBeUndefined();
  });

  it("applies price and price sort on the site, not newest", () => {
    const req = hareruya.search(query({ query: "black lotus", minPrice: 100000, sort: "price_low", page: 2 }));
    expect(req.url).toBe("https://www.hareruyamtg.com/en/products/search/unisearch_api?kw=black%20lotus&fq.price=100000~*&sort=price+asc&rows=60&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(hareruya.search(query()).applies?.sort).toBe(false);
  });

  it("reads rows the site found by dropping query words as empty, not as results", () => {
    expect(listings(hareruya, fixture("cards/hareruya-fallback.json")).outcome.kind).toBe("empty");
    expect(listings(hareruya, '{"responseHeader":{"status":0},"response":{"numFound":0,"docs":[]}}').outcome.kind).toBe("empty");
    expect(listings(hareruya, "<html>new</html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(hareruya);
  });
});

describe("yuyutei", () => {
  it("reads each card with price, stock and rarity", () => {
    const { outcome, listings: ls } = listings(yuyutei, fixture("cards/yuyutei-search.html"), yuyutei.search(jp()).url);
    expect(outcome.kind).toBe("results");
    expect(ls).toHaveLength(5);
    expect(ls[0]).toMatchObject({ id: "m02-10116", url: "https://yuyu-tei.jp/sell/poc/card/m02/10116", title: "メガリザードンXex", price: { amount: 128000, currency: "JPY" }, status: "sold_out", language: "ja" });
    expect(ls[0]!.details?.["Rarity"]).toBe("MUR");
    expect(ls[1]).toMatchObject({ status: "available", quantity: 8 });
  });

  it("reads the no-match page as empty", () => {
    expect(listings(yuyutei, fixture("cards/yuyutei-empty.html")).outcome.kind).toBe("empty");
    expect(listings(yuyutei, "<html><body>new</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(yuyutei);
  });
});

describe("cardrush", () => {
  it("reads each stock item with price and stock count; sorts by price on the site", () => {
    const { outcome, listings: ls } = listings(cardrush, fixture("cards/cardrush-search.html"), cardrush.search(jp()).url);
    expect(outcome).toMatchObject({ kind: "results", hasMore: true });
    expect(ls).toHaveLength(4);
    expect(ls[0]).toMatchObject({ id: "50167", url: "https://www.cardrush-pokemon.jp/product/50167", title: "リザードン ex(RR仕様)【-】{009/049}", price: { amount: 1380, currency: "JPY" }, quantity: 37, status: "available" });
    const req = cardrush.search(jp({ sort: "price_low" }));
    expect(req.url).toContain("&order=asc");
    expect(req.applies).toEqual({ sort: true });
    expect(cardrush.search(jp()).applies).toEqual({ sort: false });
  });

  it("reads the 0-item page as empty", () => {
    expect(listings(cardrush, fixture("cards/cardrush-empty.html")).outcome.kind).toBe("empty");
    expect(listings(cardrush, "<html><body>new</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(cardrush);
  });
});

describe("dorasuta", () => {
  it("reads each stock item; SOLDOUT rows are marked, not dropped", () => {
    const { outcome, listings: ls } = listings(dorasuta, fixture("cards/dorasuta-search.html"), dorasuta.search(jp()).url);
    expect(outcome).toMatchObject({ kind: "results", total: 179 });
    expect(ls).toHaveLength(3);
    expect(ls[0]).toMatchObject({ id: "1739119", url: "https://dorasuta.jp/pokemon-card/product?pid=697383", price: { amount: 98000, currency: "JPY" }, quantity: 1, status: "available" });
    expect(ls[0]!.details?.["Damaged"]).toBe("yes");
    expect(ls[1]!.details?.["Play grade"]).toBe("yes");
    expect(ls[2]).toMatchObject({ status: "sold_out" });
    expect(ls[2]!.quantity).toBeUndefined();
  });

  it("reads the no-match page as empty", () => {
    expect(listings(dorasuta, fixture("cards/dorasuta-empty.html")).outcome.kind).toBe("empty");
    expect(listings(dorasuta, "<html><body>new</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(dorasuta);
  });
});

describe("magi", () => {
  it("reads sellers' listings, marks sold rows and applies sort and price on the site", () => {
    const req = magi.search(jp({ minPrice: 5000, maxPrice: 20000, page: 2 }));
    expect(req.url).toBe(
      "https://magi.camp/items/search?forms_search_items%5Bkeyword%5D=%E3%83%AA%E3%82%B6%E3%83%BC%E3%83%89%E3%83%B3&forms_search_items%5Bsort%5D=price_minimum_updated_at_desc&forms_search_items%5Bfrom_price%5D=5000&forms_search_items%5Bto_price%5D=20000&forms_search_items%5Bstatus%5D=presented&page=2",
    );
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    const { outcome, listings: ls } = listings(magi, fixture("cards/magi-search.html"), magi.search(jp()).url);
    expect(outcome).toMatchObject({ kind: "results", total: 4484, hasMore: true });
    expect(ls).toHaveLength(4);
    expect(ls[0]).toMatchObject({ id: "934309226", url: "https://magi.camp/items/934309226", price: { amount: 12133, currency: "JPY" }, format: "fixed_price", status: "available" });
    expect(ls[3]!.status).toBe("sold_out");
  });

  it("reads a buyer's wanted post as wanted, without its placeholder price", () => {
    const html = '<div class="item-list__box "><a class="item-list__link" href="/items/123"><div class="item-list__item-name">【求】リザードン 旧裏</div><ul class="item-list__price-box"><li class="item-list__price-box--price">¥ 9,999,999</li></ul></a></div>';
    const { listings: ls } = listings(magi, html);
    expect(ls[0]).toMatchObject({ id: "123", format: "wanted" });
    expect(ls[0]!.price).toBeUndefined();
  });

  it("reads the no-listing page as empty", () => {
    expect(listings(magi, fixture("cards/magi-empty.html")).outcome.kind).toBe("empty");
    expect(listings(magi, "<html><body>new</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(magi);
  });
});

describe("surugaya", () => {
  it("reads one listing per stated own price; other sellers' lowest price is not a listing", () => {
    const { outcome, listings: ls } = listings(surugaya, fixture("cards/surugaya-search.html"), surugaya.search(jp()).url);
    expect(outcome).toMatchObject({ kind: "results", hasMore: true });
    expect(ls[0]).toMatchObject({ id: "561725956-used", url: "https://www.suruga-ya.jp/product/detail/561725956", price: { amount: 660, currency: "JPY" }, condition: "used", status: "available" });
    // A time sale lists the sale price, not the struck-through one.
    const sale = ls.find((l) => l.details?.["Time sale"] === "yes");
    expect(sale?.price?.amount).toBe(840);
    expect(ls.some((l) => l.status === "sold_out" && l.price === undefined)).toBe(true);
    expect(ls.map((l) => l.price?.amount)).not.toContain(460);
  });

  it("reads the 404 no-match page as empty", () => {
    expect(surugaya.emptyStatuses).toContain(404);
    expect(listings(surugaya, fixture("cards/surugaya-empty.html")).outcome.kind).toBe("empty");
    expect(listings(surugaya, "<html><body>new</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(surugaya);
  });
});
