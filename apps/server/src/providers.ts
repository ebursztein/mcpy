import {
  arxiv,
  openAlex,
  pubmed,
  semanticScholar,
  type PaperProvider,
  brightData,
  brightDataSearch,
  cloudflareBrowser,
  cloudflareBrowserBinding,
  direct,
  firecrawl,
  firecrawlSearch,
  ProviderId,
  type PageProvider,
  type SearchProvider,
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
  skipped: { pages: Skipped[]; search: Skipped[]; papers: Skipped[] };
}

type Build<P> = (env: ServerEnv, bindings: ProviderBindings) => P | null | typeof UNSUPPORTED;
const UNSUPPORTED = Symbol("unsupported");

const PAGE_BUILDERS: Record<ProviderId, Build<PageProvider>> = {
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
  [ProviderId.OpenAlex]: () => UNSUPPORTED,
  [ProviderId.Arxiv]: () => UNSUPPORTED,
  [ProviderId.SemanticScholar]: () => UNSUPPORTED,
  [ProviderId.PubMed]: () => UNSUPPORTED,
};

const SEARCH_BUILDERS: Record<ProviderId, Build<SearchProvider>> = {
  [ProviderId.Direct]: () => UNSUPPORTED,
  [ProviderId.CloudflareBrowser]: () => UNSUPPORTED,
  [ProviderId.Firecrawl]: (e) => (e.FIRECRAWL_API_KEY ? firecrawlSearch(firecrawlOptions(e, e.FIRECRAWL_API_KEY)) : null),
  [ProviderId.BrightData]: (e) =>
    e.BRIGHTDATA_API_KEY && e.BRIGHTDATA_SERP_ZONE ? brightDataSearch({ apiKey: e.BRIGHTDATA_API_KEY, zone: e.BRIGHTDATA_SERP_ZONE }) : null,
  [ProviderId.OpenAlex]: () => UNSUPPORTED,
  [ProviderId.Arxiv]: () => UNSUPPORTED,
  [ProviderId.SemanticScholar]: () => UNSUPPORTED,
  [ProviderId.PubMed]: () => UNSUPPORTED,
};

const PAPER_BUILDERS: Record<ProviderId, Build<PaperProvider>> = {
  [ProviderId.Direct]: () => UNSUPPORTED,
  [ProviderId.CloudflareBrowser]: () => UNSUPPORTED,
  [ProviderId.Firecrawl]: () => UNSUPPORTED,
  [ProviderId.BrightData]: () => UNSUPPORTED,
  // Works keyless on a small shared budget; a free key raises it.
  [ProviderId.OpenAlex]: (e) => openAlex({ apiKey: e.OPENALEX_API_KEY }),
  [ProviderId.Arxiv]: () => arxiv(),
  [ProviderId.SemanticScholar]: (e) => (e.SEMANTIC_SCHOLAR_API_KEY ? semanticScholar({ apiKey: e.SEMANTIC_SCHOLAR_API_KEY }) : null),
  [ProviderId.PubMed]: (e) => pubmed({ apiKey: e.NCBI_API_KEY, email: e.NCBI_EMAIL }),
};

const firecrawlOptions = (e: ServerEnv, apiKey: string) => ({ apiKey, apiUrl: e.FIRECRAWL_API_URL, usdPerCredit: e.FIRECRAWL_USD_PER_CREDIT });

function resolve<P>(
  order: ProviderId[],
  builders: Record<ProviderId, Build<P>>,
  env: ServerEnv,
  bindings: ProviderBindings,
): { chain: P[]; skipped: Skipped[] } {
  const chain: P[] = [];
  const skipped: Skipped[] = [];
  for (const id of order) {
    const built = builders[id](env, bindings);
    if (built === UNSUPPORTED) skipped.push({ id, reason: SkipReason.NotSupported });
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
  return {
    pages: pages.chain,
    search: search.chain,
    papers: papers.chain,
    skipped: { pages: pages.skipped, search: search.skipped, papers: papers.skipped },
  };
}
