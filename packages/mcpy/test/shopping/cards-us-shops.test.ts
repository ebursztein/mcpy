import { describe, expect, it } from "vitest";
import { cardkingdom } from "../../src/sites/cards/cardkingdom.js";
import { coolstuffinc } from "../../src/sites/cards/coolstuffinc.js";
import { starcitygames } from "../../src/sites/cards/starcitygames.js";
import { expectBlockedReadsFailed, fixture, listings, page, query } from "./site-harness.js";

describe("cardkingdom", () => {
  it("reads one listing per grade of each product, with stock and sold-out grades", () => {
    const q = query({ query: "black lotus" });
    expect(cardkingdom.search(q).url).toBe("https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=black+lotus");
    const { outcome, listings: ls } = listings(cardkingdom, fixture("cards/cardkingdom-search.html"), cardkingdom.search(q).url);
    expect(outcome.kind).toBe("results");
    expect(ls).toHaveLength(12);
    expect(ls[0]).toMatchObject({
      id: "mtg/collectors-ed/black-lotus-not-tournament-legal:NM",
      url: "https://www.cardkingdom.com/mtg/collectors-ed/black-lotus-not-tournament-legal",
      title: "Black Lotus (Not Tournament Legal) - Collectors Ed (R)",
      price: { amount: 3799.99, currency: "USD" },
      card_condition: "near_mint",
      quantity: 2,
      status: "available",
    });
    expect(ls[1]).toMatchObject({ card_condition: "excellent", status: "sold_out" });
    expect(new Set(ls.map((l) => l.card_condition))).toEqual(new Set(["near_mint", "excellent", "light_played", "played"]));
    expect(new Set(ls.map((l) => l.id)).size).toBe(ls.length);
  });

  it("reads the no-results page as empty and a challenge as failed", () => {
    expect(listings(cardkingdom, fixture("cards/cardkingdom-empty.html")).outcome.kind).toBe("empty");
    expect(listings(cardkingdom, "<html><body>new layout</body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(cardkingdom);
  });
});

describe("starcitygames", () => {
  it("asks for a rendered page and reads one listing per grade variant", () => {
    const req = starcitygames.search(query({ query: "black lotus" }));
    expect(req).toMatchObject({ url: "https://starcitygames.com/search/?search_query=black+lotus", render: true });
    const { outcome, listings: ls } = listings(starcitygames, fixture("cards/starcitygames-search.html"), req.url);
    expect(outcome).toMatchObject({ kind: "results", hasMore: false });
    expect(ls.length).toBeGreaterThanOrEqual(3);
    expect(ls[0]).toMatchObject({
      id: "1755923",
      url: "https://starcitygames.com/black-lotus-sgl-mtg-2ed-233-enn/",
      title: "Black Lotus - Unlimited Edition",
      price: { amount: 25999.99, currency: "USD" },
      card_condition: "near_mint",
      status: "sold_out",
    });
    const inStock = ls.filter((l) => l.status === "available");
    expect(inStock.length).toBeGreaterThan(0);
    for (const l of inStock) expect(l.quantity).toBeGreaterThan(0);
    expect(ls.map((l) => l.details?.["Condition"])).toEqual(expect.arrayContaining(["PL", "HP"]));
  });

  it("reads rows for a spell-corrected query as empty, not as results", () => {
    expect(listings(starcitygames, fixture("cards/starcitygames-corrected.html")).outcome.kind).toBe("empty");
  });

  it("reads the unrendered shell as redesigned, never as empty", () => {
    expect(listings(starcitygames, "<html><body><div id='search-page'></div></body></html>").outcome).toMatchObject({ kind: "failed", failure: "redesigned" });
    expectBlockedReadsFailed(starcitygames);
  });
});

describe("coolstuffinc", () => {
  it("reports the empty body its search serves to automated clients as blocked", () => {
    expect(coolstuffinc.search(query({ query: "black lotus" })).url).toBe("https://www.coolstuffinc.com/main_search.php?pa=searchOnName&page=1&resultsPerPage=25&q=black+lotus");
    expect(coolstuffinc.read(page('<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body></body></html>'), query())).toMatchObject({ kind: "failed", failure: "blocked" });
    expect(coolstuffinc.read(page("<html><body>Some page</body></html>"), query())).toMatchObject({ kind: "failed", failure: "redesigned" });
  });
});
