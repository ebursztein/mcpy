/**
 * Public contract: what callers send and get back, over the SDK, REST and
 * MCP alike. Plain-English parameters; no provider appears anywhere.
 */

import { z } from "zod";
import type { PaperSearchInput, PaperSearchResult } from "./schemas-papers.js";
import type { CryptoCoinInput, CryptoCoinResult, CryptoMarketInput, CryptoMarketResult } from "./schemas-crypto.js";
import type { ShoppingItemInput, ShoppingItemResult, ShoppingSearchInput, ShoppingSearchResult } from "./services/shopping/schema.js";
import {
  CacheStatusSchema,
  DeviceSchema,
  ErrorCodeSchema,
  HttpMethod,
  HttpMethodSchema,
  PageFormat,
  PageFormatSchema,
  RecencySchema,
  SearchMode,
  SearchModeSchema,
  SearchType,
  SearchTypeSchema,
  UserAgentProfileSchema,
} from "./enums.js";

/** Hard ceiling on characters returned by one call, whatever the caller asks. */
export const MAX_OUTPUT_CHARS = 50_000;
export const MAX_SEARCH_RESULTS = 50;
export const MAX_SEARCH_PAGE = 10;
const MAX_SITES = 10;
/** Largest request body a caller may send with a POST, in characters. */
export const MAX_REQUEST_BODY_CHARS = 100_000;
/** Most extra request headers per call. */
export const MAX_REQUEST_HEADERS = 20;
/** Longest wait a caller may ask for on a rendered page, in ms. */
export const MAX_RENDER_WAIT_MS = 15_000;

const url = z.string().url().max(4096).describe("Absolute http(s) URL");

/** Default `max_age` of each cached operation, in seconds. */
export const DEFAULT_MAX_AGE_SECONDS = { page: 3_600, search: 900, papers: 86_400 } as const;
/** Default `max_age` of a write (POST, PUT, PATCH, DELETE): it always reaches the site. */
export const DEFAULT_WRITE_MAX_AGE_SECONDS = 0;

const maxAgeSeconds = z.number().int().min(0).max(30 * 86_400);
const MAX_AGE_HINT = "86400 for data that changes daily, 60 for live data, 0 to skip the cache";

/**
 * How old a cached answer a call accepts, in seconds; 0 skips the cache.
 * Every cached operation takes this one field, with its own default.
 */
export function maxAgeField(defaultSeconds: number) {
  return maxAgeSeconds.default(defaultSeconds).describe(`Oldest cached answer to accept, in seconds (default ${defaultSeconds}): ${MAX_AGE_HINT}`);
}
/** A page's max_age: its default depends on the method, so the operation resolves it (pageMaxAgeOf). */
const pageMaxAge = maxAgeSeconds
  .optional()
  .describe(
    `Oldest cached answer to accept, in seconds: ${MAX_AGE_HINT}. Default ${DEFAULT_MAX_AGE_SECONDS.page} for GET and HEAD; for POST, PUT, PATCH and DELETE ${DEFAULT_WRITE_MAX_AGE_SECONDS}: they reach the site unless you pass one (a JSON-RPC read, say)`,
  );
const freeOnly = z
  .boolean()
  .optional()
  .describe("Never use a paid source: only the cache and free sources answer, and if they cannot the call fails (upstream_failed). For live reads a caller can get elsewhere");
const userAgent = UserAgentProfileSchema.optional().describe("Browser to present as (default: an honest mcpy user agent)");
const format = PageFormatSchema.default(PageFormat.Markdown).describe("markdown (readable text) or html (raw page)");

/** An HTTP header name (RFC 9110 token). Which names are refused is checked by the operation. */
const headerName = z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/, "an HTTP header name");

/** How the page is requested: shared by fetch and grep. */
const pageRequestFields = {
  render: z
    .boolean()
    .default(false)
    .describe("Run the page's JavaScript in a real browser first, for pages that load their content with scripts (slower; GET only)"),
  wait_ms: z.number().int().min(0).max(MAX_RENDER_WAIT_MS).optional().describe("With render: extra time to let the page finish loading, in ms"),
  method: HttpMethodSchema.default(HttpMethod.Get).describe("GET (default), HEAD, or POST, PUT, PATCH, DELETE to send a body (for APIs that take a JSON or form body)"),
  body: z
    .string()
    .max(MAX_REQUEST_BODY_CHARS)
    .optional()
    .describe("With POST, PUT, PATCH or DELETE: the request body, e.g. a JSON string. A JSON body without a content-type header is sent as application/json"),
  headers: z
    .record(headerName, z.string().max(2_000))
    .optional()
    .describe("Extra request headers, e.g. {\"Origin\": \"https://example.com\"}. Host, Content-Length and connection-level headers are refused"),
};

// Input schemas must stay representable as JSON Schema (MCP publishes them),
// so no transforms here: values are validated case-insensitively and
// normalized by the operation.
const hostname = z.string().regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i, "a hostname like example.com");

export const FetchInputSchema = z.object({
  url,
  format,
  offset: z.number().int().min(0).default(0).describe("Character to start from; use next_offset from the previous call"),
  version: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional()
    .describe("With offset: the version from the first part, so every part comes from the same copy of the page"),
  max_chars: z.number().int().min(100).max(MAX_OUTPUT_CHARS).default(10_000).describe("Most characters to return"),
  script: z
    .string()
    .min(1)
    .max(100_000)
    .optional()
    .describe(
      "JavaScript module run on the whole page: `export default (page) => value`, page is { url, final_url, status, title, content }. Returns the value as JSON instead of the page; use format html to work on the raw page",
    ),
  user_agent: userAgent,
  ...pageRequestFields,
  max_age: pageMaxAge,
  free_only: freeOnly,
});

export const GrepInputSchema = z.object({
  url,
  pattern: z.string().min(1).max(500).describe("What to look for, case-insensitive: a regular expression (RE2), or plain text with literal: true"),
  literal: z.boolean().default(false).describe("Treat pattern as plain text instead of a regular expression"),
  context: z.number().int().min(0).max(20).default(3).describe("Lines to show around each match"),
  max_matches: z.number().int().min(1).max(200).default(20),
  format,
  user_agent: userAgent,
  ...pageRequestFields,
  max_age: pageMaxAge,
  free_only: freeOnly,
});

export const SearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    type: SearchTypeSchema.default(SearchType.Web).describe("web, news, images, videos, shopping, jobs or places"),
    max_results: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(10),
    page: z.number().int().min(1).max(MAX_SEARCH_PAGE).default(1).describe("Page of results, 1 is the first"),
    country: z
      .string()
      .regex(/^[a-zA-Z]{2}$/, "a two-letter country code like us")
      .optional()
      .describe("Search as if from this country (two-letter code, e.g. us, fr)"),
    language: z
      .string()
      .regex(/^[a-zA-Z]{2}$/, "a two-letter language code like en")
      .optional()
      .describe("Preferred result language (two-letter code, e.g. en, fr)"),
    recency: RecencySchema.optional().describe("Only results from the past hour, day, week, month or year"),
    device: DeviceSchema.optional().describe("Search as a desktop or mobile user"),
    sites: z.array(hostname).min(1).max(MAX_SITES).optional().describe("Only results from these sites"),
    exclude_sites: z.array(hostname).min(1).max(MAX_SITES).optional().describe("No results from these sites"),
    mode: SearchModeSchema.default(SearchMode.Fast).describe("fast: first source that answers; thorough: combine all sources (slower, costs more)"),
    max_age: maxAgeField(DEFAULT_MAX_AGE_SECONDS.search),
  })
  .refine((s) => !(s.sites && s.exclude_sites), { message: "use either sites or exclude_sites, not both", path: ["exclude_sites"] });

export const ResultMetaSchema = z.object({
  cache: CacheStatusSchema,
  latency_ms: z.number().nonnegative(),
  attempts: z.number().int().nonnegative().describe("Upstream requests made (0 when served from cache)"),
  cost_usd: z.number().nonnegative().optional().describe("Estimated USD this call counted against your daily allowance (0: cache and free sources only)"),
  call_id: z.string().max(64).optional().describe("This call's id in the server's usage log, for tracing an answer back"),
});

export const FetchResultSchema = z.object({
  url: z.string(),
  final_url: z.string(),
  title: z.string().optional(),
  status: z.number().int(),
  format: PageFormatSchema,
  content: z.string(),
  offset: z.number().int(),
  total_chars: z.number().int(),
  next_offset: z.number().int().optional().describe("Pass as offset, with version, to read the next part; absent at the end"),
  version: z.string().optional().describe("Which copy of the page this is; set when it has more than one part"),
  tip: z.string().optional().describe("Set when the page is too long for one call"),
  meta: ResultMetaSchema,
});

export const GrepResultSchema = z.object({
  url: z.string(),
  final_url: z.string(),
  matches: z.number().int(),
  more_matches: z.boolean().describe("More matches exist than max_matches"),
  total_lines: z.number().int(),
  output: z.string(),
  truncated: z.boolean().describe("Output was cut to fit the size limit"),
  meta: ResultMetaSchema,
});

/** One search result. Optional fields depend on the result type. */
export const SearchHitSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  date: z.string().optional().describe("Publication date as reported by the source"),
  publisher: z.string().optional().describe("Site or outlet name (news, videos, jobs)"),
  image: z.string().optional().describe("Image or thumbnail URL"),
  price: z.string().optional(),
  rating: z.number().optional(),
  reviews: z.number().int().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  location: z.string().optional(),
  duration: z.string().optional(),
  sources: z.number().int().min(1).describe("How many independent sources returned this result"),
});

export const SearchResultSchema = z.object({
  query: z.string(),
  type: SearchTypeSchema,
  page: z.number().int(),
  results: z.array(SearchHitSchema),
  meta: ResultMetaSchema,
});

export const ErrorBodySchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.array(z.string()).optional(),
  }),
});

export type FetchInput = z.input<typeof FetchInputSchema>;
export type GrepInput = z.input<typeof GrepInputSchema>;
export type SearchInput = z.input<typeof SearchInputSchema>;
export type SearchQuery = z.infer<typeof SearchInputSchema>;
export type FetchResult = z.infer<typeof FetchResultSchema>;
export type GrepResult = z.infer<typeof GrepResultSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type ResultMeta = z.infer<typeof ResultMetaSchema>;
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/** Implemented by the in-process SDK and the REST client alike. */
export interface McpyApi {
  fetch(input: FetchInput): Promise<FetchResult>;
  grep(input: GrepInput): Promise<GrepResult>;
  search(input: SearchInput): Promise<SearchResult>;
  papers(input: PaperSearchInput): Promise<PaperSearchResult>;
  shopping(input: ShoppingSearchInput): Promise<ShoppingSearchResult>;
  shoppingItem(input: ShoppingItemInput): Promise<ShoppingItemResult>;
  /** crypto.market: totals and many coins now. */
  cryptoMarket(input: CryptoMarketInput): Promise<CryptoMarketResult>;
  /** crypto.coin: a few coins day by day. */
  cryptoCoin(input: CryptoCoinInput): Promise<CryptoCoinResult>;
}
