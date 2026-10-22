/**
 * Tool operations, shared by both front doors (MCP and the REST API). Each
 * has one input schema and returns structured data; the adapters only format.
 */

import { z } from "zod";
import type { Attempt } from "../core/chain";
import type { WebService } from "../core/service";
import { grepLines, paginate } from "../lib/text";

const provider = z.string().optional().describe("Force one provider id instead of the fallback chain (see web_providers)");
const fresh = z.boolean().default(false).describe("Bypass the cache and fetch again");
const format = z.enum(["markdown", "html"]).default("markdown");

export const fetchInput = z.object({
  url: z.string().url().describe("URL to fetch"),
  format,
  start_index: z.number().int().min(0).default(0).describe("Character offset to start from"),
  max_length: z.number().int().min(100).max(100_000).default(10_000).describe("Maximum characters to return"),
  provider,
  fresh,
});

export const grepInput = z.object({
  url: z.string().url().describe("URL to fetch"),
  pattern: z.string().min(1).describe("Regex pattern (case-insensitive)"),
  context_lines: z.number().int().min(0).max(20).default(3),
  max_matches: z.number().int().min(1).max(200).default(20),
  format,
  provider,
  fresh,
});

export const searchInput = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).default(10),
  provider,
  fresh,
});

const SNIPPET_MAX = 400;
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

interface Source {
  provider: string;
  cached: boolean;
  attempts: Attempt[];
}

export interface FetchOutput extends Source {
  url: string;
  final_url: string;
  title?: string;
  status: number;
  content: string;
  start_index: number;
  end_index: number;
  total_length: number;
  next_index?: number;
}

export interface GrepOutput extends Source {
  url: string;
  final_url: string;
  matches: number;
  capped: boolean;
  total_lines: number;
  output: string;
}

export interface SearchOutput extends Source {
  query: string;
  results: { title: string; url: string; snippet: string }[];
}

export async function runFetch(web: WebService, tool: string, input: z.infer<typeof fetchInput>): Promise<FetchOutput> {
  const s = await web.fetchPage(tool, input.url, { format: input.format, provider: input.provider, fresh: input.fresh });
  const { chunk, total, end, hasMore } = paginate(s.value.content, input.start_index, input.max_length);
  return {
    url: s.value.url,
    final_url: s.value.finalUrl,
    title: s.value.title,
    status: s.value.status,
    provider: s.provider,
    cached: s.cached,
    attempts: s.attempts,
    content: chunk,
    start_index: input.start_index,
    end_index: end,
    total_length: total,
    next_index: hasMore ? end : undefined,
  };
}

export async function runGrep(web: WebService, tool: string, input: z.infer<typeof grepInput>): Promise<GrepOutput> {
  const s = await web.fetchPage(tool, input.url, { format: input.format, provider: input.provider, fresh: input.fresh });
  const lines = s.value.content.split("\n");
  const r = grepLines(lines, input.pattern, input.context_lines, input.max_matches);
  return {
    url: s.value.url,
    final_url: s.value.finalUrl,
    provider: s.provider,
    cached: s.cached,
    attempts: s.attempts,
    matches: r.matches,
    capped: r.capped,
    total_lines: lines.length,
    output: r.output,
  };
}

export async function runSearch(web: WebService, tool: string, input: z.infer<typeof searchInput>): Promise<SearchOutput> {
  const s = await web.search(tool, input.query, { limit: input.limit, provider: input.provider, fresh: input.fresh });
  // Some providers return whole markdown sections as "snippets"; keep them short.
  const results = s.value.map((h) => ({ ...h, snippet: clip(h.snippet.replace(/\s+/g, " ").trim(), SNIPPET_MAX) }));
  return { query: input.query, provider: s.provider, cached: s.cached, attempts: s.attempts, results };
}
