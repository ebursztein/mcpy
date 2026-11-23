/**
 * 2026-11-23 (cardy): Rakuma and PayPay Flea answered "リザードン 初版" with
 * One Piece cards and Pikachu promos; Leboncoin, Milanuncios and Wallapop
 * answered "black lotus" with Lotus cars, watches and "Black Month" car ads.
 * Those rows used up the call's 60 results. title_match (auto: all_words on
 * sites that match loosely) now drops rows whose title lacks the query.
 * Never delete these.
 */

import { describe, expect, it } from "vitest";
import { ContentKind, PageFormat } from "mcpy";
import { fold, titleMatcher } from "../../src/services/shopping/title-match.js";
import { fakePages, page, testMcpy } from "../helpers.js";
import { fixture } from "../shopping/site-harness.js";

const html = (content: string, url: string) => page({ url, finalUrl: url, content, contentType: "text/html", kind: ContentKind.Html, format: PageFormat.Html });

describe("title_match", () => {
  it("keeps the live titles that state the query and drops the filler", () => {
    const all = titleMatcher("black lotus", "all_words")!;
    expect(all("Puzzle black lotus 6/9")).toBe(true);
    expect(all("Magic l'assemblée Gatherers' Tavern: Sculpture en relief \"Black Lotus\"")).toBe(true);
    expect(all("Exige S V6 Roadster 350 ch | Française | *Nightfall Blue* – Suivi complet Lotus")).toBe(false);
    expect(all("Reloj Lotus All Titanium Plata y Negro")).toBe(false);
    expect(all("ASTON MARTIN DB12 4.0 V8 Auto")).toBe(false);
    // Both words, not together: all_words keeps it, phrase does not.
    expect(all("Jantes Lotus Exige S2 Satin Black")).toBe(true);
    expect(titleMatcher("black lotus", "phrase")!("Jantes Lotus Exige S2 Satin Black")).toBe(false);
    expect(titleMatcher("black lotus", "phrase")!("Deckbox ultra pro black-lotus 2008")).toBe(true);
  });

  it("finds Japanese words inside unspaced titles, and Latin words only whole", () => {
    const ja = titleMatcher("リザードン 初版", "all_words")!;
    expect(ja("かいりきリザードン/初版マークなし ポケモンカード旧裏")).toBe(true);
    expect(ja("ワンピースカード 神の支配 エドワードニューゲート SP")).toBe(false);
    expect(ja("【PSA8】 ポケモンカード ピカチュウ 初版 旧裏 マークなし")).toBe(false);
    expect(titleMatcher("psa 10", "all_words")!("Charizard PSA 100 slab")).toBe(false);
    expect(titleMatcher("pokemon", "all_words")!("Pokémon Dracaufeu")).toBe(true);
    expect(fold("Ｐｏｋéｍｏｎ　カード")).toBe("pokemon カード");
    // Dropping accents must not drop kana voicing: カード is not カート.
    expect(titleMatcher("カード", "all_words")!("ポケモンカート")).toBe(false);
  });

  it("filters a loose site by default and reports what it dropped, but not a strict one", async () => {
    const lbc = fixture("europe-a/leboncoin.html");
    const run = (title_match?: "any" | "phrase") =>
      testMcpy({ pages: [fakePages("direct", (req) => html(lbc, req.url))] }).mcpy.shopping({ marketplaces: ["leboncoin"], query: "pokemon carte", ...(title_match ? { title_match } : {}) });
    const loose = await run("any");
    const auto = await run();
    expect(loose.results.length).toBeGreaterThan(auto.results.length);
    for (const l of auto.results) expect(titleMatcher("pokemon carte", "all_words")!(l.title)).toBe(true);
    expect(auto.marketplaces[0]!.unmatched).toBe(loose.results.length - auto.results.length);
    // The site's own count includes rows that do not match: it is not stated then.
    expect(auto.marketplaces[0]!.total).toBeUndefined();
    expect(loose.marketplaces[0]!.unmatched).toBeUndefined();
  });
});
