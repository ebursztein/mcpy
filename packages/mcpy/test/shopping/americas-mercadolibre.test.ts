import { describe, expect, it } from "vitest";
import { mercadoLibreSites } from "../../src/sites/americas/mercadolibre.js";
import { expectBlockedReadsFailed, fixture, listings, page, query } from "./site-harness.js";

const br = mercadoLibreSites[0]!;

describe("mercadolivre_br search page (served by Bright Data)", () => {
  const { outcome, listings: ls } = listings(br, fixture("ebay-americas/mercadolivre-br.html"));

  it("reads polycards from _n.ctx.r as item listings", () => {
    expect(outcome).toMatchObject({ kind: "results", total: 3386, hasMore: true });
    expect(ls.map((l) => l.id)).toEqual(["MLB6866391086", "MLB3557761137", "MLB7978719220", "MLB7129596798"]);
    for (const l of ls) expect(l.url).toBe(`https://produto.mercadolivre.com.br/MLB-${l.id.slice(3)}-_JM`);
  });

  it("reads price, free shipping, seller, ads and pictures", () => {
    expect(ls[0]).toMatchObject({
      title: "Pokémon Charizard Monster Collection Ex - Takara Tomy",
      price: { amount: 99, currency: "BRL" },
      format: "fixed_price",
      shipping: { amount: 0, currency: "BRL" },
      seller: { name: "POKÉMON" },
      promoted: true,
      image: "https://http2.mlstatic.com/D_Q_NP_964152-MLB106746496249_022026-E.webp",
      details: { Rating: "4.9", Highlight: "MAIS VENDIDO" },
    });
    expect(ls[2]!.details).toMatchObject({ Highlight: "ÚLTIMAS 3", "Catalog product": "MLB53398363" });
    expect(ls[3]).toMatchObject({ location: "China", promoted: false, details: { International: "yes", Promotion: "10% OFF com Cupom" } });
  });
});

describe("mercadolibre walls and requests", () => {
  const wall = fixture("ebay-americas/mercadolivre-br-wall.html");

  it("reads the account-verification wall as blocked on every country", () => {
    for (const site of mercadoLibreSites) {
      const url = site.search(query()).url;
      const p = { ...page(wall, url), finalUrl: `https://www.${site.host.split(".").slice(1).join(".")}/gz/account-verification?go=${encodeURIComponent(url)}` };
      expect(site.read(p, query())).toMatchObject({ kind: "failed", failure: "blocked" });
      expect(site.read(page(wall, url), query())).toMatchObject({ kind: "failed", failure: "blocked" });
      expectBlockedReadsFailed(site);
    }
    expect(br.read(page("<html><body>new layout</body></html>"), query())).toMatchObject({ kind: "failed", failure: "redesigned" });
  });

  it("reads a state without rows as empty", () => {
    const empty = '<script>_n.ctx.r={"appProps":{"pageProps":{"initialState":{"results":[],"pagination":{}}}}};</script>';
    expect(br.read(page(empty), query())).toEqual({ kind: "empty" });
  });

  it("uses the page's own URL grammar and claims only the sort", () => {
    expect(br.search(query({ query: "black lotus", sort: "price_low", minPrice: 50, page: 2 }))).toEqual({
      url: "https://lista.mercadolivre.com.br/black-lotus_OrderId_PRICE_PriceRange_50BRL-0BRL_Desde_49_NoIndex_True",
      applies: { sort: true },
    });
    expect(mercadoLibreSites[2]!.search(query({ sort: "price_high", maxPrice: 900 })).url).toBe("https://listado.mercadolibre.com.mx/charizard_OrderId_PRICE*DESC_PriceRange_0MXN-900MXN_NoIndex_True");
    expect(br.search(query({ sort: "newest" })).applies).toEqual({ sort: false });
  });

  it("knows listing ids on the product and item hosts", () => {
    expect(br.listingId(new URL("https://produto.mercadolivre.com.br/MLB-1234567890-carta-charizard-_JM"))).toBe("MLB1234567890");
    expect(br.listingId(new URL("https://www.mercadolivre.com.br/carta-charizard/p/MLB19876543"))).toBe("MLB19876543");
  });
});
