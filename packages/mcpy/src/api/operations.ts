/**
 * The three operations, written against the engine. Pure mapping: engine
 * results in, public result objects out. No provider leaves this module.
 */

import type { z } from "zod";
import { clip, grepLines, paginate } from "../content/text.js";
import { assertPublicHttpUrl } from "../http/url.js";
import type { CallScope, Engine, Served } from "../engine/engine.js";
import {
  FetchResultSchema,
  GrepResultSchema,
  SearchResultSchema,
  type FetchInputSchema,
  type FetchResult,
  type GrepInputSchema,
  type GrepResult,
  type ResultMeta,
  type SearchInputSchema,
  type SearchResult,
} from "../schemas.js";
import type { UserAgentProfile } from "../enums.js";

/** Grep output is capped separately: matches with context can balloon. */
export const MAX_GREP_OUTPUT_CHARS = 20_000;
/** Some providers return whole markdown sections as snippets. */
export const MAX_SNIPPET_CHARS = 400;

function meta(served: Served<unknown>, startedAt: number): ResultMeta {
  return { cache: served.cache, latency_ms: Date.now() - startedAt, attempts: served.attempts };
}

export async function fetchOp(
  engine: Engine,
  input: z.infer<typeof FetchInputSchema>,
  defaultUserAgent: UserAgentProfile,
  scope: CallScope,
): Promise<{ result: FetchResult; served: Served<unknown> }> {
  const startedAt = Date.now();
  const url = assertPublicHttpUrl(input.url).toString();
  const served = await engine.page({ url, format: input.format, userAgent: input.user_agent ?? defaultUserAgent }, input.fresh, scope);
  const page = served.value;
  const { chunk, total, end, hasMore } = paginate(page.content, input.start_index, input.max_length);
  const result = FetchResultSchema.parse({
    url: page.url,
    final_url: page.finalUrl,
    title: page.title,
    status: page.status,
    format: page.format,
    content: chunk,
    start_index: input.start_index,
    end_index: end,
    total_length: total,
    next_index: hasMore ? end : undefined,
    truncated: hasMore,
    meta: meta(served, startedAt),
  });
  return { result, served };
}

export async function grepOp(
  engine: Engine,
  input: z.infer<typeof GrepInputSchema>,
  defaultUserAgent: UserAgentProfile,
  scope: CallScope,
): Promise<{ result: GrepResult; served: Served<unknown> }> {
  const startedAt = Date.now();
  const url = assertPublicHttpUrl(input.url).toString();
  const served = await engine.page({ url, format: input.format, userAgent: input.user_agent ?? defaultUserAgent }, input.fresh, scope);
  const lines = served.value.content.split("\n");
  const grep = grepLines(lines, input.pattern, input.context_lines, input.max_matches);
  const truncated = grep.output.length > MAX_GREP_OUTPUT_CHARS;
  const result = GrepResultSchema.parse({
    url: served.value.url,
    final_url: served.value.finalUrl,
    matches: grep.matches,
    capped: grep.capped,
    total_lines: lines.length,
    output: truncated ? clip(grep.output, MAX_GREP_OUTPUT_CHARS) : grep.output,
    truncated,
    meta: meta(served, startedAt),
  });
  return { result, served };
}

export async function searchOp(
  engine: Engine,
  input: z.infer<typeof SearchInputSchema>,
  scope: CallScope,
): Promise<{ result: SearchResult; served: Served<unknown> }> {
  const startedAt = Date.now();
  const served = await engine.search({ query: input.query, limit: input.limit }, input.fresh, scope);
  const result = SearchResultSchema.parse({
    query: input.query,
    results: served.value.map((hit) => ({
      title: clip(hit.title.trim(), MAX_SNIPPET_CHARS),
      url: hit.url,
      snippet: clip(hit.snippet.replace(/\s+/g, " ").trim(), MAX_SNIPPET_CHARS),
    })),
    meta: meta(served, startedAt),
  });
  return { result, served };
}
