/**
 * Bright Data SERP against responses captured live on 2026-10-22 (trimmed,
 * base64 thumbnails replaced by a stub). Each test pins a behavior that the
 * documentation alone got wrong. Never delete one.
 */

import { describe, expect, it } from "vitest";
import { ErrorCode, SearchType } from "mcpy";
import { brightData, brightDataSearch, type SearchRequest } from "mcpy/providers";
import { BRIGHTDATA_SEARCH_CAPABILITIES } from "../../src/providers/brightdata/serp.js";
import { fixture, stubFetch } from "../helpers.js";
import { failureOf, providerCall } from "../contract/call.js";

const req = (type: SearchType, over: Partial<SearchRequest> = {}): SearchRequest => ({ query: "q", type, limit: 3, page: 1, ...over });
const serp = () => brightDataSearch({ apiKey: "k", zone: "mcpy_serp" });
const live = (name: string) => () => new Response(fixture(`brightdata-live-${name}.json`), { headers: { "content-type": "application/json" } });

describe("request form", () => {
  it("asks for parsed JSON in the envelope (format raw + brd_json returned an empty body live)", async () => {
    const { fetch, calls } = stubFetch(live("web"));
    await serp().search(req(SearchType.Web), providerCall(fetch));
    const body = calls[0].body as Record<string, string>;
    expect(body).toMatchObject({ zone: "mcpy_serp", format: "json", data_format: "parsed" });
    expect(new URL(body.url).searchParams.has("brd_json")).toBe(false);
  });

  it("defaults to US English when the caller sets no country (live default was Mexico)", async () => {
    const { fetch, calls } = stubFetch(live("web"));
    await serp().search(req(SearchType.Web), providerCall(fetch));
    const google = new URL((calls[0].body as { url: string }).url);
    expect([google.searchParams.get("gl"), google.searchParams.get("hl")]).toEqual(["us", "en"]);
  });

  it("fetches the pages it needs in parallel", async () => {
    const { fetch, calls } = stubFetch(live("web"));
    await serp().search(req(SearchType.Web, { limit: 25 }), providerCall(fetch));
    const starts = calls.map((c) => new URL((c.body as { url: string }).url).searchParams.get("start"));
    expect(starts).toEqual([null, "10", "20"]);
  });
});

describe("mapping real responses", () => {
  it("web: organic results, Google's 'Read more' stripped, inline base64 images dropped", async () => {
    const { fetch } = stubFetch(live("web"));
    const hits = await serp().search(req(SearchType.Web), providerCall(fetch));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.url).toMatch(/^https:\/\//);
      expect(h.snippet).not.toMatch(/Read more$/);
      expect(h.image ?? "").not.toMatch(/^data:/);
    }
  });

  it("images: title from the page, publisher from the site, image from original_image", async () => {
    const { fetch } = stubFetch(live("images"));
    const [h] = await serp().search(req(SearchType.Images), providerCall(fetch));
    expect(h).toMatchObject({ title: "Golden Gate Bridge - Wikipedia", publisher: "Wikipedia" });
    expect(h.image).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
  });

  it("videos: direct links from organic, breadcrumb publisher cleaned, duration kept", async () => {
    const { fetch } = stubFetch(live("videos"));
    const [h] = await serp().search(req(SearchType.Videos), providerCall(fetch));
    expect(h.url).toMatch(/^https:\/\/www\.youtube\.com\/watch/);
    expect(h).toMatchObject({ publisher: "www.youtube.com", duration: "19:48" });
  });

  it("shopping: price, shop, and ratings sent as strings parsed to numbers", async () => {
    const { fetch } = stubFetch(live("shopping"));
    const [h] = await serp().search(req(SearchType.Shopping), providerCall(fetch));
    expect(h.price).toMatch(/^\$\d/);
    expect(typeof h.rating).toBe("number");
    expect(typeof h.reviews).toBe("number");
    expect(h.publisher).toBeTruthy();
  });

  it("places: no link in the SERP, so a Google Maps link is built from the place id", async () => {
    const { fetch } = stubFetch(live("web")); // the web SERP carries a snack pack
    const hits = await serp().search(req(SearchType.Places), providerCall(fetch));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].url).toMatch(/^https:\/\/maps\.google\.com\/\?cid=/);
    expect(typeof hits[0].rating).toBe("number");
  });
});

describe("failures seen live", () => {
  it("treats a relayed 502 with an empty body as an upstream failure, retried once", async () => {
    const { fetch, calls } = stubFetch(live("jobs-502"));
    const failure = await failureOf(serp().search(req(SearchType.Web), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.UpstreamFailed);
    expect(calls).toHaveLength(2);
  });

  it("does not offer jobs search until Google Jobs works through the SERP API", () => {
    expect(BRIGHTDATA_SEARCH_CAPABILITIES.types).not.toContain(SearchType.Jobs);
  });

  it("declares longer attempt budgets for slow Bright Data calls (2-50 s measured)", () => {
    expect(serp().attemptTimeoutMs).toBeGreaterThanOrEqual(45_000);
    expect(brightData({ apiKey: "k", zone: "z" }).attemptTimeoutMs).toBeGreaterThanOrEqual(45_000);
  });
});

