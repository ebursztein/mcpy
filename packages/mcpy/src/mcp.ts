/**
 * `mcpy/mcp`: mounts the mcpy tools on an MCP server. Takes any McpyApi,
 * so the tools can run in-process (createMcpy) or proxy a hosted server
 * (McpyClient). Results go out as structuredContent plus a readable text.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { ToolName } from "./api/routes.js";
import { toMcpyError } from "./errors.js";
import { registerCryptoTools } from "./mcp-crypto.js";
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
import { PaperSearchInputSchema, PaperSearchResultSchema, type PaperSearchResult } from "./schemas-papers.js";
import {
  ShoppingItemInputSchema,
  ShoppingItemResultSchema,
  ShoppingSearchInputSchema,
  ShoppingSearchResultSchema,
  type Listing,
  type ShoppingItemResult,
  type ShoppingSearchResult,
} from "./services/shopping/schema.js";

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
    r.next_offset !== undefined ? `More: call again with offset=${r.next_offset} version=${r.version}` : "",
    r.tip ? `Tip: ${r.tip}` : "",
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

function listingLine(l: Listing): string {
  const price = l.price ? `${l.price.amount} ${l.price.currency}` : "no price";
  const facts = [
    l.marketplace,
    price,
    l.format,
    l.auction?.bids !== undefined ? `${l.auction.bids} bids` : undefined,
    l.card_condition ?? l.condition,
    l.language,
    l.seller?.name,
    l.posted_at ?? l.posted_text,
    l.status && l.status !== "available" ? l.status : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${l.title}\n   ${facts}\n   ${l.url}`;
}

export function renderShopping(r: ShoppingSearchResult): string {
  const body = r.results.map((l, i) => `${i + 1}. ${listingLine(l)}`).join("\n\n");
  const sites = r.marketplaces
    .map((m) => `${m.marketplace}: ${m.status}${m.failure ? ` (${m.failure})` : ""}${m.results ? `, ${m.results}` : ""}${m.ignored?.length ? `, ignored ${m.ignored.join("/")}` : ""}`)
    .join("; ");
  const more = r.next_cursor ? "\nMore: pass next_cursor as cursor." : "";
  return `Shopping: ${r.query} (${cacheNote(r.meta)})\nSites: ${sites}\n---\n${body || "No listings."}${more}`;
}

export function renderShoppingItem(r: ShoppingItemResult): string {
  const details = r.details ? Object.entries(r.details).map(([k, v]) => `${k}: ${v}`).join("\n") : "";
  return `${listingLine(r as Listing)}${r.description ? `\n---\n${r.description}` : ""}${details ? `\n---\n${details}` : ""}`;
}

export function renderPapers(r: PaperSearchResult): string {
  const body = r.results
    .map((p, i) => {
      const authors = p.authors.length ? `${p.authors.slice(0, 3).join(", ")}${p.authors_total > 3 ? " et al." : ""}` : "";
      const facts = [authors, p.year, p.venue, p.citations !== undefined ? `${p.citations} citations` : undefined, p.sources > 1 ? `${p.sources} sources` : undefined]
        .filter((x) => x !== undefined && x !== "")
        .join(" · ");
      const links = [p.url, p.pdf_url && p.pdf_url !== p.url ? `PDF: ${p.pdf_url}` : undefined].filter(Boolean).join("\n   ");
      return `${i + 1}. ${p.title}\n   ${facts}\n   ${links}${p.abstract ? `\n   ${p.abstract}` : ""}`;
    })
    .join("\n\n");
  const page = r.page > 1 ? `, page ${r.page}` : "";
  const about = [r.query, r.author ? `by ${r.author}` : undefined].filter(Boolean).join(" ");
  return `Papers: ${about} (${r.sort}${page}; ${cacheNote(r.meta)})\n---\n${body || "No papers found."}`;
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

export function registerMcpyTools(server: McpServer, api: McpyApi): void {
  server.registerTool(
    ToolName.Fetch,
    {
      title: "Web Fetch",
      description:
        "Fetch a web page as clean markdown (or raw HTML). Handles blocked pages automatically. For pages that load their content with JavaScript (an app shell, prices missing), pass render: true, and wait_ms if it needs time. For APIs, pass method (POST, PUT, PATCH, DELETE, HEAD) with a body (JSON or form) and headers; a write reaches the site every time unless you pass max_age. Long pages come in parts: pass next_offset as offset and the version to continue, or pass script to run JavaScript on the whole page and get back only what it returns.",
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

  server.registerTool(
    ToolName.Papers,
    {
      title: "Paper Search",
      description:
        "Search scholarly papers (journals, conferences, arXiv preprints). Returns title, authors, year, venue, citations, abstract and links, including a free PDF when one exists. Filter by author, year range or open access (the query is optional when an author is given); sort by relevance, citations or newest. mode=thorough combines several indexes.",
      inputSchema: PaperSearchInputSchema,
      outputSchema: PaperSearchResultSchema,
      annotations: READ_ONLY,
    },
    async (input) => api.papers(input).then((r) => ok(r, renderPapers(r)), fail),
  );

  server.registerTool(
    ToolName.Shopping,
    {
      title: "Shopping Search",
      description:
        "Search marketplaces, classifieds, auction sites and trading-card shops (eBay by country, Cardmarket, TCGplayer, Yahoo Auctions, Leboncoin, OLX, Vinted and more) and get one listing per row: price and currency as stated, format (fixed price, auction with bids and end time, wanted), condition or card grade, seller, shipping, location, posting time. Card marketplaces return every seller's offer, not the product. Each site reports ok, empty or failed (blocked, redesigned...) and which filters it ignored. Default sort is newest first; min_price is in each site's currency.",
      inputSchema: ShoppingSearchInputSchema,
      outputSchema: ShoppingSearchResultSchema,
      annotations: READ_ONLY,
    },
    async (input) => api.shopping(input).then((r) => ok(r, renderShopping(r)), fail),
  );

  server.registerTool(
    ToolName.ShoppingItem,
    {
      title: "Shopping Item",
      description: "Read one listing from a shopping_search result URL: the same fields plus the full description, all photos and the item specifics, from the listing page's structured data. Not for card marketplaces (Cardmarket, TCGplayer, CardTrader), where shopping_search already returns each seller's offer; sites whose listing pages are app shells may fail.",
      inputSchema: ShoppingItemInputSchema,
      outputSchema: ShoppingItemResultSchema,
      annotations: READ_ONLY,
    },
    async (input) => api.shoppingItem(input).then((r) => ok(r, renderShoppingItem(r)), fail),
  );

  registerCryptoTools(server, api);
}
