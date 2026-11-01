/**
 * Bugs found while checking the agent skill's examples against a live server
 * (2026-10-31). Each names the bug; never delete one.
 */

import { describe, expect, it } from "vitest";
import { PaperSort } from "mcpy";
import type { FoundPaper, PaperCapabilities, PaperProvider } from "mcpy/providers";
import { worksUrl } from "../../src/providers/openalex/index.js";
import { fakeSearch, testMcpy } from "../helpers.js";

const ALL: PaperCapabilities = { sorts: [PaperSort.Relevance, PaperSort.Citations, PaperSort.Newest], yearFilter: true, openAccessFilter: true, authorFilter: true, maxDepth: 1_000, collections: [] };

function paperIndex(id: string, papers: FoundPaper[]): PaperProvider & { calls: number } {
  const p = { id, costPerCall: 0, capabilities: ALL, calls: 0, async searchPapers() { p.calls++; return papers; } };
  return p;
}

const filterOf = (url: string) => new URL(url).searchParams.get("filter") ?? "";

describe("search quality regressions", () => {
  it("a search source that finds nothing no longer ends the search", async () => {
    const empty = fakeSearch("empty", []);
    const full = fakeSearch("full", [{ url: "https://example.com/", title: "Hit", snippet: "" }]);
    const { mcpy } = testMcpy({ search: [empty, full] });
    const r = await mcpy.search({ query: "workers ai", sites: ["blog.cloudflare.com"] });
    expect(r.results.map((h) => h.title)).toEqual(["Hit"]);
    expect(r.meta.attempts).toBe(2);
  });

  it("a paper index that finds nothing no longer ends the paper search", async () => {
    const empty = paperIndex("empty", []);
    const full = paperIndex("full", [{ title: "Found", authors: ["A"], url: "https://example.com/p" }]);
    const { mcpy } = testMcpy({ papers: [empty, full] });
    const r = await mcpy.papers({ query: "q" });
    expect(r.results.map((p) => p.title)).toEqual(["Found"]);
    expect([empty.calls, full.calls]).toEqual([1, 1]);
  });

  it("openalex citation sorts match a short query as a phrase (AlphaFold 3 topped 'diffusion models')", () => {
    const f = filterOf(worksUrl({ query: "diffusion models", limit: 5, page: 1, openAccess: false, sort: PaperSort.Citations }));
    expect(f).toContain('title_and_abstract.search:"diffusion models"');
  });

  it("openalex never returns retracted papers (one ranked #3 by citations)", () => {
    for (const sort of [PaperSort.Relevance, PaperSort.Citations, PaperSort.Newest]) {
      expect(filterOf(worksUrl({ query: "q", limit: 5, page: 1, openAccess: false, sort }))).toContain("is_retracted:false");
    }
  });
});
