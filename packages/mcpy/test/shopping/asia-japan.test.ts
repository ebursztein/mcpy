import { describe, expect, it } from "vitest";
import { mercariJp } from "../../src/sites/asia/mercari.js";
import { paypayFlea } from "../../src/sites/asia/paypay-flea.js";
import { rakuma } from "../../src/sites/asia/rakuma.js";
import { expectBlockedReadsFailed, fixture, listings, page, query } from "./site-harness.js";

const JA = query({ query: "リザードン" });

describe("paypay_flea", () => {
  it("reads __NEXT_DATA__ rows, not the Yahoo! Auctions module", () => {
    const { outcome, listings: ls } = listings(paypayFlea, fixture("asia/paypay-flea.html"), undefined, (p) => paypayFlea.read(p, JA));
    expect(outcome).toMatchObject({ kind: "results", total: 86604, hasMore: false });
    expect(ls).toHaveLength(4);
    for (const l of ls) {
      expect(l.url).toBe(`https://paypayfleamarket.yahoo.co.jp/item/${l.id}`);
      expect(l.price?.currency).toBe("JPY");
      expect(l.posted_at).toMatch(/\+09:00$/);
      expect(l.status).toBe("available");
    }
    expect(ls[0]).toMatchObject({ id: "z729998512", price: { amount: 1000 }, condition: "used", format: "fixed_price" });
    expect(ls[0]!.seller).toEqual({ name: "p63819801", feedback_count: 1325, feedback_percent: 99.8 });
    expect(ls[0]!.details?.["Condition"]).toBe("やや傷や汚れあり");
  });

  it("applies sort, price and page on the site", () => {
    const req = paypayFlea.search(query({ query: "リザードン", minPrice: 5000, maxPrice: 20000, sort: "newest", page: 2 }));
    expect(req.url).toBe("https://paypayfleamarket.yahoo.co.jp/search/%E3%83%AA%E3%82%B6%E3%83%BC%E3%83%89%E3%83%B3?sort=openTime&order=desc&minPrice=5000&maxPrice=20000&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(paypayFlea.search(query({ sort: "ending_soon" })).applies?.sort).toBe(false);
  });

  it("reads the vector-search retry (HTTP 404) as empty", () => {
    const html = fixture("asia/paypay-flea-empty.html");
    const url = paypayFlea.search(query({ query: "qzxvbnmwplkjh zzqqxxyy" })).url;
    expect(paypayFlea.read(page(html, url, 404), JA).kind).toBe("empty");
    expect(paypayFlea.read(page(html, url, 200), JA).kind).toBe("empty");
    expect(paypayFlea.emptyStatuses).toContain(404);
    expect(listings(paypayFlea, "<html><body>new layout</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(paypayFlea);
  });
});

describe("mercari_jp", () => {
  it("reads rendered item cells with the canonical item and shop URLs", () => {
    const { outcome, listings: ls } = listings(mercariJp, fixture("asia/mercari.html"), undefined, (p) => mercariJp.read(p, JA));
    expect(outcome).toMatchObject({ kind: "results", hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["m87217648076", "m34675654377", "m36262064083", "m21659927974", "2JZfvg4G47JQAxjqd84WJa"]);
    expect(ls[0]).toMatchObject({ url: "https://jp.mercari.com/item/m87217648076", price: { amount: 8000, currency: "JPY" }, format: "fixed_price" });
    // "現在 ¥6,666": an auction's current bid.
    expect(ls[1]).toMatchObject({ price: { amount: 6666, currency: "JPY" }, format: "auction" });
    expect(ls[4]).toMatchObject({ url: "https://jp.mercari.com/shops/product/2JZfvg4G47JQAxjqd84WJa", price: { amount: 10200, currency: "JPY" } });
    expect(ls[0]!.image).toMatch(/^https:\/\/static\.mercdn\.net\//);
  });

  it("renders, and applies sort, price, on-sale and the page token", () => {
    const req = mercariJp.search(query({ query: "リザードン", minPrice: 5000, maxPrice: 20000, sort: "newest", page: 3 }));
    expect(req.render).toBe(true);
    expect(req.country).toBe("jp");
    expect(req.url).toBe("https://jp.mercari.com/search?keyword=%E3%83%AA%E3%82%B6%E3%83%BC%E3%83%89%E3%83%B3&status=on_sale&sort=created_time&order=desc&price_min=5000&price_max=20000&page_token=v1%3A2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads the rendered empty state as empty, the bare app shell as failed", () => {
    expect(listings(mercariJp, fixture("asia/mercari-empty.html")).outcome.kind).toBe("empty");
    const shell = '<html><head><script>{"noItems":"出品された商品がありません"}</script></head><body><div id="root"></div></body></html>';
    expect(listings(mercariJp, shell).outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(mercariJp);
  });
});

describe("rakuma", () => {
  it("reads server-rendered cards on item.fril.jp and marks sold rows", () => {
    const { outcome, listings: ls } = listings(rakuma, fixture("asia/rakuma.html"), undefined, (p) => rakuma.read(p, JA));
    expect(outcome).toMatchObject({ kind: "results", total: 96812, hasMore: false });
    expect(ls).toHaveLength(4);
    expect(ls[0]).toMatchObject({
      id: "716c15594aae06f7db8fe945520e93b2",
      url: "https://item.fril.jp/716c15594aae06f7db8fe945520e93b2",
      title: "ポケモンカード プリズム リザードン",
      price: { amount: 124800, currency: "JPY" },
      status: "available",
    });
    expect(ls[0]!.image).toMatch(/^https:\/\/img\.fril\.jp\/img\/866424064\//);
    expect(ls[0]!.details?.["Item number"]).toBe("866424064");
    expect(ls[3]!.status).toBe("sold_out");
  });

  it("applies sort, price, on-sale and page on the site", () => {
    const req = rakuma.search(query({ query: "リザードン", minPrice: 5000, maxPrice: 20000, sort: "newest", page: 2 }));
    expect(req.url).toBe("https://fril.jp/s?query=%E3%83%AA%E3%82%B6%E3%83%BC%E3%83%89%E3%83%B3&sort=created_at&order=desc&min=5000&max=20000&transaction=selling&page=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
  });

  it("reads fuzzy filler for a query nothing matches as empty", () => {
    const html = fixture("asia/rakuma-fuzzy.html");
    expect(rakuma.read(page(html, "https://fril.jp/s?query=x"), query({ query: "qzxvbnmwplkjh zzqqxxyy" })).kind).toBe("empty");
    expect(listings(rakuma, "<html><body>new layout</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(rakuma);
  });
});
