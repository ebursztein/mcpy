import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import {
  ErrorBodySchema,
  ErrorCode,
  FetchInputSchema,
  FetchResultSchema,
  GrepInputSchema,
  GrepResultSchema,
  McpyError,
  SearchInputSchema,
  SearchResultSchema,
  ToolName,
  type McpyApi,
} from "mcpy";
import { registerMcpyTools, renderFetch, renderGrep, renderSearch } from "mcpy/mcp";
import { firecrawl, ProviderId } from "mcpy/providers";
import { fakePages, fakeSearch, fixture, mentionsProvider, page, stubFetch, testMcpy } from "../helpers.js";

type Handler = (input: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }>;
type Registered = { name: string; config: { title: string; description: string; inputSchema: unknown; outputSchema: unknown; annotations: unknown }; handler: Handler };

function capture(api: McpyApi): Map<string, Registered> {
  const tools = new Map<string, Registered>();
  const server = { registerTool: (name: string, config: Registered["config"], handler: Handler) => void tools.set(name, { name, config, handler }) };
  registerMcpyTools(server as unknown as McpServer, api);
  return tools;
}

const LINES = Array.from({ length: 30 }, (_, i) => (i === 12 ? "the circuit breaker opens after five failures" : `filler line ${i} with enough words to count`)).join("\n");

function sdk() {
  const pages = fakePages(ProviderId.Firecrawl, page({ title: "Breakers", content: LINES, finalUrl: "https://www.example.com/a" }));
  const search = fakeSearch(ProviderId.BrightData, [{ title: "Breakers", url: "https://example.com/a", snippet: "about breakers" }]);
  return testMcpy({ pages: [pages], search: [search] }).mcpy;
}

const failing: McpyApi = {
  fetch: () => Promise.reject(new McpyError(ErrorCode.UpstreamFailed, "every source failed for this request", ["error (timed out)"])),
  grep: () => Promise.reject(new Error("unexpected crash")),
  search: () => Promise.reject(new McpyError(ErrorCode.RateLimited, "slow down")),
};

describe("registerMcpyTools registration", () => {
  const tools = capture(sdk());

  it("registers exactly web_fetch, web_grep and web_search", () => {
    expect([...tools.keys()].sort()).toEqual([ToolName.Fetch, ToolName.Grep, ToolName.Search].sort());
  });

  it.each([
    [ToolName.Fetch, FetchInputSchema, FetchResultSchema],
    [ToolName.Grep, GrepInputSchema, GrepResultSchema],
    [ToolName.Search, SearchInputSchema, SearchResultSchema],
  ])("%s has its input and output schemas and read-only annotations", (name, input, output) => {
    const { config } = tools.get(name)!;
    expect(config.inputSchema).toBe(input);
    expect(config.outputSchema).toBe(output);
    expect(config.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    expect(config.title.length).toBeGreaterThan(0);
    expect(config.description.length).toBeGreaterThan(20);
  });

  it("never mentions a provider in titles, descriptions or schemas", () => {
    for (const { config } of tools.values()) {
      const schemas = [config.inputSchema, config.outputSchema].map((s) => (s as typeof FetchInputSchema).toJSONSchema());
      expect(mentionsProvider([config.title, config.description, schemas])).toBe(false);
    }
  });
});

describe("registerMcpyTools handlers", () => {
  it("web_fetch returns structuredContent matching the output schema and the rendered text", async () => {
    const out = await capture(sdk()).get(ToolName.Fetch)!.handler({ url: "https://example.com/a", max_length: 200 });
    expect(out.isError).toBeUndefined();
    const result = FetchResultSchema.parse(out.structuredContent);
    expect(result).toMatchObject({ final_url: "https://www.example.com/a", title: "Breakers", start_index: 0, end_index: 200, truncated: true, next_index: 200 });
    expect(out.content).toEqual([{ type: "text", text: renderFetch(result) }]);
    expect(out.content[0].text).toContain("More: call again with start_index=200");
    expect(mentionsProvider(out)).toBe(false);
  });

  it("web_grep renders with the pattern", async () => {
    const out = await capture(sdk()).get(ToolName.Grep)!.handler({ url: "https://example.com/a", pattern: "circuit", context_lines: 1 });
    const result = GrepResultSchema.parse(out.structuredContent);
    expect(result.matches).toBe(1);
    expect(out.content[0].text).toBe(renderGrep(result, "circuit"));
    expect(out.content[0].text).toContain("circuit breaker opens");
    expect(mentionsProvider(out)).toBe(false);
  });

  it("web_search lists numbered results", async () => {
    const out = await capture(sdk()).get(ToolName.Search)!.handler({ query: "breakers" });
    const result = SearchResultSchema.parse(out.structuredContent);
    expect(out.content[0].text).toBe(renderSearch(result));
    expect(out.content[0].text).toContain("1. Breakers\n   https://example.com/a\n   about breakers");
    expect(mentionsProvider(out)).toBe(false);
  });

  it("returns isError with the McpyError JSON body", async () => {
    const out = await capture(failing).get(ToolName.Fetch)!.handler({ url: "https://example.com/a" });
    expect(out.isError).toBe(true);
    expect(out.structuredContent).toBeUndefined();
    expect(ErrorBodySchema.parse(JSON.parse(out.content[0].text))).toEqual({
      error: { code: ErrorCode.UpstreamFailed, message: "every source failed for this request", details: ["error (timed out)"] },
    });
  });

  it("maps unknown errors to internal and keeps codes like rate_limited", async () => {
    const tools = capture(failing);
    const grep = await tools.get(ToolName.Grep)!.handler({ url: "https://example.com/a", pattern: "x" });
    expect(JSON.parse(grep.content[0].text)).toEqual({ error: { code: ErrorCode.Internal, message: "unexpected crash" } });
    const search = await tools.get(ToolName.Search)!.handler({ query: "x" });
    expect(JSON.parse(search.content[0].text).error.code).toBe(ErrorCode.RateLimited);
  });

  it("does not leak provider ids when every provider fails", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages(ProviderId.Direct, new Error("direct exploded")), fakePages(ProviderId.BrightData, new Error("boom"))] });
    const out = await capture(mcpy).get(ToolName.Fetch)!.handler({ url: "https://example.com/a" });
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content[0].text).error.code).toBe(ErrorCode.UpstreamFailed);
    expect(JSON.parse(out.content[0].text).error.details).toEqual(["error (internal)", "error (internal)"]);
    expect(mentionsProvider(out)).toBe(false);
  });

  // Upstream error text (Firecrawl's real 402 links firecrawl.dev/pricing) must stay in telemetry only.
  it("does not leak the provider through upstream error text (Firecrawl 402)", async () => {
    const { fetch } = stubFetch(() => new Response(fixture("firecrawl-error-402.json"), { status: 402 }));
    const { mcpy } = testMcpy({ pages: [firecrawl({ apiKey: "fc-test" })], fetch });
    const out = await capture(mcpy).get(ToolName.Fetch)!.handler({ url: "https://example.com/a" });
    expect(out.isError).toBe(true);
    expect(mentionsProvider(out)).toBe(false);
  });
});

describe("render helpers", () => {
  const meta = { cache: "hit" as const, latency_ms: 3, attempts: 0 };
  it("handle missing title, unknown status, no matches and no results", () => {
    const fetchText = renderFetch({ url: "u", final_url: "u", status: 0, format: "markdown", content: "c", start_index: 0, end_index: 1, total_length: 1, truncated: false, meta });
    expect(fetchText).toBe("URL: u\nStatus: unknown (cache: hit, 3 ms)\nShowing 0-1 of 1 chars\n---\nc");
    const grepText = renderGrep({ url: "u", final_url: "u", matches: 0, capped: false, total_lines: 4, output: "", truncated: true, meta }, "zz");
    expect(grepText).toBe("URL: u\nMatches: 0 in 4 lines (cache: hit, 3 ms)\n---\nNo matches for /zz/i\n[output truncated]");
    expect(renderSearch({ query: "q", results: [], meta })).toBe("Query: q (cache: hit, 3 ms)\n---\nNo results.");
  });
});

describe("real McpServer over an in-memory transport", () => {
  async function connect(api: McpyApi) {
    const server = new McpServer({ name: "mcpy-test", version: "0.0.0" });
    registerMcpyTools(server, api);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, close: () => Promise.all([client.close(), server.close()]) };
  }

  it("lists the three tools with JSON schemas and annotations", async () => {
    const { client, close } = await connect(sdk());
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([ToolName.Fetch, ToolName.Grep, ToolName.Search].sort());
      const fetchTool = tools.find((t) => t.name === ToolName.Fetch)!;
      expect(fetchTool.inputSchema.type).toBe("object");
      expect(fetchTool.inputSchema.required).toEqual(["url"]);
      expect(fetchTool.outputSchema?.type).toBe("object");
      expect(fetchTool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
      expect(mentionsProvider(tools)).toBe(false);
    } finally {
      await close();
    }
  });

  it("calls web_fetch end to end", async () => {
    const { client, close } = await connect(sdk());
    try {
      const out = await client.callTool({ name: ToolName.Fetch, arguments: { url: "https://example.com/a", max_length: 200 } });
      expect(out.isError ?? false).toBe(false);
      const result = FetchResultSchema.parse(out.structuredContent);
      expect(result.final_url).toBe("https://www.example.com/a");
      expect(out.content).toEqual([{ type: "text", text: renderFetch(result) }]);
      expect(mentionsProvider(out)).toBe(false);
    } finally {
      await close();
    }
  });

  it("reports tool errors as isError results", async () => {
    const { client, close } = await connect(failing);
    try {
      const out = await client.callTool({ name: ToolName.Search, arguments: { query: "x" } });
      expect(out.isError).toBe(true);
      const text = (out.content as { type: string; text: string }[])[0].text;
      expect(JSON.parse(text).error.code).toBe(ErrorCode.RateLimited);
    } finally {
      await close();
    }
  });
});
