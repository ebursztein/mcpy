/**
 * Public contract: what callers send and get back, over the SDK, REST and
 * MCP alike. Plain-English parameters; no provider appears anywhere.
 */

import { z } from "zod";
import {
  CacheStatusSchema,
  DeviceSchema,
  ErrorCodeSchema,
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
export const MAX_OUTPUT_CHARS = 100_000;
export const MAX_SEARCH_RESULTS = 50;
export const MAX_SEARCH_PAGE = 10;
const MAX_SITES = 10;

const url = z.string().url().max(4096).describe("Absolute http(s) URL");
const fresh = z.boolean().default(false).describe("Ignore the cache and fetch again");
const userAgent = UserAgentProfileSchema.optional().describe("Browser to present as (default: an honest mcpy user agent)");
const format = PageFormatSchema.default(PageFormat.Markdown).describe("markdown (readable text) or html (raw page)");

// Input schemas must stay representable as JSON Schema (MCP publishes them),
// so no transforms here: values are validated case-insensitively and
// normalized by the operation.
const hostname = z.string().regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i, "a hostname like example.com");

export const FetchInputSchema = z.object({
  url,
  format,
  offset: z.number().int().min(0).default(0).describe("Character to start from; use next_offset from the previous call"),
  max_chars: z.number().int().min(100).max(MAX_OUTPUT_CHARS).default(10_000).describe("Most characters to return"),
  user_agent: userAgent,
  fresh,
});

export const GrepInputSchema = z.object({
  url,
  pattern: z.string().min(1).max(500).describe("What to look for, case-insensitive: a regular expression (RE2), or plain text with literal: true"),
  literal: z.boolean().default(false).describe("Treat pattern as plain text instead of a regular expression"),
  context: z.number().int().min(0).max(20).default(3).describe("Lines to show around each match"),
  max_matches: z.number().int().min(1).max(200).default(20),
  format,
  user_agent: userAgent,
  fresh,
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
    fresh,
  })
  .refine((s) => !(s.sites && s.exclude_sites), { message: "use either sites or exclude_sites, not both", path: ["exclude_sites"] });

export const ResultMetaSchema = z.object({
  cache: CacheStatusSchema,
  latency_ms: z.number().nonnegative(),
  attempts: z.number().int().nonnegative().describe("Upstream requests made (0 when served from cache)"),
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
  next_offset: z.number().int().optional().describe("Pass as offset to read the next part; absent at the end"),
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
}
