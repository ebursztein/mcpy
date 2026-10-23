/**
 * `mcpy/providers`: backends you can plug into createMcpy(). This is the
 * configuration surface only; the call API (`mcpy.fetch`, ...) never names
 * a provider.
 */

export { brightData, brightDataSearch, BRIGHTDATA_SEARCH_CAPABILITIES, type BrightDataOptions } from "./brightdata/index.js";
export { cloudflareBrowser, type CloudflareBrowserOptions } from "./cloudflare-browser/index.js";
export { direct, type DirectOptions } from "./direct/index.js";
export { firecrawl, firecrawlSearch, FIRECRAWL_SEARCH_CAPABILITIES, type FirecrawlOptions } from "./firecrawl/index.js";
export {
  ProviderId,
  ProviderIdSchema,
  type FetchedPage,
  type FoundPage,
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

// Paper indexes.
export { openAlex, OPENALEX_CAPABILITIES, type OpenAlexOptions } from "./openalex/index.js";
export { arxiv, ARXIV_CAPABILITIES, type ArxivOptions } from "./arxiv/index.js";
export { semanticScholar, SEMANTIC_SCHOLAR_CAPABILITIES, type SemanticScholarOptions } from "./semantic-scholar/index.js";
export { pubmed, PUBMED_CAPABILITIES, type PubMedOptions } from "./pubmed/index.js";
export { bareArxivId, bareDoi, type FoundPaper, type PaperCapabilities, type PaperProvider, type PaperRequest } from "./paper-types.js";
