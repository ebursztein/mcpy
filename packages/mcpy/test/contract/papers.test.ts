/**
 * Paper indexes against captured responses: OpenAlex and arXiv were
 * recorded live on 2026-10-22; Semantic Scholar follows its documented
 * shape (the keyless pool answered 429 to every live request).
 */

import { describe, expect, it } from "vitest";
import { ErrorCode, PaperSort } from "mcpy";
import { arxiv, openAlex, semanticScholar, type PaperRequest } from "mcpy/providers";
import { arxivQuery, arxivUrl } from "../../src/providers/arxiv/index.js";
import { parseArxivFeed } from "../../src/providers/arxiv/parse.js";
import { abstractFromIndex, worksUrl } from "../../src/providers/openalex/index.js";
import { semanticScholarUrl } from "../../src/providers/semantic-scholar/index.js";
import { fixture, stubFetch } from "../helpers.js";
import { failureOf, providerCall } from "./call.js";

const req = (over: Partial<PaperRequest> = {}): PaperRequest => ({ query: "attention is all you need", limit: 3, page: 1, openAccess: false, sort: PaperSort.Relevance, ...over });
const params = (url: string) => Object.fromEntries(new URL(url).searchParams);
const reply = (body: string, type = "application/json") => () => new Response(body, { headers: { "content-type": type } });

describe("openalex: request", () => {
  it("ranks by relevance with full-text search", () => {
    expect(params(worksUrl(req()))).toMatchObject({ search: "attention is all you need", sort: "relevance_score:desc", "per-page": "3", page: "1" });
  });

  // Regression: sorting full-text matches by citations put off-topic classics first.
  it("matches title and abstract when sorting by citations or date", () => {
    const p = params(worksUrl(req({ sort: PaperSort.Citations, query: "a, b|c" })));
    expect(p).not.toHaveProperty("search");
    expect(p).toMatchObject({ sort: "cited_by_count:desc", filter: "title_and_abstract.search:a  b c" });
  });

  it("never returns future-dated papers for newest, and maps year and open-access filters", () => {
    expect(params(worksUrl(req({ sort: PaperSort.Newest }), undefined, "2026-10-22")).filter).toBe("title_and_abstract.search:attention is all you need,to_publication_date:2026-10-22");
    const f = params(worksUrl(req({ yearFrom: 2018, yearTo: 2020, openAccess: true }), "key")).filter;
    expect(f).toBe("from_publication_date:2018-01-01,to_publication_date:2020-12-31,is_oa:true");
    expect(params(worksUrl(req(), "key")).api_key).toBe("key");
  });
});

describe("openalex: mapping the live response", () => {
  it("maps title, authors, citations, DOI, venue, PDF and rebuilds the abstract", async () => {
    const { fetch } = stubFetch(reply(fixture("openalex-works.json")));
    const papers = await openAlex().searchPapers(req(), providerCall(fetch));
    expect(papers).toHaveLength(3);
    const [first, second] = papers;
    expect(first).toMatchObject({ title: "Attention Is All You Need", citations: 78258, openAccess: true, doi: "10.65215/2q58a426" });
    expect(first.authors.slice(0, 2)).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
    expect(first.abstract).toMatch(/^The dominant sequence transduction models/);
    expect(second).toMatchObject({ venue: "IEEE International Conference on Acoustics Speech and Signal Processing", openAccess: false });
  });

  it("rebuilds inverted-index abstracts in word order", () => {
    expect(abstractFromIndex({ world: [1], hello: [0], again: [2] })).toBe("hello world again");
    expect(abstractFromIndex(null)).toBeUndefined();
  });

  it("derives the arXiv id from an arXiv DataCite DOI", async () => {
    const work = { id: "W1", doi: "https://doi.org/10.48550/arXiv.2006.11239", display_name: "DDPM" };
    const { fetch } = stubFetch(reply(JSON.stringify({ results: [work, { id: "W2" }] })));
    const papers = await openAlex().searchPapers(req(), providerCall(fetch));
    expect(papers).toEqual([expect.objectContaining({ doi: "10.48550/arxiv.2006.11239", arxivId: "2006.11239", url: work.doi })]);
  });

  it("reports HTTP errors as upstream failures", async () => {
    const { fetch } = stubFetch(() => new Response(JSON.stringify({ error: "budget" }), { status: 429, headers: { "content-type": "application/json" } }));
    expect((await failureOf(openAlex().searchPapers(req(), providerCall(fetch)))).code).toBe(ErrorCode.UpstreamFailed);
  });
});

describe("arxiv", () => {
  it("ANDs the terms, drops operators and quotes, and maps paging and sort", () => {
    expect(arxivQuery(req({ query: '"graph" AND neural (nets)' }))).toBe("all:graph AND all:neural AND all:nets");
    expect(arxivQuery(req({ yearFrom: 2020 }))).toMatch(/submittedDate:\[202001010000 TO 210012312359\]$/);
    expect(params(arxivUrl(req({ page: 3, limit: 5, sort: PaperSort.Newest })))).toMatchObject({ start: "10", max_results: "5", sortBy: "submittedDate", sortOrder: "descending" });
  });

  it("parses the live feed: ids without versions, authors, PDF, DOI and year", () => {
    const papers = parseArxivFeed(fixture("arxiv-feed.xml"));
    const vaswani = papers.find((p) => p.arxivId === "1706.03762");
    expect(papers).toHaveLength(2);
    expect(vaswani).toMatchObject({ title: "Attention Is All You Need", year: 2017, published: "2017-06-12", venue: "arXiv", openAccess: true });
    expect(vaswani?.authors.slice(0, 2)).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
    expect(vaswani?.pdfUrl).toBe("https://arxiv.org/pdf/1706.03762v7");
    expect(vaswani?.url).toBe("https://arxiv.org/abs/1706.03762v7");
    expect(vaswani?.doi).toBe("10.48550/arxiv.1706.03762");
  });

  it("decodes entities and skips arXiv's error entries", () => {
    const feed = `<feed><entry><id>http://arxiv.org/api/errors#bad</id><title>Error</title></entry>
      <entry><id>http://arxiv.org/abs/2101.00001v2</id><title>Q&amp;A &lt;fast&gt;</title><published>2021-01-01T00:00:00Z</published></entry></feed>`;
    expect(parseArxivFeed(feed)).toEqual([expect.objectContaining({ title: "Q&A <fast>", arxivId: "2101.00001" })]);
  });

  // Regression: arXiv answered 429 (no Retry-After) to quick retries; the
  // adapter now spaces requests and retries patiently.
  it("retries a throttled query after spacing, and gives up after three tries", async () => {
    const feed = fixture("arxiv-feed.xml");
    const recovering = stubFetch((_u, n) => (n === 1 ? new Response("Rate exceeded.", { status: 429 }) : new Response(feed, { headers: { "content-type": "application/atom+xml" } })));
    const t = Date.now();
    const papers = await arxiv({ spacingMs: 50 }).searchPapers(req(), providerCall(recovering.fetch));
    expect(papers).toHaveLength(2);
    expect(recovering.calls).toHaveLength(2);
    expect(Date.now() - t).toBeGreaterThanOrEqual(45);

    const stuck = stubFetch(() => new Response("Rate exceeded.", { status: 429 }));
    expect((await failureOf(arxiv({ spacingMs: 5 }).searchPapers(req(), providerCall(stuck.fetch)))).code).toBe(ErrorCode.UpstreamFailed);
    expect(stuck.calls).toHaveLength(3);
  });

  it("treats a non-feed answer as a bad response", async () => {
    const { fetch } = stubFetch(reply("<html>busy</html>", "text/html"));
    expect((await failureOf(arxiv().searchPapers(req(), providerCall(fetch)))).code).toBe(ErrorCode.BadResponse);
  });
});

describe("semantic scholar", () => {
  it("sends the key as a header and maps paging, year range and open access", async () => {
    expect(params(semanticScholarUrl(req({ page: 2, limit: 10, yearFrom: 2017, openAccess: true })))).toMatchObject({ offset: "10", limit: "10", year: "2017-", openAccessPdf: "" });
    const { fetch, calls } = stubFetch(reply(fixture("semantic-scholar-search.json")));
    const papers = await semanticScholar({ apiKey: "s2-key" }).searchPapers(req(), providerCall(fetch));
    expect(calls[0].headers.get("x-api-key")).toBe("s2-key");
    expect(papers[0]).toMatchObject({ title: "Attention is All you Need", arxivId: "1706.03762", citations: 151234, pdfUrl: "https://arxiv.org/pdf/1706.03762", year: 2017 });
    expect(papers[1]).toMatchObject({ title: "A paper with almost nothing", authors: [] });
  });
});
