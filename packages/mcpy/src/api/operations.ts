/**
 * The three operations, written against the engine. Pure mapping: engine
 * results in, public result objects out. No provider leaves this module.
 */

import type { z } from "zod";
import { clip, grepLines, paginate } from "../content/text.js";
import type { CallScope, Engine, PagePolicy, Served } from "../engine/engine.js";
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
import { CacheStatus, ErrorCode, GrepMode, type UserAgentProfile } from "../enums.js";
import { McpyError } from "../errors.js";
import { pageMaxAgeOf, pageRequestOf } from "./page-input.js";
import { runScript, scriptTip, type ScriptRunner } from "./script.js";
import type { MergedPage } from "../engine/merge.js";
import { pageVersion } from "../engine/pins.js";
import type { FetchedPage, PageRequest } from "../providers/types.js";
import type { SearchHit } from "../schemas.js";

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
  scripts?: ScriptRunner,
): Promise<{ result: FetchResult; served: Served<unknown>; outputChars: number }> {
  const startedAt = Date.now();
  const req = pageRequestOf(input, defaultUserAgent);
  const policy = { freeOnly: input.free_only === true };
  const served = input.version ? await servePinned(engine, req, input.version, scope, policy) : await engine.page(req, scope, pageMaxAgeOf(input), policy);
  const page = served.value;
  const content = input.script
    ? await runScript(scripts, input.script, { url: page.url, final_url: page.finalUrl, status: page.status, title: page.title, content: page.content })
    : page.content;
  const { chunk, total, end, hasMore } = paginate(content, input.offset, input.max_chars);
  const version = input.version ?? (hasMore ? await engine.pinPage(req, served, scope) : undefined);
  const result = FetchResultSchema.parse({
    url: page.url,
    final_url: page.finalUrl,
    title: page.title,
    status: page.status,
    format: page.format,
    content: chunk,
    offset: input.offset,
    total_chars: total,
    next_offset: hasMore ? end : undefined,
    version,
    tip: input.script ? undefined : scriptTip(total),
    meta: meta(served, startedAt),
  });
  return { result, served, outputChars: result.content.length };
}

/** The copy of a page that earlier parts came from. */
async function servePinned(engine: Engine, req: PageRequest, version: string, scope: CallScope, policy: PagePolicy): Promise<Served<FetchedPage>> {
  const pinned = await engine.pinnedPage(req, version, scope);
  if (pinned) return { value: pinned.page, cache: CacheStatus.Hit, attempts: 0, provider: pinned.provider };
  // The pin may not have reached this location yet; the shared entry may still be that copy.
  const served = await engine.page(req, scope, Number.MAX_SAFE_INTEGER, policy);
  if ((await pageVersion(served.value)) === version) return served;
  throw new McpyError(ErrorCode.VersionExpired, "the copy of this page the earlier parts came from is gone; fetch it again from offset 0 without version");
}

export async function grepOp(
  engine: Engine,
  input: z.infer<typeof GrepInputSchema>,
  defaultUserAgent: UserAgentProfile,
  scope: CallScope,
): Promise<{ result: GrepResult; served: Served<unknown>; outputChars: number }> {
  const startedAt = Date.now();
  const served = await engine.page(pageRequestOf(input, defaultUserAgent), scope, pageMaxAgeOf(input), { freeOnly: input.free_only === true });
  const lines = served.value.content.split("\n");
  const grep = grepLines(lines, input.pattern, input.context, input.max_matches, input.literal ? GrepMode.Literal : GrepMode.Regex);
  const truncated = grep.output.length > MAX_GREP_OUTPUT_CHARS;
  const result = GrepResultSchema.parse({
    url: served.value.url,
    final_url: served.value.finalUrl,
    matches: grep.matches,
    more_matches: grep.capped,
    total_lines: lines.length,
    output: truncated ? clip(grep.output, MAX_GREP_OUTPUT_CHARS) : grep.output,
    truncated,
    meta: meta(served, startedAt),
  });
  return { result, served, outputChars: result.output.length };
}

/** Clean a merged result for output: collapse whitespace, clip long text. */
function toHit(hit: MergedPage): SearchHit {
  const text = (v: string | undefined) => (v ? clip(v.replace(/\s+/g, " ").trim(), MAX_SNIPPET_CHARS) : undefined);
  return compact({
    title: text(hit.title) ?? hit.url,
    url: hit.url,
    snippet: text(hit.snippet) ?? "",
    date: text(hit.date),
    publisher: text(hit.publisher),
    image: hit.image,
    price: text(hit.price),
    rating: hit.rating,
    reviews: hit.reviews,
    address: text(hit.address),
    phone: text(hit.phone),
    company: text(hit.company),
    location: text(hit.location),
    duration: text(hit.duration),
    sources: hit.sources,
  });
}

/** Drop undefined fields so results only carry what the source returned. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export async function searchOp(
  engine: Engine,
  input: z.infer<typeof SearchInputSchema>,
  scope: CallScope,
): Promise<{ result: SearchResult; served: Served<unknown>; outputChars: number }> {
  const startedAt = Date.now();
  const served = await engine.search(
    {
      query: input.query,
      type: input.type,
      limit: input.max_results,
      page: input.page,
      country: input.country?.toLowerCase(),
      language: input.language?.toLowerCase(),
      recency: input.recency,
      device: input.device,
      sites: input.sites?.map((s) => s.toLowerCase()),
      excludeSites: input.exclude_sites?.map((s) => s.toLowerCase()),
    },
    input.mode,
    scope,
    input.max_age,
  );
  const result = SearchResultSchema.parse({
    query: input.query,
    type: input.type,
    page: input.page,
    results: served.value.map(toHit),
    meta: meta(served, startedAt),
  });
  const outputChars = result.results.reduce((n, r) => n + r.title.length + r.url.length + r.snippet.length, 0);
  return { result, served, outputChars };
}
