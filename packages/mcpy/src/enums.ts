/**
 * Every categorical value in mcpy is a zod enum with an exported constant
 * object, so callers write `PageFormat.Markdown`, never a bare string.
 */

import { z } from "zod";

function enumOf<const T extends Record<string, string>>(values: T) {
  const schema = z.enum(Object.values(values) as [T[keyof T], ...T[keyof T][]]);
  return { values, schema };
}

const pageFormat = enumOf({ Markdown: "markdown", Html: "html" } as const);
export const PageFormat = pageFormat.values;
export const PageFormatSchema = pageFormat.schema;
export type PageFormat = z.infer<typeof PageFormatSchema>;

const userAgentProfile = enumOf({
  /** Honest mcpy user agent (identifies the tool). */
  Default: "default",
  Chrome: "chrome",
  Safari: "safari",
  Firefox: "firefox",
  /** Chrome on Android. */
  Mobile: "mobile",
  Googlebot: "googlebot",
} as const);
export const UserAgentProfile = userAgentProfile.values;
export const UserAgentProfileSchema = userAgentProfile.schema;
export type UserAgentProfile = z.infer<typeof UserAgentProfileSchema>;

const cacheStatus = enumOf({ Hit: "hit", Miss: "miss", Bypass: "bypass" } as const);
export const CacheStatus = cacheStatus.values;
export const CacheStatusSchema = cacheStatus.schema;
export type CacheStatus = z.infer<typeof CacheStatusSchema>;

/** Outcome of one provider attempt, as judged by the engine. */
const attemptOutcome = enumOf({
  Ok: "ok",
  Final: "final",
  Escalate: "escalate",
  Error: "error",
  Skipped: "skipped",
} as const);
export const AttemptOutcome = attemptOutcome.values;
export const AttemptOutcomeSchema = attemptOutcome.schema;
export type AttemptOutcome = z.infer<typeof AttemptOutcomeSchema>;

const errorCode = enumOf({
  InvalidInput: "invalid_input",
  InvalidTarget: "invalid_target",
  NotFound: "not_found",
  Unauthorized: "unauthorized",
  Forbidden: "forbidden",
  RateLimited: "rate_limited",
  NoProviders: "no_providers",
  UpstreamFailed: "upstream_failed",
  Timeout: "timeout",
  TooLarge: "too_large",
  UnsupportedContent: "unsupported_content",
  BadResponse: "bad_response",
  Internal: "internal",
} as const);
export const ErrorCode = errorCode.values;
export const ErrorCodeSchema = errorCode.schema;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

const operation = enumOf({ Fetch: "fetch", Grep: "grep", Search: "search", Papers: "papers" } as const);
export const Operation = operation.values;
export const OperationSchema = operation.schema;
export type Operation = z.infer<typeof OperationSchema>;

const providerKind = enumOf({ Fetch: "fetch", Search: "search" } as const);
export const ProviderKind = providerKind.values;
export const ProviderKindSchema = providerKind.schema;
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

const logLevel = enumOf({ Debug: "debug", Info: "info", Warn: "warn", Error: "error" } as const);
export const LogLevel = logLevel.values;
export const LogLevelSchema = logLevel.schema;
export type LogLevel = z.infer<typeof LogLevelSchema>;

const spanName = enumOf({
  Operation: "mcpy.operation",
  Attempt: "mcpy.attempt",
  HttpClient: "http.client",
  Request: "mcpy.request",
} as const);
export const SpanName = spanName.values;
export const SpanNameSchema = spanName.schema;
export type SpanName = z.infer<typeof SpanNameSchema>;

const spanStatus = enumOf({ Unset: "unset", Ok: "ok", Error: "error" } as const);
export const SpanStatus = spanStatus.values;
export const SpanStatusSchema = spanStatus.schema;
export type SpanStatus = z.infer<typeof SpanStatusSchema>;

/** Which front door a call came through. */
const transport = enumOf({ Sdk: "sdk", Rest: "rest", Mcp: "mcp" } as const);
export const Transport = transport.values;
export const TransportSchema = transport.schema;
export type Transport = z.infer<typeof TransportSchema>;

/** How web_grep interprets its pattern. */
const grepMode = enumOf({ Regex: "regex", Literal: "literal" } as const);
export const GrepMode = grepMode.values;
export const GrepModeSchema = grepMode.schema;
export type GrepMode = z.infer<typeof GrepModeSchema>;

/** What a page's content was produced from; drives quality judgement. */
const contentKind = enumOf({ Html: "html", Markdown: "markdown", Text: "text", Json: "json" } as const);
export const ContentKind = contentKind.values;
export const ContentKindSchema = contentKind.schema;
export type ContentKind = z.infer<typeof ContentKindSchema>;

/** Kind of results a search returns. */
const searchType = enumOf({
  Web: "web",
  News: "news",
  Images: "images",
  Videos: "videos",
  Shopping: "shopping",
  Jobs: "jobs",
  Places: "places",
} as const);
export const SearchType = searchType.values;
export const SearchTypeSchema = searchType.schema;
export type SearchType = z.infer<typeof SearchTypeSchema>;

/** Only results published within this window. */
const recency = enumOf({ Hour: "hour", Day: "day", Week: "week", Month: "month", Year: "year" } as const);
export const Recency = recency.values;
export const RecencySchema = recency.schema;
export type Recency = z.infer<typeof RecencySchema>;

const device = enumOf({ Desktop: "desktop", Mobile: "mobile" } as const);
export const Device = device.values;
export const DeviceSchema = device.schema;
export type Device = z.infer<typeof DeviceSchema>;

/** fast: first source that answers. thorough: ask every capable source and merge. */
const searchMode = enumOf({ Fast: "fast", Thorough: "thorough" } as const);
export const SearchMode = searchMode.values;
export const SearchModeSchema = searchMode.schema;
export type SearchMode = z.infer<typeof SearchModeSchema>;

/** Order of paper results. */
const paperSort = enumOf({ Relevance: "relevance", Citations: "citations", Newest: "newest" } as const);
export const PaperSort = paperSort.values;
export const PaperSortSchema = paperSort.schema;
export type PaperSort = z.infer<typeof PaperSortSchema>;
