import { describe, expect, it } from "vitest";
import { americasSites } from "../../src/sites/americas/index.js";
import { olxBr } from "../../src/sites/americas/olx-br.js";
import { expectBlockedReadsFailed, fixture, listings, query } from "./site-harness.js";

describe("americas sites", () => {
  it("registers every key, each with its own currency", () => {
    expect(americasSites.map((s) => [s.key, s.host, s.currency])).toEqual([
      ["olx_br", "www.olx.com.br", "BRL"],
      ["mercadolivre_br", "lista.mercadolivre.com.br", "BRL"],
      ["mercadolibre_ar", "listado.mercadolibre.com.ar", "ARS"],
      ["mercadolibre_mx", "listado.mercadolibre.com.mx", "MXN"],
      ["mercadolibre_cl", "listado.mercadolibre.cl", "CLP"],
      ["mercadolibre_co", "listado.mercadolibre.com.co", "COP"],
    ]);
  });
});

describe("olx_br", () => {
  it("reads ads from the flight data, on regional listing hosts", () => {
    const { outcome, listings: ls } = listings(olxBr, fixture("ebay-americas/olx-br.html"));
    expect(outcome).toMatchObject({ kind: "results", total: 5, hasMore: false });
    expect(ls.map((l) => l.id)).toEqual(["1554316604", "1489131695", "1458495378", "1409977372"]);
    expect(ls[1]).toMatchObject({
      url: "https://sp.olx.com.br/sao-paulo-e-regiao/hobbies-e-colecoes/6-partes-da-black-lotus-ultra-pro-puzzle-quest-1-repetida-1489131695",
      title: "6 partes da Black Lotus Ultra Pro Puzzle Quest (1 repetida)",
      price: { amount: 2500, currency: "BRL" },
      format: "fixed_price",
      condition: "used",
      posted_at: "2026-11-11T11:39:16.000Z",
      country: "br",
      promoted: false,
    });
    for (const l of ls) expect(l.price!.amount).toBeGreaterThanOrEqual(500);
  });

  it("applies newest-first, price and page on the site", () => {
    const req = olxBr.search(query({ query: "black lotus", minPrice: 500, maxPrice: 5000, page: 2 }));
    expect(req.url).toBe("https://www.olx.com.br/brasil?q=black+lotus&sf=1&ps=500&pe=5000&o=2");
    expect(req.applies).toEqual({ sort: true, minPrice: true, maxPrice: true });
    expect(olxBr.search(query({ sort: "price_low" })).applies?.sort).toBe(false);
  });

  it("reads the no-ads page as empty, a new layout as redesigned and a challenge as failed", () => {
    expect(listings(olxBr, fixture("ebay-americas/olx-br-empty.html")).outcome).toEqual({ kind: "empty" });
    expect(listings(olxBr, "<html><body>new layout</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(olxBr);
  });
});
