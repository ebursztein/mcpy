import { describe, expect, it } from "vitest";
import { ErrorCode } from "mcpy";
import { ProviderId, serpentSearch, SERPENT_DEFAULT_USD_PER_CALL } from "mcpy/providers";
import { fixtureJson, stubFetch } from "../helpers.js";
import { failureOf, json, providerCall } from "./call.js";

const KEY = "sk_live_test";
const provider = () => serpentSearch({ apiKey: KEY });
const sent = (url: string) => new URL(url).searchParams;

describe("serpent search contract", () => {
  it("identifies itself and bills one flat call", () => {
    expect(provider().id).toBe(ProviderId.Serpent);
    expect(provider().costPerCall).toBe(SERPENT_DEFAULT_USD_PER_CALL);
  });

  it("GETs standard search with the key in a header, never in the URL", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("serpent-live-web.json")));
    await provider().search({ query: "charizard base set psa 10 price", type: "web", limit: 10, page: 1, country: "GB", language: "en-GB" }, providerCall(fetch));
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url.startsWith("https://apiserpent.com/api/search/quick?")).toBe(true);
    expect(calls[0].headers.get("x-api-key")).toBe(KEY);
    expect(calls[0].url).not.toContain(KEY);
    const p = sent(calls[0].url);
    expect(Object.fromEntries(p)).toMatchObject({ q: "charizard base set psa 10 price", num: "10", country: "gb", language: "en", timeout: "20" });
  });

  it("reads organic rows with their real publisher URLs", async () => {
    const { fetch } = stubFetch(() => json(fixtureJson("serpent-live-web.json")));
    const hits = await provider().search({ query: "x", type: "web", limit: 10, page: 1 }, providerCall(fetch));
    expect(hits).toHaveLength(10);
    expect(hits[0]).toMatchObject({ url: "https://www.pricecharting.com/game/pokemon-base-set/charizard-4", title: "Charizard #4 Pokemon Base Set - PriceCharting" });
    expect(hits[0]!.snippet).toMatch(/^Charizard #4/);
    for (const h of hits) expect(h.url).toMatch(/^https:\/\/(?!www\.google\.)/);
  });

  it("pages by asking for page * limit rows and keeping the last limit", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("serpent-live-web.json")));
    const hits = await provider().search({ query: "x", type: "web", limit: 4, page: 2 }, providerCall(fetch));
    expect(sent(calls[0].url).get("num")).toBe("8");
    expect(hits.map((h) => h.url)).toHaveLength(4);
    expect(hits[0]!.url).toContain("kantoshark.com");
  });

  it("puts site filters in the query and maps recency to freshness", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("serpent-live-web.json")));
    await provider().search({ query: "charizard", type: "web", limit: 5, page: 1, sites: ["ebay.com", "tcgplayer.com"], excludeSites: ["reddit.com"], recency: "week" }, providerCall(fetch));
    const p = sent(calls[0].url);
    expect(p.get("q")).toBe("charizard (site:ebay.com OR site:tcgplayer.com) -site:reddit.com");
    expect(p.get("freshness")).toBe("7d");
  });

  it("asks Bing for news, whose rows link to the publisher rather than a Google News redirect", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("serpent-live-news.json")));
    const hits = await provider().search({ query: "pokemon tcg", type: "news", limit: 5, page: 1, recency: "day" }, providerCall(fetch));
    expect(calls[0].url.startsWith("https://apiserpent.com/api/news?")).toBe(true);
    expect(Object.fromEntries(sent(calls[0].url))).toMatchObject({ engine: "bing", freshness: "d" });
    expect(hits[0]).toMatchObject({ publisher: "Mashable", date: "2026-11-21" });
    expect(hits[0]!.url).toMatch(/^https:\/\/mashable\.com\//);
  });

  it("caps news at 50 rows per call", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("serpent-live-news.json")));
    await provider().search({ query: "x", type: "news", limit: 20, page: 4 }, providerCall(fetch));
    expect(sent(calls[0].url).get("num")).toBe("50");
  });

  it("reads images as the page they sit on, with the original image", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("serpent-live-images.json")));
    const hits = await provider().search({ query: "charizard", type: "images", limit: 5, page: 1 }, providerCall(fetch));
    expect(calls[0].url.startsWith("https://apiserpent.com/api/images?")).toBe(true);
    expect(hits[0]).toMatchObject({
      url: "https://www.pokellector.com/card/Charizard-Base-Set-BS-4",
      image: "https://den-cards.pokellector.com/119/Charizard.BS.4.png",
      publisher: "www.pokellector.com",
    });
  });

  it("filters images by date on Yahoo, and refuses an hour window rather than widening it", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("serpent-live-images.json")));
    await provider().search({ query: "x", type: "images", limit: 5, page: 1, recency: "month" }, providerCall(fetch));
    expect(Object.fromEntries(sent(calls[0].url))).toMatchObject({ engine: "yahoo", time: "month" });
    expect(sent(calls[0].url).has("freshness")).toBe(false);
    const failure = await failureOf(provider().search({ query: "x", type: "images", limit: 5, page: 1, recency: "hour" }, providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.InvalidInput);
    expect(calls).toHaveLength(1);
  });

  it("drops rows without a web URL and keeps the rest", async () => {
    const body = { success: true, results: { organic: [{ url: null, title: "a" }, { url: "javascript:x", title: "b" }, { url: "https://example.com/", title: null, snippet: null }] } };
    const { fetch } = stubFetch(() => json(body));
    expect(await provider().search({ query: "x", type: "web", limit: 10, page: 1 }, providerCall(fetch))).toEqual([
      { url: "https://example.com/", title: "https://example.com/", snippet: "", date: undefined, publisher: undefined },
    ]);
  });

  it("returns no rows for a search that found nothing", async () => {
    const { fetch } = stubFetch(() => json({ success: true, results: { organic: [] }, delivery: { requested: 10, returned: 0, note: "no results" } }));
    expect(await provider().search({ query: "x", type: "web", limit: 10, page: 1 }, providerCall(fetch))).toEqual([]);
  });

  it("reports out of credits as a 402 failure carrying Serpent's code", async () => {
    const body = { success: false, error: "Payment Required", code: "insufficient_credits", message: "No credits and no free calls left.", credits: 0, costPerSearch: 0.0006 };
    const { fetch } = stubFetch(() => json(body, 402));
    const failure = await failureOf(provider().search({ query: "x", type: "web", limit: 10, page: 1 }, providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.UpstreamFailed);
    expect(failure.status).toBe(402);
    expect(failure.message).toMatch(/^insufficient_credits: /);
  });

  it("treats a success without results as a bad response, not an empty search", async () => {
    const { fetch } = stubFetch(() => json({ success: true }));
    const failure = await failureOf(provider().search({ query: "x", type: "web", limit: 10, page: 1 }, providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.BadResponse);
  });

  it("refuses search types it has no endpoint for without calling out", async () => {
    const { fetch, calls } = stubFetch(() => json({ success: true }));
    const failure = await failureOf(provider().search({ query: "x", type: "jobs", limit: 10, page: 1 }, providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.InvalidInput);
    expect(calls).toHaveLength(0);
  });
});
