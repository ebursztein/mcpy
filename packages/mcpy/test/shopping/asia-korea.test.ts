import { describe, expect, it } from "vitest";
import { bunjang } from "../../src/sites/asia/bunjang.js";
import { koreanWanted, noLiteralMatch } from "../../src/sites/asia/common.js";
import { daangn } from "../../src/sites/asia/daangn.js";
import { joongna } from "../../src/sites/asia/joongna.js";
import { expectBlockedReadsFailed, fixture, listings, page, query } from "./site-harness.js";

const KO = query({ query: "리자몽" });
const NONSENSE = query({ query: "qzxjvwk glurak zzqv" });

describe("joongna", () => {
  it("reads postSearchProduct rows from the flight data", () => {
    const { outcome, listings: ls } = listings(joongna, fixture("asia/joongna.html"), undefined, (p) => joongna.read(p, KO));
    expect(outcome).toMatchObject({ kind: "results", total: 753, hasMore: false });
    expect(ls).toHaveLength(4);
    expect(ls[0]).toMatchObject({
      id: "233628118",
      url: "https://web.joongna.com/product/233628118",
      title: "포켓몬고 거다이 리자몽 이로치 판매",
      price: { amount: 65000, currency: "KRW" },
      shipping: { amount: 0, currency: "KRW" },
      posted_at: "2026-11-23T09:03:08+09:00",
      location: "경기도 수원시 권선구 평동",
      status: "available",
      format: "fixed_price",
    });
    expect(ls[1]!.shipping).toBeUndefined();
  });

  it("applies sort, price and page on the site", () => {
    const req = joongna.search(query({ query: "리자몽", minPrice: 5000, maxPrice: 20000, sort: "newest", page: 2 }));
    expect(req.url).toBe("https://web.joongna.com/search/%EB%A6%AC%EC%9E%90%EB%AA%BD?sort=RECENT_SORT&minPrice=5000&maxPrice=20000&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads the no-results page as empty", () => {
    expect(listings(joongna, fixture("asia/joongna-empty.html"), undefined, (p) => joongna.read(p, NONSENSE)).outcome.kind).toBe("empty");
    expect(listings(joongna, "<html><body>new layout</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(joongna);
  });
});

describe("bunjang", () => {
  it("reads the search API, keeps paid placements as promoted, drops off-site ads, marks buyer posts", () => {
    const { outcome, listings: ls } = listings(bunjang, fixture("asia/bunjang.json"), undefined, (p) => bunjang.read(p, KO));
    expect(outcome).toMatchObject({ kind: "results", hasMore: true });
    expect(outcome.kind === "results" && outcome.nextCursor).toMatch(/^eyJ/);
    expect(ls.map((l) => l.id)).toEqual(["450246713", "428731877", "446194985", "442800663", "400591380"]);
    for (const l of ls) expect(l.url).toBe(`https://m.bunjang.co.kr/products/${l.id}`);
    expect(ls[0]!.price?.currency).toBe("KRW");
    // updatedAt is a bump time, not the listing time: it is a detail, never posted_at.
    expect(ls[0]!.posted_at).toBeUndefined();
    expect(ls[0]!.details?.["Updated"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ls[0]!.image).toMatch(/_w400\.jpg$/);
    expect(ls[4]).toMatchObject({ promoted: true, format: "wanted" });
    expect(ls[0]).toMatchObject({ promoted: false, format: "fixed_price", status: "available" });
  });

  it("applies sort and price on the API and pages with the site's own cursor", () => {
    const req = bunjang.search(query({ query: "리자몽", minPrice: 5000, maxPrice: 20000, sort: "newest" }));
    expect(req.url).toBe("https://api.bunjang.co.kr/api/search/v8/web/search?policyKey=mw.product.keyword&q=%EB%A6%AC%EC%9E%90%EB%AA%BD&sort=latest&minPrice=5000&maxPrice=20000&size=60");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(bunjang.pagesByCursor).toBe(true);
    const first = bunjang.read(page(fixture("asia/bunjang.json"), req.url), KO);
    const token = first.kind === "results" ? first.nextCursor! : "";
    const next = bunjang.search(query({ query: "리자몽", sort: "newest", page: 2, cursor: token }));
    expect(next.url).toBe(`https://api.bunjang.co.kr/api/search/v8/web/search?policyKey=mw.product.keyword&q=%EB%A6%AC%EC%9E%90%EB%AA%BD&sort=latest&size=60&cursor=${encodeURIComponent(token)}`);
  });

  it("reads SEARCH_EMPTY as empty", () => {
    expect(listings(bunjang, fixture("asia/bunjang-empty.json"), undefined, (p) => bunjang.read(p, NONSENSE)).outcome.kind).toBe("empty");
    expect(listings(bunjang, '{"data":{}}').outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(bunjang);
  });
});

describe("daangn", () => {
  it("reads buySellArticles from the Remix state", () => {
    const { outcome, listings: ls } = listings(daangn, fixture("asia/daangn.html"), undefined, (p) => daangn.read(p, KO));
    expect(outcome).toMatchObject({ kind: "results", hasMore: false });
    expect(ls).toHaveLength(4);
    expect(ls[0]).toMatchObject({
      id: "um4yspvdqkn7",
      url: "https://www.daangn.com/kr/buy-sell/%ED%8F%AC%EC%BC%93%EB%AA%AC-%EB%A6%AC%EC%9E%90%EB%AA%BD-ex-sar-psa-10-um4yspvdqkn7/",
      title: "포켓몬 리자몽 ex SAR PSA 10",
      price: { amount: 490000, currency: "KRW" },
      posted_at: "2026-11-19T06:15:39Z",
      location: "청룡동",
      status: "available",
    });
    expect(ls[0]!.description).toContain("PSA 10");
  });

  it("applies price and on-sale on the site, not sort", () => {
    const req = daangn.search(query({ query: "리자몽", minPrice: 5000, maxPrice: 20000, sort: "newest" }));
    expect(req.url).toBe("https://www.daangn.com/kr/search/buy-sell/?q=%EB%A6%AC%EC%9E%90%EB%AA%BD&only_on_sale=true&price=5000__20000");
    expect(req.applies).toEqual({ sort: false, minPrice: true, maxPrice: true });
    expect(daangn.search(query({ minPrice: 5000 })).url).toContain("&price=5000__");
  });

  it("reads semantic filler for a query nothing matches as empty", () => {
    expect(listings(daangn, fixture("asia/daangn-semantic.html"), undefined, (p) => daangn.read(p, NONSENSE)).outcome.kind).toBe("empty");
    expect(listings(daangn, "<html><body>new layout</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(daangn);
  });
});

describe("asia common", () => {
  it("calls a page filler only when no row states a query word", () => {
    expect(noLiteralMatch("qzxjvwk glurak", ["포켓몬카드 레쿠쟈", "글레이시아vmax"])).toBe(true);
    expect(noLiteralMatch("리자몽 ex", ["포켓몬 리자몽", "피카츄"])).toBe(false);
    expect(noLiteralMatch("ＲＩＺＡ", ["riza card"])).toBe(false);
    expect(noLiteralMatch("x", ["anything"])).toBe(false);
  });

  it("recognises Korean buyer posts, not sellers addressing buyers", () => {
    for (const t of ["리자몽 카드 삽니다", "매입) 포켓몬 카드", "[구매] 리자몽", "리자몽 구해요"]) expect(koreanWanted(t)).toBe(true);
    for (const t of ["리자몽 판매합니다", "구매하실 분 연락주세요", "포켓몬 카드"]) expect(koreanWanted(t)).toBe(false);
  });
});
