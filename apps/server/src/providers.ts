import {
  alphaVantage,
  arxiv,
  edgar,
  nasdaq,
  openAlex,
  pubmed,
  semanticScholar,
  yahoo,
  type PaperProvider,
  coinGecko,
  coinMetrics,
  miningPoolStats,
  kaspa,
  dash,
  mempool,
  type CryptoProvider,
  brightData,
  brightDataSearch,
  cloudflareBrowser,
  cloudflareBrowserBinding,
  direct,
  firecrawl,
  firecrawlSearch,
  serpentListings,
  serpentSearch,
  ProviderId,
  type ListingProvider,
  type PageProvider,
  type SearchProvider,
  type StockProvider,
} from "mcpy/providers";
import { bindingRenderer, type BrowserBindingLike } from "./browser.js";
import type { ServerEnv } from "./env.js";

/** Worker bindings a provider can run on instead of an API key. */
export interface ProviderBindings {
  browser?: BrowserBindingLike;
}

export const SkipReason = { MissingCredentials: "missing_credentials", NotSupported: "not_supported" } as const;
export type SkipReason = (typeof SkipReason)[keyof typeof SkipReason];

export interface Skipped {
  id: ProviderId;
  reason: SkipReason;
}

export interface ProviderSetup {
  pages: PageProvider[];
  search: SearchProvider[];
  papers: PaperProvider[];
  listings: ListingProvider[];
  crypto: CryptoProvider[];
  stocks: StockProvider[];
  skipped: { pages: Skipped[]; search: Skipped[]; papers: Skipped[]; listings: Skipped[]; crypto: Skipped[]; stocks: Skipped[] };
}

/** A provider, or null when its credentials are missing. */
type Build<P> = (env: ServerEnv, bindings: ProviderBindings) => P | null;
/** The providers that can fill one role; an id listed for a role it has no builder for is skipped as not_supported. */
type Builders<P> = Partial<Record<ProviderId, Build<P>>>;

const PAGE_BUILDERS: Builders<PageProvider> = {
  [ProviderId.Direct]: () => direct(),
  // The binding needs no token; the REST API is the fallback for hosts without it.
  [ProviderId.CloudflareBrowser]: (e, b) =>
    b.browser
      ? cloudflareBrowserBinding({ render: bindingRenderer(b.browser) })
      : e.CF_ACCOUNT_ID && e.CF_BROWSER_API_TOKEN
        ? cloudflareBrowser({ accountId: e.CF_ACCOUNT_ID, apiToken: e.CF_BROWSER_API_TOKEN, apiBase: e.CF_BROWSER_API_BASE })
        : null,
  [ProviderId.Firecrawl]: (e) => (e.FIRECRAWL_API_KEY ? firecrawl(firecrawlOptions(e, e.FIRECRAWL_API_KEY)) : null),
  [ProviderId.BrightData]: (e) =>
    e.BRIGHTDATA_API_KEY && e.BRIGHTDATA_UNLOCKER_ZONE ? brightData({ apiKey: e.BRIGHTDATA_API_KEY, zone: e.BRIGHTDATA_UNLOCKER_ZONE }) : null,
};

const SEARCH_BUILDERS: Builders<SearchProvider> = {
  [ProviderId.Firecrawl]: (e) => (e.FIRECRAWL_API_KEY ? firecrawlSearch(firecrawlOptions(e, e.FIRECRAWL_API_KEY)) : null),
  [ProviderId.BrightData]: (e) =>
    e.BRIGHTDATA_API_KEY && e.BRIGHTDATA_SERP_ZONE ? brightDataSearch({ apiKey: e.BRIGHTDATA_API_KEY, zone: e.BRIGHTDATA_SERP_ZONE }) : null,
  [ProviderId.Serpent]: (e) => (e.SERPENT_API_KEY ? serpentSearch({ apiKey: e.SERPENT_API_KEY }) : null),
};

const PAPER_BUILDERS: Builders<PaperProvider> = {
  // Works keyless on a small shared budget; a free key raises it.
  [ProviderId.OpenAlex]: (e) => openAlex({ apiKey: e.OPENALEX_API_KEY }),
  [ProviderId.Arxiv]: () => arxiv(),
  [ProviderId.SemanticScholar]: (e) => (e.SEMANTIC_SCHOLAR_API_KEY ? semanticScholar({ apiKey: e.SEMANTIC_SCHOLAR_API_KEY }) : null),
  [ProviderId.PubMed]: (e) => pubmed({ apiKey: e.NCBI_API_KEY, email: e.NCBI_EMAIL }),
};

const LISTING_BUILDERS: Builders<ListingProvider> = {
  [ProviderId.Serpent]: (e) => (e.SERPENT_API_KEY ? serpentListings({ apiKey: e.SERPENT_API_KEY }) : null),
};

const CRYPTO_BUILDERS: Builders<CryptoProvider> = {
  // Keyless works on a small shared limit; the demo key makes it dependable.
  [ProviderId.CoinGecko]: (e) => coinGecko({ apiKey: e.COINGECKO_API_KEY }),
  [ProviderId.CoinMetrics]: () => coinMetrics(),
  [ProviderId.MiningPoolStats]: () => miningPoolStats(),
  [ProviderId.Kaspa]: () => kaspa(),
  [ProviderId.Dash]: () => dash(),
  [ProviderId.Mempool]: () => mempool(),
};

const STOCK_BUILDERS: Builders<StockProvider> = {
  [ProviderId.Yahoo]: () => yahoo(),
  [ProviderId.Nasdaq]: () => nasdaq(),
  // 25 requests a day on the free key: the last resort.
  [ProviderId.AlphaVantage]: (e) => (e.ALPHAVANTAGE_API_KEY ? alphaVantage({ apiKey: e.ALPHAVANTAGE_API_KEY }) : null),
  [ProviderId.Edgar]: (e) => edgar({ userAgent: e.SEC_USER_AGENT }),
};

const firecrawlOptions = (e: ServerEnv, apiKey: string) => ({ apiKey, apiUrl: e.FIRECRAWL_API_URL, usdPerCredit: e.FIRECRAWL_USD_PER_CREDIT });

function resolve<P>(order: ProviderId[], builders: Builders<P>, env: ServerEnv, bindings: ProviderBindings): { chain: P[]; skipped: Skipped[] } {
  const chain: P[] = [];
  const skipped: Skipped[] = [];
  for (const id of order) {
    const build = builders[id];
    const built = build ? build(env, bindings) : undefined;
    if (built === undefined) skipped.push({ id, reason: SkipReason.NotSupported });
    else if (built === null) skipped.push({ id, reason: SkipReason.MissingCredentials });
    else chain.push(built);
  }
  return { chain, skipped };
}

/** Enabled providers in configured order; a provider without credentials is skipped. */
export function buildProviders(env: ServerEnv, bindings: ProviderBindings = {}): ProviderSetup {
  const pages = resolve(env.PAGE_PROVIDERS, PAGE_BUILDERS, env, bindings);
  const search = resolve(env.SEARCH_PROVIDERS, SEARCH_BUILDERS, env, bindings);
  const papers = resolve(env.PAPER_PROVIDERS, PAPER_BUILDERS, env, bindings);
  const listings = resolve(env.LISTING_PROVIDERS, LISTING_BUILDERS, env, bindings);
  const crypto = resolve(env.CRYPTO_PROVIDERS, CRYPTO_BUILDERS, env, bindings);
  const stocks = resolve(env.STOCK_PROVIDERS, STOCK_BUILDERS, env, bindings);
  return {
    pages: pages.chain,
    search: search.chain,
    papers: papers.chain,
    listings: listings.chain,
    crypto: crypto.chain,
    stocks: stocks.chain,
    skipped: { pages: pages.skipped, search: search.skipped, papers: papers.skipped, listings: listings.skipped, crypto: crypto.skipped, stocks: stocks.skipped },
  };
}
