import { describe, expect, it } from "vitest";
import { CacheStatus, ErrorCode, MAX_ABSTRACT_CHARS, McpyError, PaperSearchInputSchema, PaperSearchResultSchema, PaperSort, SearchMode } from "mcpy";
import { renderPapers } from "mcpy/mcp";
import type { FoundPaper, PaperCapabilities, PaperProvider, PaperRequest } from "mcpy/providers";
import { mergePapers, paperKeys } from "../../src/engine/papers.js";
import { mentionsProvider, testMcpy } from "../helpers.js";

const ALL: PaperCapabilities = { sorts: [PaperSort.Relevance, PaperSort.Citations, PaperSort.Newest], yearFilter: true, openAccessFilter: true, maxDepth: 1_000 };

function index(id: string, papers: FoundPaper[] | Error, capabilities: PaperCapabilities = ALL): PaperProvider & { requests: PaperRequest[] } {
  const requests: PaperRequest[] = [];
  return {
    id,
    costPerCall: 0,
    capabilities,
    requests,
    async searchPapers(req) {
      requests.push(req);
      if (papers instanceof Error) throw papers;
      return papers;
    },
  };
}

const paper = (title: string, over: Partial<FoundPaper> = {}): FoundPaper => ({ title, authors: ["A. Author"], url: `https://x.example/${encodeURIComponent(title)}`, ...over });

describe("paper routing", () => {
  it("skips indexes that cannot sort as asked and explains when none can", async () => {
    const noCitations = index("arxivish", [paper("P")], { ...ALL, sorts: [PaperSort.Relevance, PaperSort.Newest] });
    const full = index("full", [paper("Q", { citations: 9 })]);
    const { mcpy } = testMcpy({ papers: [noCitations, full] });
    const r = await mcpy.papers({ query: "q", sort: PaperSort.Citations });
    expect(r.results.map((p) => p.title)).toEqual(["Q"]);
    expect(noCitations.requests).toHaveLength(0);

    const { mcpy: limited } = testMcpy({ papers: [noCitations] });
    const err = (await limited.papers({ query: "q", sort: PaperSort.Citations }).catch((e) => e)) as McpyError;
    expect(err.code).toBe(ErrorCode.InvalidInput);
    expect(err.details).toEqual(["unsupported: sort citations"]);
    expect(mentionsProvider(err.toJSON())).toBe(false);
  });

  it("passes every filter to the index", async () => {
    const p = index("p", []);
    const { mcpy } = testMcpy({ papers: [p] });
    await mcpy.papers({ query: "q", max_results: 5, page: 2, year_from: 2019, year_to: 2021, open_access: true, sort: PaperSort.Newest });
    expect(p.requests[0]).toEqual({ query: "q", limit: 5, page: 2, yearFrom: 2019, yearTo: 2021, openAccess: true, sort: "newest" });
  });

  it("validates the year range and has a publishable JSON Schema", () => {
    expect(PaperSearchInputSchema.safeParse({ query: "q", year_from: 2022, year_to: 2020 }).success).toBe(false);
    expect(() => PaperSearchInputSchema.toJSONSchema()).not.toThrow();
  });
});

describe("merging papers across indexes", () => {
  it("joins records sharing a DOI, an arXiv id or a title, keeping the most complete data", () => {
    const oa = [paper("Attention Is All You Need", { doi: "10.65215/x", citations: 78_000, venue: undefined })];
    const ax = [paper("Attention is all you need.", { arxivId: "1706.03762", pdfUrl: "https://arxiv.org/pdf/1706.03762", venue: "arXiv" })];
    const s2 = [paper("Attention Is All You Need", { arxivId: "1706.03762", citations: 151_000 })];
    const [merged, ...rest] = mergePapers([oa, ax, s2], 10, PaperSort.Relevance);
    expect(rest).toHaveLength(0);
    expect(merged).toMatchObject({ sources: 3, citations: 151_000, pdfUrl: "https://arxiv.org/pdf/1706.03762", venue: "arXiv", doi: "10.65215/x" });
  });

  it("re-sorts merged results by citations or by date when asked", () => {
    const a = [paper("Old", { citations: 5, published: "2001-01-01" }), paper("New", { citations: 1, published: "2025-05-05" })];
    const b = [paper("Mid", { citations: 50, published: "2015-01-01" })];
    expect(mergePapers([a, b], 3, PaperSort.Citations).map((p) => p.title)).toEqual(["Mid", "Old", "New"]);
    expect(mergePapers([a, b], 3, PaperSort.Newest).map((p) => p.title)).toEqual(["New", "Mid", "Old"]);
  });

  it("builds keys from every identifier", () => {
    expect(paperKeys(paper("A: B!", { doi: "10.1/X", arxivId: "2101.1" }))).toEqual(["title:ab", "doi:10.1/x", "arxiv:2101.1"]);
  });
});

describe("paper_search results", () => {
  it("thorough mode combines indexes; fast mode asks one", async () => {
    const a = index("a", [paper("Shared", { doi: "10.1/s" }), paper("OnlyA")]);
    const b = index("b", [paper("Shared", { doi: "10.1/S" }), paper("OnlyB")]);
    const { mcpy } = testMcpy({ papers: [a, b] });
    const thorough = await mcpy.papers({ query: "q", mode: SearchMode.Thorough });
    expect(thorough.results[0]).toMatchObject({ title: "Shared", sources: 2 });
    expect(thorough.results).toHaveLength(3);
    await mcpy.papers({ query: "other" });
    expect(b.requests).toHaveLength(1); // only thorough reached the second index
  });

  it("caps authors and abstracts, stays schema-valid and provider-free, and caches", async () => {
    const big = paper("Big", { authors: Array.from({ length: 40 }, (_, i) => `Author ${i}`), abstract: "word ".repeat(2_000) });
    const { mcpy } = testMcpy({ papers: [index("p", [big])] });
    const r = await mcpy.papers({ query: "q" });
    expect(PaperSearchResultSchema.parse(r)).toEqual(r);
    expect(r.results[0]).toMatchObject({ authors_total: 40 });
    expect(r.results[0].authors).toHaveLength(10);
    expect(r.results[0].abstract!.length).toBeLessThanOrEqual(MAX_ABSTRACT_CHARS);
    expect(mentionsProvider(r)).toBe(false);
    expect((await mcpy.papers({ query: "q" })).meta.cache).toBe(CacheStatus.Hit);
  });

  it("renders a readable list for MCP", async () => {
    const { mcpy } = testMcpy({ papers: [index("p", [paper("T", { authors: ["A", "B", "C", "D"], year: 2017, citations: 7, pdfUrl: "https://x.example/t.pdf" })])] });
    const text = renderPapers(await mcpy.papers({ query: "q" }));
    expect(text).toContain("1. T\n   A, B, C et al. · 2017 · 7 citations");
    expect(text).toContain("PDF: https://x.example/t.pdf");
  });
});
