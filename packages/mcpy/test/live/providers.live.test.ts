/**
 * Real provider APIs, one provider at a time, through the public SDK.
 * Keys come from apps/server/.dev.vars (or the environment); each suite is
 * skipped when its credentials are missing. Costs a few provider credits.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CacheStatus, createMcpy, MemoryCache, PageFormat, Recency, SearchType } from "mcpy";
import { brightData, brightDataSearch, cloudflareBrowser, direct, firecrawl, firecrawlSearch } from "mcpy/providers";

const TARGET = "https://elie.net/";
const DEV_VARS = new URL("../../../../apps/server/.dev.vars", import.meta.url);

function loadKeys(): Record<string, string> {
  const fromFile = existsSync(DEV_VARS)
    ? Object.fromEntries(
        readFileSync(DEV_VARS, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#") && l.includes("="))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      )
    : {};
  return { ...fromFile, ...(process.env as Record<string, string>) };
}

const k = loadKeys();
const has = (...names: string[]) => names.every((n) => !!k[n]);

function sdk(options: Parameters<typeof createMcpy>[0]) {
  return createMcpy({ cache: new MemoryCache(), ...options });
}

async function expectRealPage(mcpy: ReturnType<typeof createMcpy>) {
  const result = await mcpy.fetch({ url: TARGET, max_chars: 5_000, fresh: true });
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
    const result = await sdk({ pages: [firecrawl(opts())] }).grep({ url: TARGET, pattern: "elie", fresh: true });
    expect(result.matches).toBeGreaterThan(0);
  });

  it("searches", async () => {
    const result = await sdk({ search: [firecrawlSearch(opts())] }).search({ query: "Elie Bursztein", max_results: 3, fresh: true });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].url).toMatch(/^https?:\/\//);
  });
});

describe.skipIf(!has("FIRECRAWL_API_KEY"))("firecrawl search options (live)", () => {
  const search = () => sdk({ search: [firecrawlSearch({ apiKey: k.FIRECRAWL_API_KEY })] });

  it("searches news from the past week", async () => {
    const result = await search().search({ query: "Cloudflare", type: SearchType.News, recency: Recency.Week, max_results: 3, fresh: true });
    expect(result.type).toBe(SearchType.News);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("restricts results to the given sites", async () => {
    const result = await search().search({ query: "workers", sites: ["developers.cloudflare.com"], max_results: 5, fresh: true });
    expect(result.results.length).toBeGreaterThan(0);
    for (const hit of result.results) expect(new URL(hit.url).hostname).toBe("developers.cloudflare.com");
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
      fresh: true,
    });
    expect(result.results.length).toBeGreaterThan(0);
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
    const result = await mcpy.fetch({ url: TARGET, max_chars: 1_000, fresh: true });
    expect(result.status).toBe(200);
    expect(result.meta.attempts).toBe(2);
  });
});
