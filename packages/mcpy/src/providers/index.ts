/**
 * `mcpy/providers`: backends you can plug into createMcpy(). This is the
 * configuration surface only; the call API (`mcpy.fetch`, ...) never names
 * a provider.
 */

export { brightData, brightDataSearch, BRIGHTDATA_SEARCH_CAPABILITIES, type BrightDataOptions } from "./brightdata/index.js";
export { cloudflareBrowser, type CloudflareBrowserOptions } from "./cloudflare-browser/index.js";
export {
  cloudflareBrowserBinding,
  type BrowserRender,
  type BrowserRenderRequest,
  type CloudflareBrowserBindingOptions,
  type RenderedPage,
} from "./cloudflare-browser/binding.js";
export { direct, type DirectOptions } from "./direct/index.js";
export { serpentSearch, SERPENT_DEFAULT_USD_PER_CALL, SERPENT_SEARCH_CAPABILITIES, type SerpentOptions } from "./serpent/index.js";
export { serpentListings, SERPENT_EBAY_USD_PER_CALL, type SerpentListingsOptions } from "./serpent/ebay.js";
export { firecrawl, firecrawlSearch, FIRECRAWL_HOBBY_USD_PER_CREDIT, FIRECRAWL_SEARCH_CAPABILITIES, type FirecrawlOptions } from "./firecrawl/index.js";
export {
  ProviderId,
  ProviderIdSchema,
  type FetchedPage,
  type FoundPage,
  type PageCapabilities,
  type PageProvider,
  type PageRequest,
  type ProviderCall,
  type SearchCapabilities,
  type SearchProvider,
  type SearchRequest,
} from "./types.js";

// Building blocks for custom providers.
export { ProviderFailure } from "../errors.js";
export { HttpClient, HttpMethod, type HttpContext, type HttpRequest, type HttpResponse } from "../http/client.js";
export { contentKindOf } from "../content/kind.js";
export { htmlToMarkdown, htmlTitle, splitFrontmatter } from "../content/extract.js";

// Marketplace listing APIs.
export { ListingMarket, ListingMarketSchema, ListingSort, ListingSortSchema, type FoundListing, type ListingPage, type ListingProvider, type ListingRequest } from "./listing-types.js";

// Crypto market and network sources.
export { coinGecko, COINGECKO_CAPABILITIES, type CoinGeckoOptions } from "./coingecko/index.js";
export { kaspa, KASPA_CAPABILITIES } from "./kaspa/index.js";
export { mempool, MEMPOOL_CAPABILITIES } from "./mempool/index.js";
export { coinMetrics, COIN_METRICS_CAPABILITIES } from "./coinmetrics/index.js";
export { miningPoolStats, MINING_POOL_STATS_CAPABILITIES } from "./miningpoolstats/index.js";
export { isoFromUnix, type CryptoCapabilities, type CryptoProvider, type CryptoSnapshot, type FoundCoinDay, type FoundLiveCoin, type FoundTotals, type HistoryRequest, type SnapshotRequest } from "./crypto-types.js";

// Paper indexes.
export { openAlex, OPENALEX_CAPABILITIES, type OpenAlexOptions } from "./openalex/index.js";
export { arxiv, ARXIV_CAPABILITIES, type ArxivOptions } from "./arxiv/index.js";
export { semanticScholar, SEMANTIC_SCHOLAR_CAPABILITIES, type SemanticScholarOptions } from "./semantic-scholar/index.js";
export { pubmed, PUBMED_CAPABILITIES, type PubMedOptions } from "./pubmed/index.js";
export { bareArxivId, bareDoi, type FoundPaper, type PaperCapabilities, type PaperProvider, type PaperRequest } from "./paper-types.js";
