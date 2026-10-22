/**
 * Public contract: what callers send and get back, over the SDK, REST and
 * MCP alike. No provider appears anywhere in these schemas.
 */

import { z } from "zod";
import { CacheStatusSchema, ErrorCodeSchema, GrepMode, GrepModeSchema, PageFormat, PageFormatSchema, UserAgentProfileSchema } from "./enums.js";

/** Hard ceiling on characters returned by one call, whatever the caller asks. */
export const MAX_OUTPUT_CHARS = 100_000;

const url = z.string().url().max(4096).describe("Absolute http(s) URL");
const fresh = z.boolean().default(false).describe("Skip the cache read and fetch again");
const userAgent = UserAgentProfileSchema.optional().describe("User-agent profile for the request");
const format = PageFormatSchema.default(PageFormat.Markdown);

export const FetchInputSchema = z.object({
  url,
  format,
  start_index: z.number().int().min(0).default(0).describe("Character offset to start from"),
  max_length: z.number().int().min(100).max(MAX_OUTPUT_CHARS).default(10_000).describe("Maximum characters to return"),
  user_agent: userAgent,
  fresh,
});

export const GrepInputSchema = z.object({
  url,
  pattern: z.string().min(1).max(500).describe("Case-insensitive pattern: an RE2 regular expression, or plain text when mode is literal"),
  mode: GrepModeSchema.default(GrepMode.Regex).describe("regex (RE2 syntax, no lookaround/backreferences) or literal"),
  context_lines: z.number().int().min(0).max(20).default(3),
  max_matches: z.number().int().min(1).max(200).default(20),
  format,
  user_agent: userAgent,
  fresh,
});

export const SearchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(50).default(10),
  fresh,
});

export const ResultMetaSchema = z.object({
  cache: CacheStatusSchema,
  latency_ms: z.number().nonnegative(),
  attempts: z.number().int().nonnegative().describe("Upstream attempts made (0 on a cache hit)"),
});

export const FetchResultSchema = z.object({
  url: z.string(),
  final_url: z.string(),
  title: z.string().optional(),
  status: z.number().int(),
  format: PageFormatSchema,
  content: z.string(),
  start_index: z.number().int(),
  end_index: z.number().int(),
  total_length: z.number().int(),
  next_index: z.number().int().optional().describe("Pass as start_index to read the next chunk"),
  truncated: z.boolean(),
  meta: ResultMetaSchema,
});

export const GrepResultSchema = z.object({
  url: z.string(),
  final_url: z.string(),
  matches: z.number().int(),
  capped: z.boolean(),
  total_lines: z.number().int(),
  output: z.string(),
  truncated: z.boolean(),
  meta: ResultMetaSchema,
});

export const SearchHitSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

export const SearchResultSchema = z.object({
  query: z.string(),
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
