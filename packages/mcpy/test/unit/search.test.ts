import { describe, expect, it } from "vitest";
import {
  CacheStatus,
  ErrorCode,
  FetchInputSchema,
  GrepInputSchema,
  McpyError,
  Recency,
  SearchInputSchema,
  SearchMode,
  SearchType,
} from "mcpy";
import type { SearchCapabilities } from "mcpy/providers";
import { mergeRanked, resultKey } from "../../src/engine/merge.js";
import { ALL_SEARCH, fakeSearch, mentionsProvider, testMcpy } from "../helpers.js";

const hit = (n: number, extra = {}) => ({ url: `https://site${n}.example/page`, title: `Result ${n}`, snippet: `about ${n}`, ...extra });
const WEB_ONLY: SearchCapabilities = { ...ALL_SEARCH, types: [SearchType.Web], recency: false, sites: false, language: false, maxDepth: 20 };

describe("search routing", () => {
  it("routes a type only to sources that support it", async () => {
    const webOnly = fakeSearch("web-only", [hit(1)], 0, WEB_ONLY);
    const everything = fakeSearch("all", [hit(2)]);
    const { mcpy } = testMcpy({ search: [webOnly, everything] });
    const r = await mcpy.search({ query: "q", type: SearchType.News });
    expect(r.results.map((h) => h.url)).toEqual([hit(2).url]);
    expect(webOnly.calls).toBe(0);
  });

  it("explains unsupported requests by capability, never by provider", async () => {
    const { mcpy } = testMcpy({ search: [fakeSearch("firecrawl", [hit(1)], 0, WEB_ONLY)] });
    for (const input of [{ type: SearchType.Shopping }, { recency: Recency.Day }, { sites: ["a.com"] }, { page: 5, max_results: 10 }]) {
      const err = (await mcpy.search({ query: "q", ...input }).catch((e) => e)) as McpyError;
      expect(err.code, JSON.stringify(input)).toBe(ErrorCode.InvalidInput);
      expect(err.details?.join(" ")).toMatch(/unsupported/);
      expect(mentionsProvider(err.toJSON())).toBe(false);
    }
  });

  it("treats country, language and device as hints, not requirements", async () => {
    const p = fakeSearch("p", [hit(1)], 0, { ...WEB_ONLY, country: false, language: false, device: false });
    const { mcpy } = testMcpy({ search: [p] });
    const r = await mcpy.search({ query: "q", country: "FR", language: "FR", device: "mobile" });
    expect(r.results).toHaveLength(1);
    expect(p.requests[0]).toMatchObject({ country: "fr", language: "fr", device: "mobile" });
  });

  it("normalizes and passes every filter to the source", async () => {
    const p = fakeSearch("p", [hit(1)]);
    const { mcpy } = testMcpy({ search: [p] });
    await mcpy.search({ query: "q", type: SearchType.Jobs, max_results: 5, page: 3, recency: Recency.Week, sites: ["Docs.Example.COM"] });
    expect(p.requests[0]).toEqual({ query: "q", type: "jobs", limit: 5, page: 3, recency: "week", sites: ["docs.example.com"], country: undefined, language: undefined, device: undefined, excludeSites: undefined });
  });

  it("rejects sites together with exclude_sites, and malformed codes", async () => {
    const { mcpy } = testMcpy({ search: [fakeSearch("p", [])] });
    for (const bad of [{ sites: ["a.com"], exclude_sites: ["b.com"] }, { country: "usa" }, { sites: ["not a host"] }]) {
      expect(((await mcpy.search({ query: "q", ...bad }).catch((e) => e)) as McpyError).code, JSON.stringify(bad)).toBe(ErrorCode.InvalidInput);
    }
  });
});

describe("thorough mode", () => {
  it("merges sources, counts agreement and ranks agreed results first", async () => {
    const a = fakeSearch("a", [hit(1), hit(2), hit(3)]);
    const b = fakeSearch("b", [hit(3, { date: "2026-10-01" }), hit(4), { ...hit(1), url: "https://www.site1.example/page/?utm_source=x" }]);
    const { mcpy } = testMcpy({ search: [a, b] });
    const r = await mcpy.search({ query: "q", mode: SearchMode.Thorough });
    expect(a.calls + b.calls).toBe(2);
    const byUrl = Object.fromEntries(r.results.map((h) => [resultKey(h.url), h]));
    expect(byUrl["site1.example/page"].sources).toBe(2);
    expect(byUrl["site3.example/page"]).toMatchObject({ sources: 2, date: "2026-10-01" });
    expect(r.results.slice(0, 2).every((h) => h.sources === 2)).toBe(true);
    expect(r.results).toHaveLength(4);
  });

  it("returns what it has when one source fails, and fails only when all do", async () => {
    const { mcpy } = testMcpy({ search: [fakeSearch("ok", [hit(1)]), fakeSearch("down", new Error("boom"))] });
    expect((await mcpy.search({ query: "q", mode: SearchMode.Thorough })).results).toHaveLength(1);
    const { mcpy: dead } = testMcpy({ search: [fakeSearch("x", new Error("a")), fakeSearch("y", new Error("b"))] });
    expect(((await dead.search({ query: "q", mode: SearchMode.Thorough }).catch((e) => e)) as McpyError).code).toBe(ErrorCode.UpstreamFailed);
  });

  it("fast mode asks one source and still dedupes", async () => {
    const a = fakeSearch("a", [hit(1), { ...hit(1), url: "https://site1.example/page/" }]);
    const b = fakeSearch("b", [hit(2)]);
    const { mcpy } = testMcpy({ search: [a, b] });
    const r = await mcpy.search({ query: "q" });
    expect(b.calls).toBe(0);
    expect(r.results).toEqual([{ ...hit(1), sources: 1 }]);
  });
});

describe("search cache", () => {
  it("keys on every parameter, including mode and type", async () => {
    const p = fakeSearch("p", [hit(1)]);
    const { mcpy } = testMcpy({ search: [p] });
    await mcpy.search({ query: "q" });
    expect((await mcpy.search({ query: "Q" })).meta.cache).toBe(CacheStatus.Hit);
    await mcpy.search({ query: "q", type: SearchType.News });
    await mcpy.search({ query: "q", mode: SearchMode.Thorough });
    await mcpy.search({ query: "q", page: 2 });
    await mcpy.search({ query: "q", country: "de" });
    expect(p.calls).toBe(5);
  });
});

describe("rank fusion", () => {
  it("normalizes URLs: scheme, www, trailing slash, fragment and tracking", () => {
    expect(resultKey("https://www.A.example/x/?utm_source=1&b=2#top")).toBe("a.example/x?b=2");
    expect(resultKey("http://a.example/x?b=2")).toBe("a.example/x?b=2");
  });

  it("caps the merged list and never double counts one source", () => {
    const merged = mergeRanked([[hit(1), hit(1), hit(2)], [hit(3)]], 2);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ url: hit(1).url, sources: 1 });
  });
});

describe("regression: input schemas are publishable as JSON Schema", () => {
  // MCP publishes input schemas as JSON Schema; zod transforms cannot be
  // represented, which once broke web_search registration.
  it.each([
    ["fetch", FetchInputSchema],
    ["grep", GrepInputSchema],
    ["search", SearchInputSchema],
  ])("%s input converts to JSON Schema", (_name, schema) => {
    expect(() => schema.toJSONSchema()).not.toThrow();
  });
});
