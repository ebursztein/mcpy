import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { WebService } from "../core/service";
import { fetchInput, grepInput, runFetch, runGrep, runSearch, searchInput } from "./operations";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): ToolResult => ({ content: [{ type: "text", text: t }], isError: true });
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

function sourceLine(s: { provider: string; cached: boolean; attempts: { provider: string; outcome: string }[] }): string {
  const via = s.cached ? `${s.provider} (cached)` : s.provider;
  const tried = s.attempts.length > 1 ? ` after ${s.attempts.map((a) => `${a.provider}:${a.outcome}`).join(" -> ")}` : "";
  return `Source: ${via}${tried}`;
}

/** MCP adapter: same operations as the REST API, formatted as text for LLMs. */
export function registerWebTools(server: McpServer, web: WebService): void {
  server.registerTool(
    "web_fetch",
    {
      title: "Web Fetch",
      description:
        "Fetch a web page as clean markdown (or raw HTML). Falls back across providers automatically (direct fetch, headless browser, then scraping services) when a page is blocked or JS-rendered. Results are cached. Paginate long pages with start_index/max_length.",
      inputSchema: fetchInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const r = await runFetch(web, "web_fetch", input);
        const header = [
          `URL: ${r.final_url}`,
          r.title ? `Title: ${r.title}` : "",
          `Status: ${r.status || "unknown"}`,
          sourceLine(r),
          `Showing: ${r.start_index}-${r.end_index} of ${r.total_length} chars`,
          r.next_index !== undefined ? `More: call again with start_index=${r.next_index}` : "",
          "---",
        ].filter(Boolean);
        return text(`${header.join("\n")}\n${r.content}`);
      } catch (err) {
        return fail(`Fetch failed: ${errMsg(err)}`);
      }
    },
  );

  server.registerTool(
    "web_grep",
    {
      title: "Web Grep",
      description:
        "Fetch a page (same providers and cache as web_fetch) and return only lines matching a case-insensitive regex, with context. Much cheaper on context than reading the whole page when you know what you are looking for.",
      inputSchema: grepInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const r = await runGrep(web, "web_grep", input);
        const header = [
          `URL: ${r.final_url}`,
          sourceLine(r),
          `Matches: ${r.matches}${r.capped ? ` (capped at ${input.max_matches})` : ""} in ${r.total_lines} lines`,
          "---",
        ];
        return text(`${header.join("\n")}\n${r.matches ? r.output : `No matches for /${input.pattern}/i`}`);
      } catch (err) {
        return fail(`Grep failed: ${errMsg(err)}`);
      }
    },
  );

  server.registerTool(
    "web_search",
    {
      title: "Web Search",
      description: "Search the web. Returns titles, URLs and snippets; use web_fetch to read a result. Falls back across search providers; results are cached briefly.",
      inputSchema: searchInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const r = await runSearch(web, "web_search", input);
        const body = r.results.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ""}`).join("\n\n");
        return text(`Query: ${r.query}\n${sourceLine(r)}\nResults: ${r.results.length}\n---\n${body || "No results."}`);
      } catch (err) {
        return fail(`Search failed: ${errMsg(err)}`);
      }
    },
  );

  server.registerTool(
    "web_providers",
    {
      title: "Web Providers",
      description: "List the enabled fetch and search providers in fallback order, and any configured but disabled ones.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => text(JSON.stringify(web.providers(), null, 2)),
  );
}
