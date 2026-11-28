/**
 * 2026-11-22, building shopping_search: Cardmarket timed out through every
 * source because the chrome agent was forwarded to Firecrawl, whose own
 * fingerprinted browser it no longer matched (timeout past 20 s; 13 s and
 * HTTP 200 without it). Never delete these.
 */

import { describe, expect, it } from "vitest";
import { PageFormat, UserAgentProfile } from "mcpy";
import { firecrawl } from "mcpy/providers";
import { fixtureJson, stubFetch } from "../helpers.js";
import { json, providerCall } from "../contract/call.js";

const scrape = () => fixtureJson("firecrawl-scrape.json");
const req = (userAgent: UserAgentProfile) => ({ url: "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=charizard", format: PageFormat.Html, userAgent });

describe("shopping source regressions", () => {
  it("does not forward a desktop browser agent to Firecrawl", async () => {
    for (const profile of [UserAgentProfile.Chrome, UserAgentProfile.Safari, UserAgentProfile.Firefox, UserAgentProfile.Default]) {
      const { fetch, calls } = stubFetch(() => json(scrape()));
      await firecrawl({ apiKey: "k" }).fetchPage(req(profile), providerCall(fetch));
      expect(calls[0]!.body, profile).not.toHaveProperty("headers");
      expect(calls[0]!.body, profile).not.toHaveProperty("mobile");
    }
  });

  it("asks Firecrawl for its own mobile emulation instead of a mobile agent string", async () => {
    const { fetch, calls } = stubFetch(() => json(scrape()));
    await firecrawl({ apiKey: "k" }).fetchPage(req(UserAgentProfile.Mobile), providerCall(fetch));
    expect(calls[0]!.body).toMatchObject({ mobile: true });
    expect(calls[0]!.body).not.toHaveProperty("headers");
  });
});

describe("render country", () => {
  it("asks Firecrawl to browse from the site's country, and keys the cache on it (Mercari showed US$ from a US exit, 2026-11-22)", async () => {
    const { fetch, calls } = stubFetch(() => json(scrape()));
    await firecrawl({ apiKey: "k" }).fetchPage({ ...req(UserAgentProfile.Chrome), render: true, country: "jp" }, providerCall(fetch));
    expect(calls[0]!.body).toMatchObject({ location: { country: "JP" } });
    const { pageCacheId } = await import("../../src/engine/page-request.js");
    const plain = { url: "https://jp.mercari.com/search?keyword=x", format: PageFormat.Html, userAgent: UserAgentProfile.Chrome };
    expect(await pageCacheId({ ...plain, country: "jp" })).not.toBe(await pageCacheId(plain));
  });
});

describe("bot walls the engine escalates past", () => {
  it("treats AWS WAF, ShieldSquare and localized Cloudflare pages as challenges (Jofogas, Njuskalo, Locanto, 2026-11-22)", async () => {
    const { isChallenge } = await import("../../src/engine/quality.js");
    const { page } = await import("../helpers.js");
    expect(isChallenge(page({ status: 202, title: "", content: '<script>window.awsWafCookieDomainList = [];window.gokuProps = {};</script><script src="https://x.token.awswaf.com/challenge.js"></script>' }))).toBe(true);
    expect(isChallenge(page({ title: "ShieldSquare Captcha", content: "<html>...</html>" }))).toBe(true);
    expect(isChallenge(page({ title: "", content: '<form action="https://validate.perfdrive.com/captcha">' }))).toBe(true);
    expect(isChallenge(page({ title: "Einen Moment bitte…", content: "<html></html>" }))).toBe(true);
    expect(isChallenge(page({ title: "One moment, please...", content: "<html></html>" }))).toBe(true);
    // An ordinary page that mentions a bot wall is not one.
    expect(isChallenge(page({ title: "How ShieldSquare works", content: "x".repeat(40_000) + " shieldsquare " }))).toBe(false);
  });
});

describe("store reader regressions", () => {
  it("reads Jofogas' real no-results page as empty: it has no adList.ads key at all (read as redesigned, 2026-11-22)", async () => {
    const { jofogas } = await import("../../src/sites/europe/b/jofogas.js");
    const { fixture, listings } = await import("../shopping/site-harness.js");
    const content = fixture("europe-b/jofogas-empty.html");
    expect(content).not.toContain('"ads"');
    expect(listings(jofogas, content).outcome.kind).toBe("empty");
  });
});

describe("login walls", () => {
  it("treats a redirect to a verification or captcha path as a challenge (MercadoLibre, 2026-11-22)", async () => {
    const { isChallenge } = await import("../../src/engine/quality.js");
    const { page } = await import("../helpers.js");
    const asked = "https://lista.mercadolivre.com.br/charizard";
    expect(isChallenge(page({ url: asked, finalUrl: "https://www.mercadolivre.com.br/gz/account-verification?go=x", title: "Mercado Livre", content: "x".repeat(50_000) }))).toBe(true);
    expect(isChallenge(page({ url: asked, finalUrl: "https://lista.mercadolivre.com.br/captcha/wall", title: "", content: "x" }))).toBe(true);
    // A page that is itself at such a path, or an ordinary redirect, is not a wall.
    expect(isChallenge(page({ url: "https://example.com/captcha/", finalUrl: "https://example.com/captcha/", title: "Captcha docs", content: "x".repeat(50_000) }))).toBe(false);
    expect(isChallenge(page({ url: asked, finalUrl: "https://lista.mercadolivre.com.br/charizard_NoIndex_True", title: "Charizard", content: "x".repeat(50_000) }))).toBe(false);
  });
});

describe("Reblaze", () => {
  it("escalates past Gumtree's HTTP 247 bot check instead of taking it as a page (2026-11-22)", async () => {
    const { assessPage } = await import("../../src/engine/quality.js");
    const { page } = await import("../helpers.js");
    expect(assessPage(page({ status: 247, title: "Gumtree", content: "x".repeat(5_000) })).outcome).toBe("escalate");
    expect(assessPage(page({ status: 200, title: "", content: '<script src="/rbzns/challenge.js"></script>' })).outcome).toBe("escalate");
  });
});

describe("cursor paging", () => {
  it("carries a site's long signed page token through next_cursor (Wallapop's ~930 chars were refused, 2026-11-22)", async () => {
    const { fakePages, page, testMcpy } = await import("../helpers.js");
    const { fixture } = await import("../shopping/site-harness.js");
    const body = fixture("europe-c/wallapop.json");
    const pages = Object.assign(
      fakePages("direct", (r) => page({ url: r.url, finalUrl: r.url, content: body, contentType: "application/json", format: PageFormat.Html })),
      { capabilities: { headers: true } },
    );
    const { mcpy } = testMcpy({ pages: [pages] });
    const first = await mcpy.shopping({ marketplaces: ["wallapop", "yahoo_auctions"], query: "pokemon" });
    expect(first.next_cursor).toBeDefined();
    await mcpy.shopping({ marketplaces: ["wallapop", "yahoo_auctions"], query: "pokemon", cursor: first.next_cursor });
    const token = (JSON.parse(body) as { meta: { next_page: string } }).meta.next_page;
    expect(token.length).toBeGreaterThan(800);
    expect(pages.calls.some((c) => c.url.includes(`next_page=${encodeURIComponent(token)}`) || c.url.includes(`next_page=${token}`))).toBe(true);
  });
});

describe("site POST requests", () => {
  it("send a JSON body as JSON, like web_fetch (TCGplayer's API answered 415 without it, 2026-11-22)", async () => {
    const { pageRequest } = await import("../../src/services/shopping/fetch-site.js");
    const { HttpMethod } = await import("mcpy");
    expect(pageRequest({ url: "https://mp-search-api.tcgplayer.com/v1/search/request", method: HttpMethod.Post, body: '{"size":24}' }).headers).toEqual({ "Content-Type": "application/json" });
    expect(pageRequest({ url: "https://example.com/api", method: HttpMethod.Post, body: "{}", headers: { "content-type": "text/plain" } }).headers).toEqual({ "content-type": "text/plain" });
    expect(pageRequest({ url: "https://example.com/" }).headers).toBeUndefined();
  });
});

describe("amounts", () => {
  it("read the first number only: shipping text joined every digit into one (review, 2026-11-22)", async () => {
    const { amount } = await import("../../src/sites/readers/values.js");
    const cases: [string, number | undefined][] = [
      ["+$22.10 delivery in 2-4 days", 22.1], ["4.250,00 €", 4250], ["4,250.00", 4250], ["1.234", 1234], ["¥23,000", 23000],
      ["20 – 45 €", 20], ["1 299 kr", 1299], ["CHF 1'250.50", 1250.5], ["12 000 Ft", 12000], ["49,99 €", 49.99],
      ["no price", undefined], ["3 450 000 ₩", 3450000], ["$5.00 to $9.00", 5],
    ];
    for (const [text, want] of cases) expect(amount(text), text).toBe(want);
  });
});
