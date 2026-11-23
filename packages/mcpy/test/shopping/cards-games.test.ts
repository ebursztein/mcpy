import { describe, expect, it } from "vitest";
import { cardSites } from "../../src/sites/cards/index.js";
import { cardkingdom } from "../../src/sites/cards/cardkingdom.js";
import { cardmarket } from "../../src/sites/cards/cardmarket.js";
import { cardtrader } from "../../src/sites/cards/cardtrader.js";
import { hareruya } from "../../src/sites/cards/hareruya.js";
import { starcitygames } from "../../src/sites/cards/starcitygames.js";
import { tcgplayer } from "../../src/sites/cards/tcgplayer.js";
import { yuyutei } from "../../src/sites/cards/yuyutei.js";
import { listings, query } from "./site-harness.js";

describe("card sites per game", () => {
  it("search each game on its own Cardmarket path", () => {
    expect(cardmarket.search(query({ query: "black lotus", game: "mtg" })).url).toBe("https://www.cardmarket.com/en/Magic/Products/Search?searchString=black%20lotus");
    expect(cardmarket.search(query({ game: "yugioh" })).url).toContain("/en/YuGiOh/");
    expect(cardmarket.search(query({ game: "one_piece" })).url).toContain("/en/OnePiece/");
    expect(cardmarket.search(query({ game: "lorcana" })).url).toContain("/en/Lorcana/");
    expect(cardmarket.search(query()).url).toContain("/en/Pokemon/");
  });

  it("pass CardTrader's game slug", () => {
    expect(cardtrader.search(query({ query: "black lotus", game: "mtg" })).url).toBe("https://www.cardtrader.com/en/search?q=black%20lotus&game=magic");
    expect(cardtrader.search(query({ game: "yugioh" })).url).toContain("&game=yu-gi-oh");
    expect(cardtrader.search(query({ game: "one_piece" })).url).toContain("&game=one-piece");
    expect(cardtrader.search(query()).url).toContain("&game=pokemon");
  });

  it("filter TCGplayer on the game's product lines, and not at all without a game", () => {
    const term = (game?: "mtg" | "pokemon" | "lorcana") => JSON.parse(tcgplayer.search(query({ game })).body!).filters.term;
    expect(term("mtg")).toEqual({ productLineName: ["magic"] });
    expect(term("pokemon")).toEqual({ productLineName: ["pokemon", "pokemon-japan"] });
    expect(term("lorcana")).toEqual({ productLineName: ["lorcana-tcg"] });
    expect(term()).toEqual({});
  });

  it("use Yuyu-tei's path per game", () => {
    expect(yuyutei.search(query({ game: "yugioh" })).url).toBe("https://yuyu-tei.jp/sell/ygo/s/search?search_word=charizard");
    expect(yuyutei.search(query({ game: "one_piece" })).url).toContain("/sell/opc/");
    expect(yuyutei.search(query()).url).toContain("/sell/poc/");
  });

  it("declare the games each site sells, main one first", () => {
    for (const s of cardSites) if (s.games) expect(s.games.length).toBeGreaterThan(0);
    expect(cardkingdom.games).toEqual(["mtg"]);
    expect(hareruya.games).toEqual(["mtg"]);
    expect(cardmarket.games?.[0]).toBe("pokemon");
    expect(yuyutei.games).toEqual(["pokemon", "yugioh", "one_piece"]);
  });

  it("keep only Magic rows from Star City Games' all-game search", () => {
    const row = (game: string, id: string) =>
      `<div class="hawk-results-item ${game}"><h2><a class="item-title-link" href="https://starcitygames.com/x-sgl-mtg-${id}/">Card ${id}</a></h2><div class="variant-row "><div data-tooltip-id="1_Near_Mint_${id}_tippy"><div class="name">NM</div></div><div class="hawk-results-item__options-table-cell--price childAttributes">$1.00</div><div class="stock-count">2 in stock</div></div></div>`;
    const { listings: ls } = listings(starcitygames, `<div id="hawkitemlist">${row("magic-the-gathering", "11")}${row("disney-lorcana", "22")}</div>`);
    expect(ls.map((l) => l.id)).toEqual(["11"]);
  });
});
