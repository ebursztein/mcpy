/**
 * Latency and response-size budgets. Budgets are generous enough for CI
 * noise but catch order-of-magnitude regressions.
 */

import { describe, expect, it } from "vitest";
import { MAX_GREP_OUTPUT_CHARS, MAX_SNIPPET_CHARS, PageFormat } from "mcpy";
import { renderFetch } from "mcpy/mcp";
import { grepLines } from "../../src/content/text.js";
import { htmlToMarkdown } from "../../src/content/extract.js";
import { fakePages, fakeSearch, page, testMcpy } from "../helpers.js";

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)];
}

async function time(fn: () => Promise<unknown>, runs: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    out.push(performance.now() - t);
  }
  return out;
}

const BIG_PAGE = page({ content: "Line of text with some words in it.\n".repeat(30_000) }); // ~1 MB

describe("latency budgets", () => {
  it("cache hit p95 < 5 ms", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("p", BIG_PAGE)] });
    await mcpy.fetch({ url: "https://example.com/a" });
    const samples = await time(() => mcpy.fetch({ url: "https://example.com/a", max_length: 5_000 }), 200);
    expect(p95(samples)).toBeLessThan(5);
  });

  it("engine overhead on a cache miss p95 < 15 ms (instant provider)", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("p", page())] });
    let n = 0;
    const samples = await time(() => mcpy.fetch({ url: `https://example.com/${n++}` }), 100);
    expect(p95(samples)).toBeLessThan(15);
  });

  it("extracts a 1 MB HTML page to markdown in < 250 ms", () => {
    const html = `<html><head><title>Big</title></head><body><article>${"<p>Paragraph with <a href='/x'>a link</a> and text.</p>".repeat(20_000)}</article></body></html>`;
    const t = performance.now();
    const out = htmlToMarkdown(html, "https://example.com/");
    expect(performance.now() - t).toBeLessThan(250);
    expect(out.markdown.length).toBeGreaterThan(100_000);
  });

  it("greps 100k lines in < 300 ms", () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => (i % 997 === 0 ? `needle ${i}` : `hay ${i}`));
    const t = performance.now();
    const r = grepLines(lines, "needle", 2, 200);
    expect(performance.now() - t).toBeLessThan(300);
    expect(r.matches).toBeGreaterThan(50);
  });
});

describe("response-size budgets (context protection)", () => {
  it.each([500, 2_000, 10_000, 100_000])("fetch result for max_length=%i stays within max_length + 2 KB", async (max) => {
    const { mcpy } = testMcpy({ pages: [fakePages("p", BIG_PAGE)] });
    const result = await mcpy.fetch({ url: "https://example.com/a", max_length: max });
    expect(result.content.length).toBeLessThanOrEqual(max);
    // Envelope overhead around the (JSON-escaped) content stays under 2 KB.
    expect(JSON.stringify(result).length - JSON.stringify(result.content).length).toBeLessThanOrEqual(2_048);
    expect(renderFetch(result).length).toBeLessThanOrEqual(max + 1_000);
  });

  it("grep output is capped no matter how many lines match", async () => {
    const dense = page({ content: `${"match ".repeat(200)}\n`.repeat(5_000) });
    const { mcpy } = testMcpy({ pages: [fakePages("p", dense)] });
    const result = await mcpy.grep({ url: "https://example.com/a", pattern: "match", max_matches: 200, context_lines: 20 });
    expect(result.output.length).toBeLessThanOrEqual(MAX_GREP_OUTPUT_CHARS);
    expect(result.truncated).toBe(true);
  });

  it("50 search results with huge snippets stay under 50 KB", async () => {
    const hits = Array.from({ length: 50 }, (_, i) => ({ url: `https://r${i}.example`, title: `Result ${i}`, snippet: "x ".repeat(10_000) }));
    const { mcpy } = testMcpy({ search: [fakeSearch("s", hits)] });
    const result = await mcpy.search({ query: "q", limit: 50 });
    expect(result.results.every((r) => r.snippet.length <= MAX_SNIPPET_CHARS)).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(50_000);
  });

  it("html format respects the same character budget", async () => {
    const html = page({ content: `<html><body>${"<div>x</div>".repeat(50_000)}</body></html>`, format: PageFormat.Html, contentType: "text/html" });
    const { mcpy } = testMcpy({ pages: [fakePages("p", html)] });
    const result = await mcpy.fetch({ url: "https://example.com/a", format: PageFormat.Html, max_length: 3_000 });
    expect(result.content.length).toBe(3_000);
    expect(result.next_index).toBe(3_000);
  });
});
