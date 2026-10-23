import { ProviderId } from "mcpy/providers";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/env.js";
import { buildProviders, SkipReason } from "../../src/providers.js";

const FIRECRAWL = { FIRECRAWL_API_KEY: "fc-test" };
const BRIGHTDATA = { BRIGHTDATA_API_KEY: "bd-test", BRIGHTDATA_UNLOCKER_ZONE: "unlocker", BRIGHTDATA_SERP_ZONE: "serp" };
const CLOUDFLARE = { CF_ACCOUNT_ID: "acct", CF_BROWSER_API_TOKEN: "cf-test" };

const ids = (list: { id: string }[]) => list.map((p) => p.id);

describe("buildProviders", () => {
  it("enables only direct when no credentials are set", () => {
    const setup = buildProviders(loadEnv({}));
    expect(ids(setup.pages)).toEqual([ProviderId.Direct]);
    expect(setup.search).toEqual([]);
    expect(setup.skipped.pages).toEqual([
      { id: ProviderId.CloudflareBrowser, reason: SkipReason.MissingCredentials },
      { id: ProviderId.Firecrawl, reason: SkipReason.MissingCredentials },
      { id: ProviderId.BrightData, reason: SkipReason.MissingCredentials },
    ]);
    expect(setup.skipped.search).toEqual([
      { id: ProviderId.Firecrawl, reason: SkipReason.MissingCredentials },
      { id: ProviderId.BrightData, reason: SkipReason.MissingCredentials },
    ]);
  });

  it("enables every provider with credentials, in the default order", () => {
    const setup = buildProviders(loadEnv({ ...FIRECRAWL, ...BRIGHTDATA, ...CLOUDFLARE }));
    expect(ids(setup.pages)).toEqual([ProviderId.Direct, ProviderId.CloudflareBrowser, ProviderId.Firecrawl, ProviderId.BrightData]);
    expect(ids(setup.search)).toEqual([ProviderId.Firecrawl, ProviderId.BrightData]);
    expect(ids(setup.papers)).toEqual([ProviderId.OpenAlex, ProviderId.Arxiv]);
    // Semantic Scholar needs a key; OpenAlex and arXiv work without one.
    expect(setup.skipped).toEqual({ pages: [], search: [], papers: [{ id: ProviderId.SemanticScholar, reason: "missing_credentials" }] });
  });

  it("follows the configured order", () => {
    const setup = buildProviders(
      loadEnv({ ...FIRECRAWL, ...BRIGHTDATA, PAGE_PROVIDERS: "brightdata,firecrawl,direct", SEARCH_PROVIDERS: "brightdata,firecrawl" }),
    );
    expect(ids(setup.pages)).toEqual([ProviderId.BrightData, ProviderId.Firecrawl, ProviderId.Direct]);
    expect(ids(setup.search)).toEqual([ProviderId.BrightData, ProviderId.Firecrawl]);
  });

  it("leaves out providers that are not listed", () => {
    const setup = buildProviders(loadEnv({ ...FIRECRAWL, PAGE_PROVIDERS: "direct" }));
    expect(ids(setup.pages)).toEqual([ProviderId.Direct]);
    expect(setup.skipped.pages).toEqual([]);
  });

  it("needs every credential a provider uses", () => {
    const setup = buildProviders(
      loadEnv({
        CF_ACCOUNT_ID: "acct", // no token
        BRIGHTDATA_API_KEY: "bd-test", // no zones
        PAGE_PROVIDERS: "cloudflare_browser,brightdata",
        SEARCH_PROVIDERS: "brightdata",
      }),
    );
    expect(setup.pages).toEqual([]);
    expect(setup.skipped.pages.map((s) => s.reason)).toEqual([SkipReason.MissingCredentials, SkipReason.MissingCredentials]);
    expect(setup.skipped.search).toEqual([{ id: ProviderId.BrightData, reason: SkipReason.MissingCredentials }]);
  });

  it("uses the Bright Data zone that matches the operation", () => {
    const pagesOnly = buildProviders(loadEnv({ BRIGHTDATA_API_KEY: "bd", BRIGHTDATA_UNLOCKER_ZONE: "u", SEARCH_PROVIDERS: "brightdata" }));
    expect(ids(pagesOnly.pages)).toContain(ProviderId.BrightData);
    expect(pagesOnly.search).toEqual([]);
    const searchOnly = buildProviders(loadEnv({ BRIGHTDATA_API_KEY: "bd", BRIGHTDATA_SERP_ZONE: "s", SEARCH_PROVIDERS: "brightdata" }));
    expect(ids(searchOnly.pages)).not.toContain(ProviderId.BrightData);
    expect(ids(searchOnly.search)).toEqual([ProviderId.BrightData]);
  });

  it("reports direct and cloudflare_browser in SEARCH_PROVIDERS as not supported", () => {
    const setup = buildProviders(loadEnv({ ...FIRECRAWL, ...CLOUDFLARE, SEARCH_PROVIDERS: "direct,cloudflare_browser,firecrawl" }));
    expect(ids(setup.search)).toEqual([ProviderId.Firecrawl]);
    expect(setup.skipped.search).toEqual([
      { id: ProviderId.Direct, reason: SkipReason.NotSupported },
      { id: ProviderId.CloudflareBrowser, reason: SkipReason.NotSupported },
    ]);
  });
});
