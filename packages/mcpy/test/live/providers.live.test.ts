/**
 * Real provider APIs, one provider at a time, through the public SDK.
 * Keys come from apps/server/.dev.vars (or the environment); each suite is
 * skipped when its credentials are missing. Costs a few provider credits.
 */

import { describe, expect, it } from "vitest";
import { CacheStatus, createMcpy, LayeredCache, PageFormat, PaperCollection, PaperSort, Recency, SearchType } from "mcpy";
import { has, k } from "./keys.js";
import { arxiv, brightData, brightDataSearch, cloudflareBrowser, direct, firecrawl, firecrawlSearch, mempool, openAlex, pubmed, serpentSearch } from "mcpy/providers";

const TARGET = "https://elie.net/";
function sdk(options: Parameters<typeof createMcpy>[0]) {
  return createMcpy({ cache: new LayeredCache(), ...options });
}

async function expectRealPage(mcpy: ReturnType<typeof createMcpy>) {
  const result = await mcpy.fetch({ url: TARGET, max_chars: 5_000, max_age: 0 });
  expect(result.status).toBe(200);
  expect(result.total_chars).toBeGreaterThan(500);
  expect(result.content).toMatch(/elie/i);
  expect(result.meta.cache).toBe(CacheStatus.Bypass);
  return result;
}

describe("direct (live)", () => {
  it("fetches the target as markdown and html", async () => {
    const mcpy = sdk({ pages: [direct()] });
    const md = await expectRealPage(mcpy);
    expect(md.title).toBeTruthy();
    const html = await mcpy.fetch({ url: TARGET, format: PageFormat.Html, max_chars: 2_000 });
    expect(html.content).toMatch(/<html|<!doctype/i);
  });
});

describe.skipIf(!has("FIRECRAWL_API_KEY"))("firecrawl (live)", () => {
  const opts = () => ({ apiKey: k.FIRECRAWL_API_KEY, apiUrl: k.FIRECRAWL_API_URL || undefined });

  it("scrapes the target", async () => {
    await expectRealPage(sdk({ pages: [firecrawl(opts())] }));
  });

  it("greps the target", async () => {
    const result = await sdk({ pages: [firecrawl(opts())] }).grep({ url: TARGET, pattern: "elie", max_age: 0 });
    expect(result.matches).toBeGreaterThan(0);
  });

  it("searches", async () => {
    const result = await sdk({ search: [firecrawlSearch(opts())] }).search({ query: "Elie Bursztein", max_results: 3, max_age: 0 });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].url).toMatch(/^https?:\/\//);
  });
});

describe.skipIf(!has("FIRECRAWL_API_KEY"))("firecrawl search options (live)", () => {
  const search = () => sdk({ search: [firecrawlSearch({ apiKey: k.FIRECRAWL_API_KEY })] });

  it("searches news from the past week", async () => {
    const result = await search().search({ query: "Cloudflare", type: SearchType.News, recency: Recency.Week, max_results: 3, max_age: 0 });
    expect(result.type).toBe(SearchType.News);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("restricts results to the given sites", async () => {
    const result = await search().search({ query: "workers", sites: ["developers.cloudflare.com"], max_results: 5, max_age: 0 });
    expect(result.results.length).toBeGreaterThan(0);
    for (const hit of result.results) expect(new URL(hit.url).hostname).toBe("developers.cloudflare.com");
  });
});

describe("paper indexes (live, no keys needed)", () => {
  it("openalex finds the DDPM paper by citations within a year range", async () => {
    const r = await sdk({ papers: [openAlex({ apiKey: k.OPENALEX_API_KEY || undefined })] }).papers({
      query: "denoising diffusion probabilistic models",
      sort: PaperSort.Citations,
      year_from: 2020,
      year_to: 2020,
      max_results: 5,
      max_age: 0,
    });
    expect(r.results.some((p) => /denoising diffusion probabilistic models/i.test(p.title))).toBe(true);
    for (const p of r.results) expect(p.year).toBe(2020);
  });

  it("pubmed finds open-access biomedical papers with abstracts, never future-dated", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const mcpy = sdk({ papers: [pubmed({ apiKey: k.NCBI_API_KEY || undefined })] });
    const relevant = await mcpy.papers({ query: "glp-1 receptor agonist weight loss", collection: PaperCollection.Biomedical, open_access: true, max_results: 3, max_age: 0 });
    expect(relevant.results.length).toBeGreaterThan(0);
    expect(relevant.results.some((p) => (p.abstract ?? "").length > 100)).toBe(true);
    const newest = await mcpy.papers({ query: "crispr base editing", collection: PaperCollection.Biomedical, sort: PaperSort.Newest, max_results: 5, max_age: 0 });
    for (const p of newest.results) expect(p.published! <= today).toBe(true);
  });

  it("arxiv returns the newest preprints with PDFs", async () => {
    const r = await sdk({ papers: [arxiv()], limits: { attemptTimeoutMs: 100_000, deadlineMs: 110_000 } }).papers({ query: "large language model agents", sort: PaperSort.Newest, max_results: 3, max_age: 0 });
    expect(r.results.length).toBeGreaterThan(0);
    for (const p of r.results) expect(p.pdf_url).toMatch(/^https:\/\/arxiv\.org\/pdf\//);
  });
});

describe("retarget history (live, no keys needed)", () => {
  it("gives BTC's and LTC's last 30 complete days their difficulty at the last block", async () => {
    const mcpy = createMcpy({ cache: new LayeredCache(), crypto: [mempool()] });
    const to = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    // One coin a call: 30 days each, under the 40 rows a call.
    for (const [symbol, floor] of [["BTC", 1e13], ["LTC", 1e7]] as const) {
      const [coin] = (await mcpy.cryptoCoin({ symbols: [symbol], from, to })).coins;
      expect(coin.days).toHaveLength(30);
      for (const day of coin.days) expect(day.difficulty).toBeGreaterThan(floor);
    }
  });
});

describe.skipIf(!has("BRIGHTDATA_API_KEY", "BRIGHTDATA_UNLOCKER_ZONE"))("bright data unlocker (live)", () => {
  it("unlocks the target", async () => {
    await expectRealPage(sdk({ pages: [brightData({ apiKey: k.BRIGHTDATA_API_KEY, zone: k.BRIGHTDATA_UNLOCKER_ZONE })] }));
  });
});

describe.skipIf(!has("BRIGHTDATA_API_KEY", "BRIGHTDATA_SERP_ZONE"))("bright data SERP (live)", () => {
  it("searches", async () => {
    const result = await sdk({ search: [brightDataSearch({ apiKey: k.BRIGHTDATA_API_KEY, zone: k.BRIGHTDATA_SERP_ZONE })] }).search({
      query: "Elie Bursztein",
      max_results: 3,
      max_age: 0,
    });
    expect(result.results.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!has("SERPENT_API_KEY"))("serpent (live)", () => {
  const search = () => sdk({ search: [serpentSearch({ apiKey: k.SERPENT_API_KEY })] });

  it("searches the web with real publisher links", async () => {
    const result = await search().search({ query: "Elie Bursztein", max_results: 5, max_age: 0 });
    expect(result.results.length).toBeGreaterThan(0);
    for (const hit of result.results) expect(hit.url).toMatch(/^https:\/\/(?!www\.google\.)/);
  });

  it("restricts results to the given sites", async () => {
    const result = await search().search({ query: "workers", sites: ["developers.cloudflare.com"], max_results: 5, max_age: 0 });
    expect(result.results.length).toBeGreaterThan(0);
    for (const hit of result.results) expect(new URL(hit.url).hostname).toBe("developers.cloudflare.com");
  });

  it("searches news from the past week, linking to publishers", async () => {
    const result = await search().search({ query: "Cloudflare", type: SearchType.News, recency: Recency.Week, max_results: 3, max_age: 0 });
    expect(result.results.length).toBeGreaterThan(0);
    for (const hit of result.results) expect(new URL(hit.url).hostname).not.toBe("news.google.com");
  });
});

describe.skipIf(!has("CF_ACCOUNT_ID", "CF_BROWSER_API_TOKEN"))("cloudflare browser run (live)", () => {
  it("renders the target", async () => {
    await expectRealPage(sdk({ pages: [cloudflareBrowser({ accountId: k.CF_ACCOUNT_ID, apiToken: k.CF_BROWSER_API_TOKEN })] }));
  });
});

describe.skipIf(!has("FIRECRAWL_API_KEY"))("fallback chain (live)", () => {
  it("falls back to a working provider when the first one fails", async () => {
    // A provider pointed at a dead endpoint fails fast; the chain must recover.
    const broken = firecrawl({ apiKey: "invalid", apiUrl: "https://127.0.0.1:9" });
    const mcpy = sdk({ pages: [broken, firecrawl({ apiKey: k.FIRECRAWL_API_KEY })], retry: { retries: 0 } });
    const result = await mcpy.fetch({ url: TARGET, max_chars: 1_000, max_age: 0 });
    expect(result.status).toBe(200);
    expect(result.meta.attempts).toBe(2);
  });
});
