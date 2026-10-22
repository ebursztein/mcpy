/**
 * `mcpy/mcp`: mounts the mcpy tools on an MCP server. Takes any McpyApi,
 * so the tools can run in-process (createMcpy) or proxy a hosted server
 * (McpyClient). Results go out as structuredContent plus a readable text.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { ToolName } from "./api/routes.js";
import { toMcpyError } from "./errors.js";
import {
  FetchInputSchema,
  FetchResultSchema,
  GrepInputSchema,
  GrepResultSchema,
  SearchInputSchema,
  SearchResultSchema,
  type FetchResult,
  type GrepResult,
  type McpyApi,
  type SearchHit,
  type SearchResult,
} from "./schemas.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(result: object, text: string): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: result as Record<string, unknown> };
}

function fail(err: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(toMcpyError(err).toJSON()) }], isError: true };
}

function cacheNote(meta: { cache: string; latency_ms: number }): string {
  return `cache: ${meta.cache}, ${meta.latency_ms} ms`;
}

export function renderFetch(r: FetchResult): string {
  const header = [
    `URL: ${r.final_url}`,
    r.title ? `Title: ${r.title}` : "",
    `Status: ${r.status || "unknown"} (${cacheNote(r.meta)})`,
    `Showing ${r.offset}-${r.offset + r.content.length} of ${r.total_chars} chars`,
    r.next_offset !== undefined ? `More: call again with offset=${r.next_offset}` : "",
  ].filter(Boolean);
  return `${header.join("\n")}\n---\n${r.content}`;
}

export function renderGrep(r: GrepResult, pattern: string): string {
  const head = `URL: ${r.final_url}\nMatches: ${r.matches}${r.more_matches ? " (more exist)" : ""} in ${r.total_lines} lines (${cacheNote(r.meta)})`;
  return `${head}\n---\n${r.matches ? r.output : `No matches for /${pattern}/i`}${r.truncated ? "\n[output truncated]" : ""}`;
}

/** The optional facts of a hit, as one compact line. */
function facts(h: SearchHit): string {
  const parts = [
    h.publisher,
    h.date,
    h.company,
    h.location,
    h.price,
    h.rating !== undefined ? `${h.rating}★${h.reviews !== undefined ? ` (${h.reviews})` : ""}` : undefined,
    h.address,
    h.phone,
    h.duration,
    h.sources > 1 ? `${h.sources} sources` : undefined,
  ].filter(Boolean);
  return parts.length ? `\n   ${parts.join(" · ")}` : "";
}

export function renderSearch(r: SearchResult): string {
  const body = r.results.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${facts(h)}${h.snippet ? `\n   ${h.snippet}` : ""}`).join("\n\n");
  const page = r.page > 1 ? `, page ${r.page}` : "";
  return `Query: ${r.query} (${r.type}${page}; ${cacheNote(r.meta)})\n---\n${body || "No results."}`;
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

export function registerMcpyTools(server: McpServer, api: McpyApi): void {
  server.registerTool(
    ToolName.Fetch,
    {
      title: "Web Fetch",
      description:
        "Fetch a web page as clean markdown (or raw HTML). Handles blocked and JavaScript-heavy pages automatically. Long pages come in parts: pass next_offset as offset to continue.",
      inputSchema: FetchInputSchema,
      outputSchema: FetchResultSchema,
      annotations: READ_ONLY,
    },
    async (input) => api.fetch(input).then((r) => ok(r, renderFetch(r)), fail),
  );

  server.registerTool(
    ToolName.Grep,
    {
      title: "Web Grep",
      description:
        "Fetch a page and return only the lines matching a case-insensitive regex, with context. Far cheaper on context than reading a whole page when you know what you are looking for.",
      inputSchema: GrepInputSchema,
      outputSchema: GrepResultSchema,
      annotations: READ_ONLY,
    },
    async (input) => api.grep(input).then((r) => ok(r, renderGrep(r, input.pattern)), fail),
  );

  server.registerTool(
    ToolName.Search,
    {
      title: "Web Search",
      description:
        "Search the web, news, images, videos, shopping, jobs or places. Filter by country, language, recency (hour/day/week/month/year) and sites. mode=thorough combines several sources for better coverage. Read a result with web_fetch.",
      inputSchema: SearchInputSchema,
      outputSchema: SearchResultSchema,
      annotations: READ_ONLY,
    },
    async (input) => api.search(input).then((r) => ok(r, renderSearch(r)), fail),
  );
}
