/**
 * `mcpy/providers`: backends you can plug into createMcpy(). This is the
 * configuration surface only; the call API (`mcpy.fetch`, ...) never names
 * a provider.
 */

export { brightData, brightDataSearch, type BrightDataOptions } from "./brightdata/index.js";
export { cloudflareBrowser, type CloudflareBrowserOptions } from "./cloudflare-browser/index.js";
export { direct, type DirectOptions } from "./direct/index.js";
export { firecrawl, firecrawlSearch, type FirecrawlOptions } from "./firecrawl/index.js";
export {
  ProviderId,
  ProviderIdSchema,
  type FetchedPage,
  type FoundPage,
  type PageProvider,
  type PageRequest,
  type ProviderCall,
  type SearchProvider,
  type SearchRequest,
} from "./types.js";
