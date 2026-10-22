/**
 * Search adapters across types and filters, against the documented
 * Bright Data parsed-SERP fields and Firecrawl v2 search fields.
 */

import { describe, expect, it } from "vitest";
import { Device, Recency, SearchType } from "mcpy";
import { brightDataSearch, firecrawlSearch, type SearchRequest } from "mcpy/providers";
import { googleUrl } from "../../src/providers/brightdata/serp.js";
import { stubFetch } from "../helpers.js";
import { json, providerCall } from "./call.js";

const req = (over: Partial<SearchRequest> = {}): SearchRequest => ({ query: "rust", type: SearchType.Web, limit: 10, page: 1, ...over });
const params = (url: string) => Object.fromEntries(new URL(url).searchParams);
const serp = () => brightDataSearch({ apiKey: "k", zone: "serp" });

describe("bright data: request mapping", () => {
  it.each([
    [SearchType.Web, {}],
    [SearchType.News, { tbm: "nws" }],
    [SearchType.Images, { udm: "2" }],
    [SearchType.Videos, { tbm: "vid" }],
    [SearchType.Shopping, { udm: "28" }],
    [SearchType.Jobs, { ibp: "htl;jobs" }],
    [SearchType.Places, { udm: "1" }],
  ])("%s uses the documented Google parameters", (type, extra) => {
    expect(params(googleUrl(req({ type }), 0))).toEqual({ q: "rust", ...extra, brd_json: "1" });
  });

  it("maps country, language, recency, device, sites and offsets", () => {
    const url = googleUrl(req({ country: "fr", language: "fr", recency: Recency.Week, device: Device.Mobile, sites: ["a.com", "b.org"] }), 20);
    expect(params(url)).toEqual({ q: "rust (site:a.com OR site:b.org)", gl: "fr", hl: "fr", tbs: "qdr:w", brd_mobile: "1", start: "20", brd_json: "1" });
    expect(params(googleUrl(req({ excludeSites: ["x.com", "y.com"] }), 0)).q).toBe("rust -site:x.com -site:y.com");
  });

  it("starts deeper pages at (page - 1) * limit", async () => {
    const { fetch, calls } = stubFetch(() => json({ general: {}, organic: [{ link: "https://a.example/" }] }));
    await serp().search(req({ page: 3, limit: 5 }), providerCall(fetch));
    expect(params((calls[0].body as { url: string }).url).start).toBe("10");
  });
});

describe("bright data: result mapping per type", () => {
  const run = async (type: SearchType, body: unknown) => {
    const { fetch } = stubFetch(() => json({ general: {}, ...(body as object) }));
    return serp().search(req({ type }), providerCall(fetch));
  };

  it("news: news[] plus top stories, with publisher and date", async () => {
    const hits = await run(SearchType.News, {
      news: [{ link: "https://n1.example/", title: "N1", source: "Daily", date: "2 hours ago", description: "d" }],
      top_stories: { items: [{ link: "https://n2.example/", title: "N2", source: "Weekly" }] },
    });
    expect(hits).toEqual([
      { url: "https://n1.example/", title: "N1", snippet: "d", publisher: "Daily", date: "2 hours ago", image: undefined },
      { url: "https://n2.example/", title: "N2", snippet: "", publisher: "Weekly", date: undefined, image: undefined },
    ]);
  });

  it("images prefer the original image", async () => {
    const [h] = await run(SearchType.Images, { images: [{ link: "https://p.example/", title: "Cat", image: "thumb.jpg", original_image: "full.jpg", source: "P" }] });
    expect(h).toMatchObject({ url: "https://p.example/", image: "full.jpg", publisher: "P" });
  });

  it("videos include short videos and durations", async () => {
    const hits = await run(SearchType.Videos, { videos: [{ link: "https://v.example/1", duration: "3:21" }], short_videos: [{ link: "https://v.example/2" }] });
    expect(hits.map((h) => h.duration)).toEqual(["3:21", undefined]);
  });

  it("shopping parses prices, ratings and review counts given as strings", async () => {
    const [h] = await run(SearchType.Shopping, { shopping: [{ link: "https://s.example/", title: "Kettle", price: "$29.99", shop: "Shop", rating: "4.5", reviews_cnt: "1,234" }] });
    expect(h).toMatchObject({ price: "$29.99", publisher: "Shop", rating: 4.5, reviews: 1234 });
  });

  it("jobs come from jobs.items with company and location", async () => {
    const [h] = await run(SearchType.Jobs, { jobs: { items: [{ link: "https://j.example/", title: "SRE", company: "Acme", location: "Remote" }] } });
    expect(h).toMatchObject({ title: "SRE", company: "Acme", location: "Remote" });
  });

  it("places use the snack pack and fall back to the maps link", async () => {
    const hits = await run(SearchType.Places, {
      snack_pack: [
        { name: "Cafe", maps_link: "https://maps.example/1", address: "1 Main St", phone: "555", rating: 4.2, reviews_cnt: 10 },
        { name: "No link at all" },
      ],
    });
    expect(hits).toEqual([expect.objectContaining({ url: "https://maps.example/1", title: "Cafe", address: "1 Main St", phone: "555", rating: 4.2, reviews: 10 })]);
  });

  it("drops malformed items without losing the rest", async () => {
    const hits = await run(SearchType.Web, { organic: [{ title: "no link" }, { link: "https://ok.example/", title: "OK" }, 42] });
    expect(hits.map((h) => h.url)).toEqual(["https://ok.example/"]);
  });
});

describe("firecrawl search", () => {
  const fc = () => firecrawlSearch({ apiKey: "k" });

  it("maps type, recency, country and site filters to v2 fields", async () => {
    const { fetch, calls } = stubFetch(() => json({ success: true, data: { news: [] } }));
    await fc().search(req({ type: SearchType.News, recency: Recency.Day, country: "de", sites: ["a.com"] }), providerCall(fetch));
    expect(calls[0].body).toMatchObject({ sources: [{ type: "news" }], tbs: "qdr:d", country: "DE", includeDomains: ["a.com"] });
  });

  it("reads deeper pages by asking for more and slicing", async () => {
    const web = Array.from({ length: 30 }, (_, i) => ({ url: `https://r${i}.example/` }));
    const { fetch, calls } = stubFetch(() => json({ success: true, data: { web } }));
    const hits = await fc().search(req({ page: 3, limit: 10 }), providerCall(fetch));
    expect((calls[0].body as { limit: number }).limit).toBe(30);
    expect(hits.map((h) => h.url)).toEqual(web.slice(20, 30).map((w) => w.url));
  });

  it("maps news and image fields", async () => {
    const { fetch } = stubFetch(() =>
      json({ success: true, data: { images: [{ url: "https://i.example/", title: "I", imageUrl: "https://i.example/full.png" }] } }),
    );
    const [h] = await fc().search(req({ type: SearchType.Images }), providerCall(fetch));
    expect(h).toMatchObject({ url: "https://i.example/", image: "https://i.example/full.png" });
  });
});
