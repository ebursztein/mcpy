import { brightdataFetch, brightdataSearch } from "./brightdata";
import { cfBrowser } from "./cf-browser";
import { cfFetch } from "./cf-fetch";
import { firecrawlFetch, firecrawlSearch } from "./firecrawl";
import type { FetchProvider, ProviderDeps, ProviderFactory, SearchProvider } from "./types";

/** To add a backend: write an adapter, then register its factory here. */
export const FETCH_FACTORIES: ProviderFactory<FetchProvider>[] = [cfFetch, cfBrowser, firecrawlFetch, brightdataFetch];
export const SEARCH_FACTORIES: ProviderFactory<SearchProvider>[] = [firecrawlSearch, brightdataSearch];

export interface Resolved<P> {
  /** Enabled providers, in configured order. */
  chain: P[];
  /** Ids from the configured order that were skipped, and why. */
  skipped: { id: string; reason: string }[];
}

function resolve<P extends { id: string }>(
  order: string[],
  factories: ProviderFactory<P>[],
  deps: ProviderDeps,
): Resolved<P> {
  const byId = new Map(factories.map((f) => [f.id, f]));
  const chain: P[] = [];
  const skipped: Resolved<P>["skipped"] = [];
  for (const id of order) {
    const factory = byId.get(id);
    if (!factory) {
      skipped.push({ id, reason: "unknown provider id" });
      continue;
    }
    const provider = factory.create(deps);
    if (provider) chain.push(provider);
    else skipped.push({ id, reason: "missing credentials" });
  }
  return { chain, skipped };
}

export function resolveFetchProviders(deps: ProviderDeps): Resolved<FetchProvider> {
  return resolve(deps.config.fetchProviders, FETCH_FACTORIES, deps);
}

export function resolveSearchProviders(deps: ProviderDeps): Resolved<SearchProvider> {
  return resolve(deps.config.searchProviders, SEARCH_FACTORIES, deps);
}
